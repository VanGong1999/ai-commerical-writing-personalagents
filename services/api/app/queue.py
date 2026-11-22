from __future__ import annotations

import json
import logging
import threading
import time
from typing import Any, Iterator

from .settings import get_settings

logger = logging.getLogger(__name__)

_memory_events: dict[str, list[dict[str, Any]]] = {}
_memory_queue: list[str] = []
_memory_cancel: set[str] = set()
_lock = threading.Lock()
_redis = None
_redis_failed = False


def _get_redis():
    global _redis, _redis_failed
    if _redis_failed:
        return None
    if _redis is not None:
        return _redis
    try:
        import redis

        client = redis.Redis.from_url(get_settings().redis_url, decode_responses=True)
        client.ping()
        _redis = client
        return _redis
    except Exception as exc:  # noqa: BLE001
        logger.warning("Redis unavailable, falling back to in-memory queue: %s", exc)
        _redis_failed = True
        return None


def reset_queue_clients() -> None:
    global _redis, _redis_failed
    _redis = None
    _redis_failed = False
    with _lock:
        _memory_events.clear()
        _memory_queue.clear()
        _memory_cancel.clear()


def enqueue_job(job_id: str, payload: dict[str, Any] | None = None) -> None:
    settings = get_settings()
    body_obj = {"jobId": job_id, **(payload or {})}
    body = json.dumps(body_obj, ensure_ascii=False)
    job_type = str(body_obj.get("type") or "")
    # agent.* 只由 Node agent-worker 消费（jobs:agent）；其余进 jobs:queue
    client = _get_redis()
    if client:
        queue_key = settings.job_agent_queue_key if job_type.startswith("agent.") else settings.job_queue_key
        client.lpush(queue_key, body)
        return
    # 无 Redis：Node agent-worker 无法消费 jobs:agent，agent.* 直接丢弃并告警（避免落进 Python 队列被静默跳过）
    if job_type.startswith("agent."):
        logger.error(
            "Redis unavailable: agent.* job %s cannot reach Node agent-worker (jobs:agent). "
            "Start Redis + agent-worker to run agent jobs.",
            job_id,
        )
        return
    with _lock:
        _memory_queue.append(body)


def claim_job(timeout_s: float = 1.0) -> dict[str, Any] | None:
    settings = get_settings()
    client = _get_redis()
    if client:
        item = client.brpop(settings.job_queue_key, timeout=max(1, int(timeout_s)))
        if not item:
            return None
        raw = item[1]
        return json.loads(raw)
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        with _lock:
            if _memory_queue:
                return json.loads(_memory_queue.pop(0))
        time.sleep(0.05)
    return None


def publish_job_event(job_id: str, event: dict[str, Any]) -> None:
    settings = get_settings()
    channel = f"{settings.job_events_channel_prefix}{job_id}"
    payload = json.dumps(event, ensure_ascii=False)
    client = _get_redis()
    if client:
        client.publish(channel, payload)
        client.xadd(f"{channel}:stream", {"data": payload}, maxlen=500, approximate=True)
        return
    with _lock:
        _memory_events.setdefault(job_id, []).append(event)


def job_in_queue(job_id: str, queue_key: str | None = None) -> bool:
    """队列里是否已存在该 job 的 envelope（供任务守护进程做幂等恢复）。

    只在需要恢复时扫描；队列通常很短，过长（>3000）时保守返回 True 放弃重入队。
    """
    client = _get_redis()
    if not client:
        return any(f'"jobId": "{job_id}"' in item for item in _memory_queue)
    settings = get_settings()
    key = queue_key or settings.job_agent_queue_key
    try:
        if int(client.llen(key) or 0) > 3000:
            return True
        rows = client.lrange(key, 0, -1)
        return any(f'"jobId": "{job_id}"' in str(row) for row in rows)
    except Exception:  # noqa: BLE001
        return False

def iter_memory_events_since(job_id: str, index: int) -> tuple[list[dict[str, Any]], int]:
    with _lock:
        events = list(_memory_events.get(job_id, []))
    return events[index:], len(events)


def request_cancel(job_id: str) -> None:
    settings = get_settings()
    client = _get_redis()
    if client:
        client.setex(f"{settings.job_cancel_prefix}{job_id}", 3600, "1")
        publish_job_event(job_id, {"type": "status", "status": "cancelled"})
        return
    with _lock:
        _memory_cancel.add(job_id)
    publish_job_event(job_id, {"type": "status", "status": "cancelled"})


def clear_cancel(job_id: str) -> None:
    """An explicit retry revokes cancellation for this delivery only."""
    client = _get_redis()
    if client:
        client.delete(f"{get_settings().job_cancel_prefix}{job_id}")
    with _lock:
        _memory_cancel.discard(job_id)


def is_cancelled(job_id: str) -> bool:
    settings = get_settings()
    client = _get_redis()
    if client:
        return bool(client.get(f"{settings.job_cancel_prefix}{job_id}"))
    with _lock:
        return job_id in _memory_cancel


_memory_interrupt: set[str] = set()
_memory_task_events: list[dict[str, Any]] = []
_task_event_seq = 0


def request_interrupt(run_id: str) -> None:
    """硬中断信号：Worker 立即 abort 当前 LLM 请求并按最新 steer 重跑。"""
    settings = get_settings()
    client = _get_redis()
    key = f"interrupt:{run_id}"
    if client:
        client.setex(key, 3600, "1")
        client.publish(f"interrupt:{run_id}", "1")
        return
    with _lock:
        _memory_interrupt.add(run_id)


def clear_interrupt(run_id: str) -> None:
    settings = get_settings()
    client = _get_redis()
    key = f"interrupt:{run_id}"
    if client:
        client.delete(key)
        return
    with _lock:
        _memory_interrupt.discard(run_id)


def is_interrupted(run_id: str) -> bool:
    settings = get_settings()
    client = _get_redis()
    key = f"interrupt:{run_id}"
    if client:
        return bool(client.get(key))
    with _lock:
        return run_id in _memory_interrupt


def publish_task_event(event: dict[str, Any]) -> None:
    """用户级任务流事件（进度 / 审批 / 完成），供 GET /tasks/stream。"""
    global _task_event_seq
    settings = get_settings()
    with _lock:
        _task_event_seq += 1
        seq = _task_event_seq
        payload = {"seq": seq, **event}
        _memory_task_events.append(payload)
        if len(_memory_task_events) > 2000:
            del _memory_task_events[:500]
    client = _get_redis()
    if client:
        channel = f"{settings.job_events_channel_prefix}tasks:global"
        raw = json.dumps(payload, ensure_ascii=False)
        client.publish(channel, raw)
        client.xadd(f"{channel}:stream", {"data": raw}, maxlen=2000, approximate=True)


def iter_memory_task_events_since(after_seq: int) -> tuple[list[dict[str, Any]], int]:
    with _lock:
        batch = [e for e in _memory_task_events if int(e.get("seq") or 0) > after_seq]
        latest = _task_event_seq
    return batch, latest


_memory_fleet: dict[str, dict[str, Any]] = {}


def put_fleet_state(fleet_id: str, state: dict[str, Any], ttl_s: int = 86400) -> None:
    """持久化 FleetResult（Redis 优先，否则进程内）。"""
    key = f"fleet:{fleet_id}"
    payload = json.dumps(state, ensure_ascii=False)
    client = _get_redis()
    if client:
        client.setex(key, ttl_s, payload)
        return
    with _lock:
        _memory_fleet[fleet_id] = dict(state)


def get_fleet_state(fleet_id: str) -> dict[str, Any] | None:
    key = f"fleet:{fleet_id}"
    client = _get_redis()
    if client:
        raw = client.get(key)
        if not raw:
            return None
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return None
    with _lock:
        row = _memory_fleet.get(fleet_id)
        return dict(row) if row else None


def poll_job_events(job_id: str, last_id: str = "0-0") -> Iterator[tuple[str, dict[str, Any]]]:
    """Yield (stream_id, event). For Redis uses XREAD; for memory yields new events."""
    settings = get_settings()
    channel = f"{settings.job_events_channel_prefix}{job_id}"
    stream_key = f"{channel}:stream"
    client = _get_redis()
    if client:
        while True:
            rows = client.xread({stream_key: last_id}, block=500, count=20)
            if not rows:
                yield last_id, {"type": "ping"}
                continue
            for _name, messages in rows:
                for msg_id, fields in messages:
                    last_id = msg_id
                    raw = fields.get("data") or "{}"
                    try:
                        event = json.loads(raw)
                    except json.JSONDecodeError:
                        event = {"type": "token", "text": raw}
                    yield last_id, event
        return

    index = 0
    while True:
        batch, index = iter_memory_events_since(job_id, index)
        if not batch:
            yield last_id, {"type": "ping"}
            time.sleep(0.3)
            continue
        for event in batch:
            yield last_id, event


# —— Worker security ask（危险写操作真人审批）——
_security_asks: dict[str, dict[str, Any]] = {}


def create_security_ask(ask_id: str, payload: dict[str, Any], *, ttl_s: int = 120) -> dict[str, Any]:
    row = {
        "id": ask_id,
        "status": "pending",
        "payload": payload or {},
        "created_at": time.time(),
        "ttl_s": ttl_s,
    }
    client = _get_redis()
    if client:
        key = f"security_ask:{ask_id}"
        client.setex(key, ttl_s, json.dumps(row, ensure_ascii=False))
        return row
    with _lock:
        _security_asks[ask_id] = row
    return row


def get_security_ask(ask_id: str) -> dict[str, Any] | None:
    client = _get_redis()
    if client:
        raw = client.get(f"security_ask:{ask_id}")
        if not raw:
            return None
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return None
    with _lock:
        row = _security_asks.get(ask_id)
        if not row:
            return None
        if time.time() - float(row.get("created_at") or 0) > float(row.get("ttl_s") or 120):
            row = {**row, "status": "denied", "reason": "timeout"}
            _security_asks[ask_id] = row
        return row


def resolve_security_ask(ask_id: str, *, approve: bool, reason: str = "") -> dict[str, Any] | None:
    row = get_security_ask(ask_id)
    if not row:
        return None
    row = {**row, "status": "approved" if approve else "denied", "reason": reason}
    client = _get_redis()
    if client:
        key = f"security_ask:{ask_id}"
        ttl = client.ttl(key)
        ttl = ttl if ttl and ttl > 0 else 60
        client.setex(key, ttl, json.dumps(row, ensure_ascii=False))
        return row
    with _lock:
        _security_asks[ask_id] = row
    return row
