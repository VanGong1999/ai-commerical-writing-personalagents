"""Global LLM traffic governor: adaptive concurrency, admit/queue, provider cooldown.

Redis is the hot path; in-memory fallback keeps unit tests and Redis-less local runs working.
"""

from __future__ import annotations

import asyncio
import logging
import math
import os
import threading
import time
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, Literal
from uuid import uuid4

from .queue import _get_redis

logger = logging.getLogger(__name__)

SETTING_KEY = "llm_traffic"

Priority = Literal["pa_meta", "pa_chat", "agent_run", "fleet"]

# Higher number = higher priority when competing for scarce slots.
_PRIORITY_WEIGHT: dict[str, int] = {
    "pa_meta": 100,
    "pa_chat": 60,
    "agent_run": 40,
    "fleet": 20,
}

_LOCK = threading.Lock()
_LEASES: dict[str, float] = {}
_LEGACY_LEASES: ContextVar[tuple] = ContextVar("llm_admissions", default=())
_LEASE_KEY = "llm:gov:leases:v2"

# Atomic check-and-reserve, with independently expiring ownership tokens.
_ACQUIRE_LUA = """
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", ARGV[1])
local throttle = tonumber(redis.call("GET", KEYS[3]) or "0")
local cap = tonumber(redis.call("GET", KEYS[2]) or ARGV[4])
if throttle > tonumber(ARGV[1]) or redis.call("ZCARD", KEYS[1]) >= cap then
  return 0
end
local last = tonumber(redis.call("GET", KEYS[4]) or "0")
if tonumber(ARGV[6]) > 0 and last + tonumber(ARGV[6]) > tonumber(ARGV[1]) then return 0 end
redis.call("SET", KEYS[4], ARGV[1])
redis.call("ZADD", KEYS[1], ARGV[2], ARGV[3])
return 1
"""
_COUNT_LUA = """
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", ARGV[1])
return redis.call("ZCARD", KEYS[1])
"""


@dataclass(frozen=True)
class AdmissionLease:
    token: str
    client: Any = field(default=None, compare=False, repr=False)


def _memory_count(now: float) -> int:
    for token, until in list(_LEASES.items()):
        if until <= now:
            del _LEASES[token]
    return len(_LEASES)

_MEM: dict[str, Any] = {
    "cap": None,
    "effective": None,
    "inflight": 0,
    "success_streak": 0,
    "throttle_until": 0.0,
    "adaptive": True,
    "failover": True,
    "fleet_default_concurrency": 4,
    "pa_defer_when_busy": True,
    "cooldowns": {},  # provider_id -> until_ts
}


@dataclass
class TrafficConfig:
    worker_concurrency_cap: int = 4
    adaptive_enabled: bool = True
    failover_enabled: bool = True
    fleet_default_concurrency: int = 4
    pa_defer_when_busy: bool = True
    success_streak_to_recover: int = 8


@dataclass
class TrafficStatus:
    cap: int
    effective: int
    inflight: int
    throttle_until: float
    throttled: bool
    adaptive_enabled: bool
    failover_enabled: bool
    fleet_default_concurrency: int
    pa_defer_when_busy: bool
    success_streak: int
    cooldowns: dict[str, float] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        now = time.time()
        return {
            "cap": self.cap,
            "effective": self.effective,
            "inflight": self.inflight,
            "throttleUntil": self.throttle_until if self.throttle_until > now else None,
            "throttled": self.throttled,
            "adaptiveEnabled": self.adaptive_enabled,
            "failoverEnabled": self.failover_enabled,
            "fleetDefaultConcurrency": self.fleet_default_concurrency,
            "paDeferWhenBusy": self.pa_defer_when_busy,
            "successStreak": self.success_streak,
            "cooldowns": {
                k: v for k, v in self.cooldowns.items() if v > now
            },
        }


def _clamp_cap(n: int) -> int:
    return max(1, min(16, int(n)))


def _env_cap_default() -> int:
    return _clamp_cap(int(os.environ.get("AGENT_WORKER_CONCURRENCY") or 4))


def _defaults() -> TrafficConfig:
    return TrafficConfig(worker_concurrency_cap=_env_cap_default())


def load_config(session: Any | None = None) -> TrafficConfig:
    """Load persisted AppSetting; fall back to env defaults."""
    cfg = _defaults()
    if session is None:
        try:
            from sqlmodel import Session

            from .db import engine

            with Session(engine) as s:
                return load_config(s)
        except Exception:  # noqa: BLE001
            return cfg
    try:
        from .models import AppSetting

        row = session.get(AppSetting, SETTING_KEY)
        raw = (row.value_json or {}) if row else {}
        if "worker_concurrency_cap" in raw:
            cfg.worker_concurrency_cap = _clamp_cap(int(raw["worker_concurrency_cap"]))
        if "adaptive_enabled" in raw:
            cfg.adaptive_enabled = bool(raw["adaptive_enabled"])
        if "failover_enabled" in raw:
            cfg.failover_enabled = bool(raw["failover_enabled"])
        if "fleet_default_concurrency" in raw:
            cfg.fleet_default_concurrency = _clamp_cap(int(raw["fleet_default_concurrency"]))
        if "pa_defer_when_busy" in raw:
            cfg.pa_defer_when_busy = bool(raw["pa_defer_when_busy"])
        if "success_streak_to_recover" in raw:
            cfg.success_streak_to_recover = max(1, int(raw["success_streak_to_recover"]))
    except Exception:  # noqa: BLE001
        logger.exception("llm_governor load_config failed")
    return cfg


def save_config(session: Any, patch: dict[str, Any]) -> TrafficConfig:
    from .models import AppSetting, utcnow

    row = session.get(AppSetting, SETTING_KEY)
    raw: dict[str, Any] = dict((row.value_json or {}) if row else {})
    if "worker_concurrency_cap" in patch and patch["worker_concurrency_cap"] is not None:
        raw["worker_concurrency_cap"] = _clamp_cap(int(patch["worker_concurrency_cap"]))
    if "adaptive_enabled" in patch and patch["adaptive_enabled"] is not None:
        raw["adaptive_enabled"] = bool(patch["adaptive_enabled"])
    if "failover_enabled" in patch and patch["failover_enabled"] is not None:
        raw["failover_enabled"] = bool(patch["failover_enabled"])
    if "fleet_default_concurrency" in patch and patch["fleet_default_concurrency"] is not None:
        raw["fleet_default_concurrency"] = _clamp_cap(int(patch["fleet_default_concurrency"]))
    if "pa_defer_when_busy" in patch and patch["pa_defer_when_busy"] is not None:
        raw["pa_defer_when_busy"] = bool(patch["pa_defer_when_busy"])

    if row is None:
        row = AppSetting(key=SETTING_KEY, value_json=raw)
        session.add(row)
    else:
        row.value_json = raw
        row.updated_at = utcnow()
        session.add(row)
    session.commit()

    cfg = load_config(session)
    _sync_cap_to_hot(cfg)
    return cfg


def _sync_cap_to_hot(cfg: TrafficConfig) -> None:
    client = _get_redis()
    if client:
        try:
            client.set("llm:gov:cap", cfg.worker_concurrency_cap)
            client.set("llm:gov:adaptive", "1" if cfg.adaptive_enabled else "0")
            client.set("llm:gov:failover", "1" if cfg.failover_enabled else "0")
            client.set("llm:gov:fleet_default", cfg.fleet_default_concurrency)
            client.set("llm:gov:pa_defer", "1" if cfg.pa_defer_when_busy else "0")
            # Clamp effective to new cap
            eff_raw = client.get("llm:gov:effective")
            eff = int(eff_raw) if eff_raw else cfg.worker_concurrency_cap
            client.set("llm:gov:effective", min(eff, cfg.worker_concurrency_cap))
            return
        except Exception:  # noqa: BLE001
            logger.warning("llm_governor redis sync failed", exc_info=True)
    with _LOCK:
        _MEM["cap"] = cfg.worker_concurrency_cap
        _MEM["adaptive"] = cfg.adaptive_enabled
        _MEM["failover"] = cfg.failover_enabled
        _MEM["fleet_default_concurrency"] = cfg.fleet_default_concurrency
        _MEM["pa_defer_when_busy"] = cfg.pa_defer_when_busy
        cur = _MEM.get("effective") or cfg.worker_concurrency_cap
        _MEM["effective"] = min(int(cur), cfg.worker_concurrency_cap)


def _ensure_hot(cfg: TrafficConfig | None = None) -> TrafficConfig:
    cfg = cfg or load_config()
    client = _get_redis()
    if client:
        try:
            if client.get("llm:gov:cap") is None:
                _sync_cap_to_hot(cfg)
            return cfg
        except Exception:  # noqa: BLE001
            pass
    with _LOCK:
        if _MEM["cap"] is None:
            _MEM["cap"] = cfg.worker_concurrency_cap
            _MEM["effective"] = cfg.worker_concurrency_cap
            _MEM["adaptive"] = cfg.adaptive_enabled
            _MEM["failover"] = cfg.failover_enabled
            _MEM["fleet_default_concurrency"] = cfg.fleet_default_concurrency
            _MEM["pa_defer_when_busy"] = cfg.pa_defer_when_busy
    return cfg


def status(session: Any | None = None) -> TrafficStatus:
    cfg = _ensure_hot(load_config(session) if session is not None else load_config())
    client = _get_redis()
    now = time.time()
    if client:
        try:
            cap = _clamp_cap(int(client.get("llm:gov:cap") or cfg.worker_concurrency_cap))
            effective = _clamp_cap(int(client.get("llm:gov:effective") or cap))
            effective = min(effective, cap)
            inflight = int(client.eval(_COUNT_LUA, 1, _LEASE_KEY, now))
            throttle_until = float(client.get("llm:gov:throttle_until") or 0)
            streak = max(0, int(client.get("llm:gov:success_streak") or 0))
            adaptive = (client.get("llm:gov:adaptive") or ("1" if cfg.adaptive_enabled else "0")) == "1"
            failover = (client.get("llm:gov:failover") or ("1" if cfg.failover_enabled else "0")) == "1"
            fleet_def = _clamp_cap(
                int(client.get("llm:gov:fleet_default") or cfg.fleet_default_concurrency)
            )
            pa_defer = (client.get("llm:gov:pa_defer") or ("1" if cfg.pa_defer_when_busy else "0")) == "1"
            cooldowns: dict[str, float] = {}
            for key in client.scan_iter("llm:gov:cooldown:*"):
                pid = str(key).split("llm:gov:cooldown:", 1)[-1]
                until = float(client.get(key) or 0)
                if until > now:
                    cooldowns[pid] = until
            return TrafficStatus(
                cap=cap,
                effective=effective,
                inflight=inflight,
                throttle_until=throttle_until,
                throttled=throttle_until > now,
                adaptive_enabled=adaptive,
                failover_enabled=failover,
                fleet_default_concurrency=fleet_def,
                pa_defer_when_busy=pa_defer,
                success_streak=streak,
                cooldowns=cooldowns,
            )
        except Exception:  # noqa: BLE001
            logger.warning("llm_governor status redis read failed", exc_info=True)
    with _LOCK:
        cap = _clamp_cap(int(_MEM.get("cap") or cfg.worker_concurrency_cap))
        effective = _clamp_cap(int(_MEM.get("effective") or cap))
        effective = min(effective, cap)
        throttle_until = float(_MEM.get("throttle_until") or 0)
        return TrafficStatus(
            cap=cap,
            effective=effective,
            inflight=_memory_count(now),
            throttle_until=throttle_until,
            throttled=throttle_until > now,
            adaptive_enabled=bool(_MEM.get("adaptive", True)),
            failover_enabled=bool(_MEM.get("failover", True)),
            fleet_default_concurrency=_clamp_cap(
                int(_MEM.get("fleet_default_concurrency") or cfg.fleet_default_concurrency)
            ),
            pa_defer_when_busy=bool(_MEM.get("pa_defer_when_busy", True)),
            success_streak=max(0, int(_MEM.get("success_streak") or 0)),
            cooldowns={
                k: float(v)
                for k, v in dict(_MEM.get("cooldowns") or {}).items()
                if float(v) > now
            },
        )


def is_throttled() -> bool:
    return status().throttled


def should_defer_pa_writing() -> bool:
    st = status()
    if not st.pa_defer_when_busy:
        return False
    return st.throttled or st.inflight >= st.effective


def effective_fleet_concurrency(group_max: int) -> int:
    st = status()
    base = max(1, int(group_max or st.fleet_default_concurrency))
    return max(1, min(base, st.effective))


def slots_available(*, priority: Priority = "agent_run") -> bool:
    """Non-reserving check: can we schedule more work of this priority?"""
    _ensure_hot()
    st = status()
    if st.throttled:
        return False
    return st.inflight < st.effective


def reserve(*, priority: Priority = "agent_run", lease_s: float = 600.0) -> AdmissionLease | None:
    """Reserve an expiring slot; release only using its ownership token."""
    _ensure_hot()
    st = status()
    now = time.time()
    # Engineering burst smoothing, not an assumed provider RPM entitlement.
    interval = max(0.0, float(os.environ.get("LLM_MIN_REQUEST_INTERVAL_S", "0.3")))
    token = uuid4().hex
    client = _get_redis()
    if client:
        try:
            admitted = client.eval(
                _ACQUIRE_LUA, 4, _LEASE_KEY, "llm:gov:effective",
                "llm:gov:throttle_until", "llm:gov:last_admitted", now, now + max(1.0, lease_s),
                token, st.effective, priority, interval,
            )
            return AdmissionLease(token, client) if admitted else None
        except Exception:  # noqa: BLE001
            # An uncertain Redis outcome must not reserve another fallback slot.
            logger.warning("llm_governor lease acquisition failed", exc_info=True)
            return None
    with _LOCK:
        count = _memory_count(now)
        if (
            float(_MEM.get("throttle_until") or 0) > now
            or count >= int(_MEM.get("effective") or st.effective)
        ):
            return None
        if interval and float(_MEM.get("last_admitted") or 0) + interval > now:
            return None
        _MEM["last_admitted"] = now
        _LEASES[token] = now + max(1.0, lease_s)
    return AdmissionLease(token)


async def acquire(
    *, priority: Priority = "agent_run", timeout_s: float = 30.0,
    lease_s: float = 600.0,
) -> AdmissionLease | None:
    """Wait a bounded time locally without consuming a model attempt."""
    deadline = time.monotonic() + max(0.0, timeout_s)
    while True:
        lease = reserve(priority=priority, lease_s=lease_s)
        if lease:
            return lease
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return None
        await asyncio.sleep(min(0.1, remaining))


def renew(lease: AdmissionLease, *, lease_s: float = 60.0) -> bool:
    """Extend a live owner's lease; an expired owner cannot take a new slot."""
    now = time.time()
    until = now + lease_s
    if lease.client is not None:
        try:
            return bool(lease.client.eval(
                "local score = redis.call('ZSCORE', KEYS[1], ARGV[1]); "
                "if not score or tonumber(score) <= tonumber(ARGV[2]) then return 0 end; "
                "redis.call('ZADD', KEYS[1], 'XX', ARGV[3], ARGV[1]); return 1",
                1, _LEASE_KEY, lease.token, now, until,
            ))
        except Exception:  # noqa: BLE001
            logger.warning("llm_governor lease renewal failed", exc_info=True)
            return False
    with _LOCK:
        if _LEASES.get(lease.token, 0) <= now:
            return False
        _LEASES[lease.token] = until
        return True


async def keep_alive(lease: AdmissionLease, *, owner: asyncio.Task | None = None) -> None:
    while True:
        await asyncio.sleep(20)
        if not renew(lease, lease_s=60):
            # Stop the upstream operation before another owner can use the slot.
            if owner is not None:
                owner.cancel()
            return


def try_admit(*, priority: Priority = "agent_run", wait: bool = False) -> bool:
    """Compatibility for synchronous callers; async callers should use acquire."""
    lease = reserve(priority=priority)
    if lease is None:
        return False
    _LEGACY_LEASES.set((*_LEGACY_LEASES.get(), lease))
    return True


def release(lease: AdmissionLease | None = None) -> None:
    if lease is None:
        stack = _LEGACY_LEASES.get()
        if not stack:
            return
        lease = stack[-1]
        _LEGACY_LEASES.set(stack[:-1])
    if lease.client is not None:
        try:
            lease.client.zrem(_LEASE_KEY, lease.token)
        except Exception:  # noqa: BLE001
            logger.warning("llm_governor lease release failed; awaiting expiry", exc_info=True)
        return
    with _LOCK:
        _LEASES.pop(lease.token, None)


def report_success() -> None:
    cfg = _ensure_hot()
    client = _get_redis()
    if client:
        try:
            streak = int(client.incr("llm:gov:success_streak"))
            adaptive = (client.get("llm:gov:adaptive") or "1") == "1"
            if adaptive and streak >= cfg.success_streak_to_recover:
                cap = _clamp_cap(int(client.get("llm:gov:cap") or cfg.worker_concurrency_cap))
                eff = _clamp_cap(int(client.get("llm:gov:effective") or cap))
                if eff < cap:
                    client.set("llm:gov:effective", eff + 1)
                client.set("llm:gov:success_streak", 0)
                # Clear throttle if past
                until = float(client.get("llm:gov:throttle_until") or 0)
                if until and until <= time.time():
                    client.delete("llm:gov:throttle_until")
            return
        except Exception:  # noqa: BLE001
            logger.warning("llm_governor report_success redis failed", exc_info=True)
    with _LOCK:
        if not _MEM.get("adaptive", True):
            return
        streak = int(_MEM.get("success_streak") or 0) + 1
        _MEM["success_streak"] = streak
        if streak >= cfg.success_streak_to_recover:
            cap = _clamp_cap(int(_MEM.get("cap") or cfg.worker_concurrency_cap))
            eff = _clamp_cap(int(_MEM.get("effective") or cap))
            _MEM["effective"] = min(cap, eff + 1)
            _MEM["success_streak"] = 0
            if float(_MEM.get("throttle_until") or 0) <= time.time():
                _MEM["throttle_until"] = 0.0


def _extend_redis_deadline(client: Any, key: str, until: float) -> None:
    # Concurrent shorter Retry-After responses must not reopen an earlier window.
    client.eval(
        "local deadline = math.max(tonumber(redis.call('GET', KEYS[1]) or '0'), tonumber(ARGV[1])); "
        "redis.call('SET', KEYS[1], deadline, 'EX', math.max(60, math.ceil(deadline - tonumber(ARGV[2])) + 30)); "
        "return 1", 1, key, until, time.time(),
    )


def report_throttle(
    *,
    retry_after_s: float | None = None,
    provider_id: str | None = None,
) -> None:
    """Lower effective concurrency and open a throttle window."""
    cfg = _ensure_hot()
    wait = float(retry_after_s or 15.0)
    if not math.isfinite(wait) or wait <= 0:
        wait = 15.0
    wait = max(5.0, wait)
    until = time.time() + wait
    client = _get_redis()
    if client:
        try:
            adaptive = (client.get("llm:gov:adaptive") or "1") == "1"
            if adaptive:
                cap = _clamp_cap(int(client.get("llm:gov:cap") or cfg.worker_concurrency_cap))
                eff = _clamp_cap(int(client.get("llm:gov:effective") or cap))
                client.set("llm:gov:effective", max(1, eff - 1))
            _extend_redis_deadline(client, "llm:gov:throttle_until", until)
            client.set("llm:gov:success_streak", 0)
            if provider_id:
                _extend_redis_deadline(client, f"llm:gov:cooldown:{provider_id}", until)
            return
        except Exception:  # noqa: BLE001
            logger.warning("llm_governor report_throttle redis failed", exc_info=True)
    with _LOCK:
        if _MEM.get("adaptive", True):
            cap = _clamp_cap(int(_MEM.get("cap") or cfg.worker_concurrency_cap))
            eff = _clamp_cap(int(_MEM.get("effective") or cap))
            _MEM["effective"] = max(1, eff - 1)
        _MEM["throttle_until"] = max(float(_MEM.get("throttle_until") or 0), until)
        _MEM["success_streak"] = 0
        if provider_id:
            cds = dict(_MEM.get("cooldowns") or {})
            cds[provider_id] = max(float(cds.get(provider_id) or 0), until)
            _MEM["cooldowns"] = cds


def set_provider_cooldown(provider_id: str, seconds: float = 30.0, *, quota: bool = False) -> None:
    seconds = float(seconds)
    if not math.isfinite(seconds) or seconds <= 0:
        seconds = 30.0
    seconds = max(5.0, seconds)
    until = time.time() + seconds
    client = _get_redis()
    if client:
        try:
            _extend_redis_deadline(client, f"llm:gov:cooldown:{provider_id}", until)
            if quota:
                _extend_redis_deadline(client, f"llm:gov:quota:{provider_id}", until)
            return
        except Exception:  # noqa: BLE001
            pass
    with _LOCK:
        cds = dict(_MEM.get("cooldowns") or {})
        cds[provider_id] = max(float(cds.get(provider_id) or 0), until)
        _MEM["cooldowns"] = cds
        if quota:
            quotas = _MEM.setdefault("quota", {})
            quotas[provider_id] = max(quotas.get(provider_id, 0), until)


def provider_in_cooldown(provider_id: str, *, quota: bool = False) -> bool:
    namespace = "quota" if quota else "cooldown"
    now = time.time()
    client = _get_redis()
    if client:
        try:
            until = float(client.get(f"llm:gov:{namespace}:{provider_id}") or 0)
            return until > now
        except Exception:  # noqa: BLE001
            pass
    with _LOCK:
        return float((_MEM.get("quota" if quota else "cooldowns") or {}).get(provider_id) or 0) > now


def failover_enabled() -> bool:
    return status().failover_enabled


def reset_memory_for_tests() -> None:
    """Test helper: clear in-memory governor state."""
    _LEGACY_LEASES.set(())
    with _LOCK:
        _LEASES.clear()
        _MEM.clear()
        _MEM.update(
            {
                "cap": None,
                "effective": None,
                "inflight": 0,
                "success_streak": 0,
                "throttle_until": 0.0,
                "adaptive": True,
                "failover": True,
                "fleet_default_concurrency": 4,
                "pa_defer_when_busy": True,
                "cooldowns": {},
            }
        )


def worker_view() -> dict[str, Any]:
    """Compact payload for agent-worker polling."""
    st = status()
    return {
        "cap": st.cap,
        "effective": st.effective,
        "inflight": st.inflight,
        "throttled": st.throttled,
        "throttleUntil": st.throttle_until if st.throttled else None,
        "failoverEnabled": st.failover_enabled,
        "adaptiveEnabled": st.adaptive_enabled,
    }
