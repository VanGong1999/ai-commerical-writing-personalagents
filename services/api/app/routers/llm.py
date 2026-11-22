from __future__ import annotations

import logging
import time
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import Field
from sqlmodel import Session

from ..db import get_session
from ..llm_service import (
    LlmBusyError,
    chat_completion,
    get_gateway,
    resolve_active_provider_info,
)
from ..models import AgentRun, Project, UsageEvent, utcnow
from ..schemas import APIModel
from ..settings import get_settings
from ..web_search import web_search_status
from ..personal_agent_output import actual_usage

router = APIRouter(tags=["llm"])
logger = logging.getLogger(__name__)


def _rate_limited_response(exc: Exception) -> JSONResponse:
    retry = float(getattr(exc, "retry_after_s", 15.0) or 15.0)
    local = isinstance(exc, LlmBusyError)
    message = str(exc)
    return JSONResponse(
        status_code=503 if local else 429,
        content={
            "detail": message,
            "code": "local_queue_timeout" if local else "provider_rate_limited",
            "source": "local" if local else "provider",
            "retryable": bool(getattr(exc, "retryable", True)),
            "governorReported": False if local else bool(getattr(exc, "governor_reported", False)),
            "providerCode": getattr(exc, "provider_code", None),
            "traceId": getattr(exc, "trace_id", None),
            "retryAfter": retry,
            "retryAfterS": retry,
            "message": message,
        },
        headers={"Retry-After": str(int(max(1, retry)))},
    )


class ChatMessageIn(APIModel):
    role: str
    content: str


class ChatCompletionIn(APIModel):
    messages: list[ChatMessageIn]
    model: Optional[str] = None
    provider: Optional[str] = None
    purpose: Optional[Literal["context_summary"]] = None
    temperature: float = 0.7
    max_tokens: Optional[int] = None
    project_id: Optional[str] = None
    agent_id: Optional[str] = None
    run_id: Optional[str] = None


class ChatCompletionOut(APIModel):
    usage_event_id: Optional[str] = None
    finish_reason: Optional[str] = None
    content: str
    model: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cache_hit_tokens: int = 0
    cache_miss_tokens: int = 0


class AgentChatMessageIn(APIModel):
    role: str
    content: Any = None
    name: Optional[str] = None
    tool_call_id: Optional[str] = None
    tool_calls: Optional[list[dict[str, Any]]] = None
    reasoning_content: Optional[str] = None
    reasoning_details: Optional[Any] = None


class AgentChatIn(APIModel):
    """OpenAI-compatible request used by the trusted local Agent Worker."""

    messages: list[AgentChatMessageIn]
    tools: Optional[list[dict[str, Any]]] = None
    tool_choice: Optional[str | dict[str, Any]] = None
    temperature: float = 0.7
    max_tokens: Optional[int] = None
    extra_body: Optional[dict[str, Any]] = None
    run_id: Optional[str] = None
    project_id: Optional[str] = None
    agent_id: Optional[str] = None


@router.get("/llm/providers")
def list_llm_providers() -> dict[str, Any]:
    settings = get_settings()
    active = resolve_active_provider_info()
    env_providers: list[dict[str, Any]] = [
        {
            "id": "minimax",
            "baseUrl": settings.effective_minimax_base_url,
            "model": settings.effective_minimax_model,
            "configured": bool(settings.effective_minimax_api_key),
        }
    ]
    if "minimax" not in settings.deepseek_base_url.lower():
        env_providers.append(
            {
                "id": "deepseek",
                "baseUrl": settings.deepseek_base_url,
                "model": settings.deepseek_model,
                "configured": bool(settings.deepseek_api_key),
            }
        )
    env_providers.append(
        {
            "id": "openai_compat",
            "baseUrl": settings.openai_compat_base_url,
            "model": settings.openai_compat_model,
            "configured": bool(
                settings.openai_compat_api_key and settings.openai_compat_base_url
            ),
        }
    )
    return {
        "default": active["name"].lower().replace(" ", "_"),
        "active": active,
        "providers": env_providers,
        "webSearch": web_search_status(),
    }


@router.post("/llm/chat", response_model=ChatCompletionOut)
async def llm_chat(
    body: ChatCompletionIn,
    session: Session = Depends(get_session),
) -> ChatCompletionOut:
    try:
        result = await chat_completion(
            [{"role": m.role, "content": m.content} for m in body.messages],
            model=body.model,
            provider=body.provider,
            purpose=body.purpose,
            temperature=body.temperature,
            max_tokens=body.max_tokens,
            admit_priority="pa_chat",
        )
    except LlmBusyError as exc:
        return _rate_limited_response(exc)  # type: ignore[return-value]
    except ValueError as exc:
        if getattr(exc, "code", None) in {"invalid_model_response", "context_length_exceeded"}:
            raise HTTPException(502, {
                "code": exc.code,
                "retryable": True,
                "message": str(exc),
                "providerCode": getattr(exc, "provider_code", None),
                "traceId": getattr(exc, "trace_id", None),
            }) from exc
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        from llm_gateway import RateLimitedError

        if isinstance(exc, RateLimitedError):
            return _rate_limited_response(exc)  # type: ignore[return-value]
        logger.exception("llm_chat upstream error")
        raise HTTPException(502, "LLM 服务暂时不可用（已记录详细日志，请稍后重试）") from exc

    from ..usage_attribution import increment_project_tokens, usage_actor
    run = session.get(AgentRun, body.run_id) if body.run_id else None
    event = UsageEvent(user_id=get_settings().demo_user_id, model=result.model,
        prompt_tokens=result.prompt_tokens, completion_tokens=result.completion_tokens,
        run_id=body.run_id, agent_id=body.agent_id or (run.agent_id if run else None))
    agent_id, bot_id = usage_actor(session, event)
    usage_event = UsageEvent(
        user_id=get_settings().demo_user_id,
        project_id=body.project_id, run_id=body.run_id,
        agent_id=agent_id, bot_id=bot_id,
        model=result.model,
        prompt_tokens=result.prompt_tokens,
        completion_tokens=result.completion_tokens,
        cache_hit_tokens=getattr(result, "cache_hit_tokens", 0) or 0,
        cache_miss_tokens=getattr(result, "cache_miss_tokens", 0) or 0,
        cost_est=0.0,
    )
    usage_id = usage_event.id
    session.add(usage_event)
    if body.project_id:
        increment_project_tokens(session, body.project_id, result.prompt_tokens + result.completion_tokens)
    session.commit()
    return ChatCompletionOut(
        usage_event_id=usage_id,
        finish_reason=((((getattr(result, "raw", None) or {}).get("choices") or [{}])[0]).get("finish_reason")),
        content=result.content,
        model=result.model,
        prompt_tokens=result.prompt_tokens,
        completion_tokens=result.completion_tokens,
        cache_hit_tokens=getattr(result, "cache_hit_tokens", 0) or 0,
        cache_miss_tokens=getattr(result, "cache_miss_tokens", 0) or 0,
    )


@router.post("/llm/agent-chat")
async def agent_chat(
    body: AgentChatIn,
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Proxy one Agent model turn through the currently selected provider.

    The browser never receives provider credentials. Reading the Settings
    provider on every turn also makes switches apply to already-running agents.
    """
    started = time.monotonic()
    from ..knowledge_colleague import run_role, selected_job
    run = session.get(AgentRun, body.run_id) if body.run_id else None
    job = selected_job(session, run) if run and run.knowledge_role_version else None
    if job:
        run_role(session, run.id, job.id, get_settings().demo_user_id)
    try:
        result = await chat_completion(
            [message.model_dump() for message in body.messages],
            temperature=body.temperature,
            max_tokens=body.max_tokens,
            tools=body.tools,
            tool_choice=body.tool_choice,
            extra_body=body.extra_body,
            request_timeout_s=get_settings().agent_llm_timeout_s,
            admit_priority="agent_run",
        )
    except LlmBusyError as exc:
        return _rate_limited_response(exc)
    except ValueError as exc:
        if getattr(exc, "code", None) in {"invalid_model_response", "context_length_exceeded"}:
            raise HTTPException(502, {
                "code": exc.code,
                "retryable": True,
                "message": str(exc),
                "providerCode": getattr(exc, "provider_code", None),
                "traceId": getattr(exc, "trace_id", None),
            }) from exc
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        from llm_gateway import RateLimitedError

        detail = str(exc).strip() or exc.__class__.__name__
        if isinstance(exc, RateLimitedError):
            return _rate_limited_response(exc)
        logger.exception("agent_chat upstream error: %s", detail)
        raise HTTPException(
            502,
            {
                "detail": "LLM 服务暂时不可用（已记录详细日志，请稍后重试）",
                "code": "upstream_error",
                "message": detail[:200],
            },
        ) from exc

    run = session.get(AgentRun, body.run_id, populate_existing=True) if body.run_id else None
    project_id = run.project_id if run else body.project_id
    if project_id and not session.get(Project, project_id):
        project_id = None
    usage = actual_usage(result)
    from ..usage_attribution import increment_project_tokens, usage_actor
    actor = UsageEvent(user_id=get_settings().demo_user_id, **usage,
        run_id=body.run_id, agent_id=body.agent_id or (run.agent_id if run else None))
    agent_id, bot_id = usage_actor(session, actor)
    usage_event = UsageEvent(
        user_id=get_settings().demo_user_id, project_id=project_id,
        run_id=body.run_id, agent_id=agent_id, bot_id=bot_id,
        duration_ms=int((time.monotonic() - started) * 1000), **usage,
    )
    usage_id = usage_event.id
    session.add(usage_event)
    if project_id:
        increment_project_tokens(session, project_id, usage["prompt_tokens"] + usage["completion_tokens"])
    if body.run_id:
        if run:
            run.model = result.model
            session.add(run)
            session.commit()
    session.commit()

    message: dict[str, Any] = {
        "role": "assistant",
        "content": result.content or None,
    }
    if result.tool_calls:
        message["tool_calls"] = result.tool_calls
    reasoning_content = getattr(result, "reasoning_content", None)
    reasoning_details = getattr(result, "reasoning_details", None)
    if reasoning_content:
        message["reasoning_content"] = reasoning_content
    if reasoning_details is not None:
        message["reasoning_details"] = reasoning_details
    return {
        "id": f"chatcmpl-{utcnow().timestamp()}",
        "object": "chat.completion",
        "usageEventId": usage_id,
        "model": result.model,
        "choices": [
            {
                "index": 0,
                "message": message,
                "finish_reason": (((getattr(result, "raw", None) or {}).get("choices") or [{}])[0].get("finish_reason")
                                  or ("tool_calls" if result.tool_calls else "stop")),
            }
        ],
        "usage": {
            "prompt_tokens": result.prompt_tokens,
            "completion_tokens": result.completion_tokens,
            "total_tokens": result.prompt_tokens + result.completion_tokens,
            "prompt_tokens_details": {
                "cached_tokens": result.cache_hit_tokens,
            },
            "prompt_cache_hit_tokens": result.cache_hit_tokens,
            "prompt_cache_miss_tokens": result.cache_miss_tokens,
        },
    }


@router.get("/llm/health")
async def llm_health() -> dict[str, Any]:
    settings = get_settings()
    ok = bool(
        settings.effective_minimax_api_key
        or settings.deepseek_api_key
        or settings.openai_compat_api_key
    )
    gateway = get_gateway()
    active = resolve_active_provider_info()
    return {
        "configured": ok,
        "defaultProvider": active["name"].lower().replace(" ", "_"),
        "active": active,
        "gateway": gateway.__class__.__name__,
    }
