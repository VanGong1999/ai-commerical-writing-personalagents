from __future__ import annotations

import asyncio
import logging
import os
import sys
from contextlib import suppress
from pathlib import Path
from typing import Any

# Allow importing sibling monorepo package without install during local uv runs.
_GATEWAY_ROOT = Path(__file__).resolve().parents[3] / "packages" / "llm-gateway"
if _GATEWAY_ROOT.exists() and str(_GATEWAY_ROOT) not in sys.path:
    sys.path.insert(0, str(_GATEWAY_ROOT))

from llm_gateway import ChatMessage, GatewaySettings, LLMGateway  # noqa: E402
from llm_gateway import RateLimitedError  # noqa: E402

from .settings import get_settings

logger = logging.getLogger(__name__)

_gateway: LLMGateway | None = None


class LlmBusyError(RuntimeError):
    """Governor refused admit — caller should queue, not hard-fail."""

    def __init__(self, message: str = "LLM 流量繁忙，已排队", *, retry_after_s: float = 10.0) -> None:
        super().__init__(message)
        self.retry_after_s = retry_after_s


def get_gateway() -> LLMGateway:
    global _gateway
    if _gateway is None:
        s = get_settings()
        _gateway = LLMGateway(
            GatewaySettings(
                minimax_api_key=s.effective_minimax_api_key,
                minimax_base_url=s.effective_minimax_base_url,
                minimax_model=s.effective_minimax_model,
                minimax_reasoning_effort=s.minimax_reasoning_effort,
                deepseek_api_key=s.deepseek_api_key,
                deepseek_base_url=s.deepseek_base_url,
                deepseek_model=s.deepseek_model,
                llm_default_provider=s.llm_default_provider,
                openai_compat_api_key=s.openai_compat_api_key,
                openai_compat_base_url=s.openai_compat_base_url,
                openai_compat_model=s.openai_compat_model,
                embedding_base_url=s.embedding_base_url,
                embedding_api_key=s.embedding_api_key,
                embedding_model=s.embedding_model,
            )
        )
    return _gateway


def reset_gateway() -> None:
    global _gateway
    _gateway = None


def _is_local_url(url: str) -> bool:
    u = (url or "").lower()
    return any(h in u for h in ("localhost", "127.0.0.1", "0.0.0.0", "[::1]"))


def _has_real_key(key: str) -> bool:
    k = (key or "").strip()
    return bool(k) and k != "demo"


def list_provider_chain() -> list[dict[str, Any]]:
    """Ordered failover chain: default first, localhost/Ollama last.

    Only enabled providers with real keys. Used when failover_enabled.
    """
    from sqlmodel import Session, select

    from .crypto import decrypt_secret
    from .db import engine
    from .models import ProviderConfig

    cloud: list[dict[str, Any]] = []
    local: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    try:
        with Session(engine) as session:
            rows = list(
                session.exec(
                    select(ProviderConfig)
                    .order_by(ProviderConfig.is_default.desc(), ProviderConfig.name)
                )
            )
            seen_urls.update(row.base_url.rstrip("/") for row in rows)
            for row in rows:
                if not row.enabled:
                    continue
                key = decrypt_secret(row.api_key_enc)
                if not _has_real_key(key):
                    continue
                entry = {
                    "provider_id": row.id,
                    "source": "settings",
                    "name": row.name,
                    "base_url": row.base_url.rstrip("/"),
                    "api_key": key,
                    "model": _selected_model(row),
                    "is_default": bool(row.is_default),
                }
                if _is_local_url(row.base_url):
                    local.append(entry)
                else:
                    cloud.append(entry)
    except Exception:  # noqa: BLE001
        logger.debug("provider chain DB unavailable; using env only", exc_info=True)

    # Env fallbacks if DB empty / incomplete
    settings = get_settings()
    env_candidates = [
        (
            "minimax",
            settings.effective_minimax_base_url,
            settings.effective_minimax_api_key,
            settings.effective_minimax_model,
        ),
        (
            "deepseek",
            settings.deepseek_base_url,
            settings.deepseek_api_key,
            settings.deepseek_model,
        ),
        (
            "openai_compat",
            settings.openai_compat_base_url,
            settings.openai_compat_api_key,
            settings.openai_compat_model,
        ),
    ]
    for pid, base, key, model in env_candidates:
        if not base or not _has_real_key(key):
            continue
        base_r = base.rstrip("/")
        if base_r in seen_urls:
            continue
        entry = {
            "provider_id": pid,
            "source": "environment",
            "name": pid,
            "base_url": base_r,
            "api_key": key,
            "model": model,
            "is_default": False,
        }
        if _is_local_url(base_r):
            local.append(entry)
        else:
            cloud.append(entry)
        seen_urls.add(base_r)

    return cloud + local


def _primary_route() -> dict[str, Any] | None:
    routes = list_provider_chain()
    saved = [entry for entry in routes if entry["source"] == "settings"]
    if saved:
        return next((entry for entry in saved if entry["is_default"]), saved[0])
    preferred = (get_settings().llm_default_provider or "minimax").lower()
    preferred = {"deepseek_chat": "deepseek", "openai": "openai_compat", "custom": "openai_compat"}.get(preferred, preferred)
    return next((entry for entry in routes if entry["provider_id"] == preferred), routes[0] if routes else None)


def resolve_active_provider() -> tuple[str, str, str] | None:
    entry = _primary_route()
    return (entry["base_url"], entry["api_key"], entry["model"]) if entry else None


def resolve_active_provider_info() -> dict[str, Any]:
    entry = _primary_route()
    if not entry:
        return dict(source="unavailable", name="", baseUrl="", model="", providerId=None)
    return dict(source=entry["source"], name=entry["name"], baseUrl=entry["base_url"],
                model=entry["model"], providerId=entry["provider_id"])


def _selected_model(row: Any, fallback: str | None = None) -> str:
    """Resolve a provider's current model without deleting its other options."""
    models = [str(model) for model in (row.models or []) if model]
    selected = str(getattr(row, "selected_model", "") or "")
    if selected and (not models or selected in models):
        return selected
    if models:
        return models[0]
    return fallback or get_settings().effective_minimax_model


def resolve_default_model() -> str:
    """Model used for new/retried runs, following the active Settings provider."""
    active = resolve_active_provider()
    if active:
        return active[2]
    settings = get_settings()
    provider = (settings.llm_default_provider or "minimax").lower()
    if provider in {"openai", "openai_compat", "custom"}:
        return settings.openai_compat_model
    if provider in {"deepseek", "deepseek_chat"}:
        return settings.deepseek_model
    return settings.effective_minimax_model


def _fallbacks_for(primary_base: str | None, primary_id: str | None) -> list[dict[str, Any]]:
    from . import llm_governor

    if not llm_governor.failover_enabled():
        return []
    chain = list_provider_chain()
    out: list[dict[str, Any]] = []
    for entry in chain:
        if primary_id and entry["provider_id"] == primary_id:
            continue
        if primary_base and entry["base_url"].rstrip("/") == primary_base.rstrip("/"):
            continue
        if llm_governor.provider_in_cooldown(str(entry["provider_id"])):
            continue
        out.append(entry)
        if len(out) >= 2:
            break
    return out


async def chat_completion(
    messages: list[dict[str, Any]],
    *,
    model: str | None = None,
    provider: str | None = None,
    temperature: float = 0.7,
    max_tokens: int | None = None,
    tools: list[dict[str, Any]] | None = None,
    tool_choice: str | dict[str, Any] | None = None,
    extra_body: dict[str, Any] | None = None,
    purpose: str | None = None,
    base_url: str | None = None,
    api_key: str | None = None,
    request_timeout_s: float | None = None,
    admit_priority: str = "agent_run",
    skip_admit: bool = False,
) -> Any:
    from . import llm_governor

    lease = None
    if not skip_admit:
        lease = await llm_governor.acquire(
            priority=admit_priority,  # type: ignore[arg-type]
            timeout_s=float(os.environ.get("LLM_ADMISSION_WAIT_S", "30")),
            lease_s=60.0,
        )
        if lease is None:
            st = llm_governor.status()
            retry = max(1.0, min(60.0, st.throttle_until - __import__("time").time())) if st.throttled else 1.0
            raise LlmBusyError("本地模型请求队列等待超时，请稍后重试", retry_after_s=retry)

    heartbeat = (
        asyncio.create_task(llm_governor.keep_alive(lease, owner=asyncio.current_task()))
        if lease is not None else None
    )
    provider_id: str | None = None
    try:
        gateway = get_gateway()
        if not (base_url and api_key):
            active = _primary_route()
            if not active:
                raise RuntimeError("No enabled model provider is available")
            base_url, api_key = active["base_url"], active["api_key"]
            provider_id = active["provider_id"]
            if model is None:
                model = active["model"]
            if provider_id and llm_governor.provider_in_cooldown(str(provider_id)):
                # Skip cooled primary: promote first fallback
                fbs = _fallbacks_for(base_url, str(provider_id) if provider_id else None)
                if fbs:
                    first = fbs[0]
                    base_url, api_key, model = first["base_url"], first["api_key"], first["model"]
                    provider_id = first["provider_id"]
                    fbs = fbs[1:]
                elif llm_governor.provider_in_cooldown(str(provider_id), quota=True):
                    raise RateLimitedError("模型额度已耗尽", provider_id=str(provider_id), retryable=False)
                else:
                    raise LlmBusyError(
                        "模型正在冷却等待，请稍后重试",
                        retry_after_s=15.0,
                    )
            else:
                fbs = _fallbacks_for(base_url, str(provider_id) if provider_id else None)
        else:
            fbs = _fallbacks_for(base_url, None)

        parsed = [
            ChatMessage(
                role=m["role"],  # type: ignore[arg-type]
                content=m.get("content"),
                tool_calls=m.get("tool_calls"),
                tool_call_id=m.get("tool_call_id"),
                name=m.get("name"),
                reasoning_content=m.get("reasoning_content"),
                reasoning_details=m.get("reasoning_details"),
            )
            for m in messages
        ]
        def record_quota(error: RateLimitedError) -> None:
            if error.provider_id:
                llm_governor.set_provider_cooldown(error.provider_id, error.retry_after_s, quota=True)

        from .agent_inbox import dispatch_guard
        guard = dispatch_guard.get()
        if guard:
            guard()
        try:
            result = await gateway.chat(
                parsed,
                **({"before_dispatch": guard} if guard else {}),
                **({"purpose": purpose} if purpose is not None else {}),
                provider=provider,
                model=model,
                temperature=temperature,
                max_tokens=max_tokens,
                tools=tools,
                tool_choice=tool_choice,
                extra_body=extra_body,
                base_url=base_url,
                api_key=api_key,
                request_timeout_s=request_timeout_s,
                fallbacks=fbs,
                on_quota=record_quota,
                provider_id=str(provider_id) if provider_id else None,
            )
            llm_governor.report_success()
            return result
        except RateLimitedError as exc:
            if getattr(exc, "retryable", True):
                llm_governor.report_throttle(
                    retry_after_s=exc.retry_after_s,
                    provider_id=exc.provider_id or (str(provider_id) if provider_id else None),
                )
                exc.governor_reported = True
            raise
    finally:
        try:
            if heartbeat is not None:
                heartbeat.cancel()
                with suppress(asyncio.CancelledError):
                    await heartbeat
        finally:
            if lease is not None:
                llm_governor.release(lease)
