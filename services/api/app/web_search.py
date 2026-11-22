from __future__ import annotations

from .usage_attribution import record_model_usage

import logging
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

import httpx

from .llm_service import chat_completion
from .settings import get_settings

logger = logging.getLogger(__name__)

DISABLED_MESSAGE = (
    "联网搜索未启用。请在「设置 → 模型 Provider」中填写支持联网搜索的模型"
    "（DeepSeek / MiniMax / GLM / Kimi）的 URL 与 API Key 并设为默认；"
    "也可以配置 BOCHA_API_KEY / SERPER_API_KEY 作为外部搜索源。"
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _disabled(query: str, *, note: str | None = None) -> dict[str, Any]:
    summary = DISABLED_MESSAGE if note is None else f"{DISABLED_MESSAGE}（{note}）"
    return {
        "query": query,
        "enabled": False,
        "results": [],
        "summary": summary,
        "source": "disabled",
        "fetchedAt": _now(),
    }


def _error(query: str, exc: Exception) -> dict[str, Any]:
    logger.exception("web_search failed")
    return {
        "query": query,
        "enabled": True,
        "results": [],
        "summary": f"联网搜索失败：{exc}",
        "source": "error",
        "fetchedAt": _now(),
    }


def _classify(base_url: str) -> str:
    host = (urlparse(base_url).hostname or "").lower()
    if "deepseek" in host:
        return "deepseek"
    if "bigmodel" in host or "zhipu" in host or "chatglm" in host:
        return "glm"
    if "minimax" in host:
        return "minimax"
    if "moonshot" in host or "kimi" in host:
        return "kimi"
    return "generic"


def _provider_from_row(row: Any) -> dict[str, Any] | None:
    from .crypto import decrypt_secret

    key = decrypt_secret(row.api_key_enc)
    if not key or key == "demo":
        return None
    model = getattr(row, "selected_model", None) or (
        row.models[0] if row.models else get_settings().effective_minimax_model
    )
    return {
        "base_url": row.base_url.rstrip("/"),
        "api_key": key,
        "model": model,
        "kind": _classify(row.base_url),
        "is_default": bool(row.is_default),
    }


def _search_provider() -> dict[str, Any] | None:
    """Pick the provider best suited for built-in web search.

    Prefers the default enabled provider when it supports built-in search,
    otherwise any enabled provider that does. A local/custom model used for
    chat must not block web search from a search-capable provider or env key.
    """
    from sqlmodel import Session, select

    from .db import engine
    from .models import ProviderConfig

    with Session(engine) as session:
        rows = list(
            session.exec(
                select(ProviderConfig).where(ProviderConfig.enabled == True)  # noqa: E712
            )
        )

    candidates = [p for row in rows if (p := _provider_from_row(row))]
    for p in candidates:
        if p["is_default"] and p["kind"] != "generic":
            return p
    for p in candidates:
        if p["kind"] != "generic":
            return p

    s = get_settings()
    if s.effective_minimax_api_key:
        return {
            "base_url": s.effective_minimax_base_url,
            "api_key": s.effective_minimax_api_key,
            "model": s.effective_minimax_model,
            "kind": "minimax",
        }
    if s.deepseek_api_key:
        return {
            "base_url": s.deepseek_base_url.rstrip("/"),
            "api_key": s.deepseek_api_key,
            "model": s.deepseek_model,
            "kind": "deepseek",
        }
    if s.openai_compat_api_key and s.openai_compat_base_url:
        kind = _classify(s.openai_compat_base_url)
        if kind != "generic":
            return {
                "base_url": s.openai_compat_base_url.rstrip("/"),
                "api_key": s.openai_compat_api_key,
                "model": s.openai_compat_model,
                "kind": kind,
            }
    return None


def _deepseek_fallback_provider() -> dict[str, Any] | None:
    """Read an independently configured fallback without changing chat defaults."""
    from sqlmodel import Session, select
    from .db import engine
    from .models import ProviderConfig

    with Session(engine) as session:
        rows = session.exec(select(ProviderConfig).where(ProviderConfig.enabled == True)).all()  # noqa: E712
    for row in rows:
        if _classify(row.base_url) == "deepseek":
            provider = _provider_from_row(row)
            if provider:
                return provider
    settings = get_settings()
    if settings.deepseek_api_key:
        return {"base_url": settings.deepseek_base_url.rstrip("/"),
                "api_key": settings.deepseek_api_key, "model": settings.deepseek_model,
                "kind": "deepseek"}
    return None


def web_search_status() -> dict[str, Any]:
    """Sync status used by settings/status endpoints (no network calls)."""
    prov = _search_provider()
    if prov:
        return {
            "enabled": True,
            "source": prov["kind"],
            "provider": prov["model"],
            "baseUrl": prov["base_url"],
        }
    s = get_settings()
    if s.bocha_api_key or s.serper_api_key:
        return {
            "enabled": True,
            "source": (s.web_search_provider or "bocha").lower(),
            "provider": None,
            "baseUrl": None,
        }
    return {"enabled": False, "source": "disabled", "provider": None, "baseUrl": None}


async def web_search(
    query: str,
    *,
    max_results: int = 5,
) -> dict[str, Any]:
    """Search the web via the configured OpenAI-compatible provider.

    Uses the provider's built-in server-side search (DeepSeek / MiniMax / GLM /
    Kimi). Bocha / Serper remain as an optional external fallback. When nothing
    usable is configured we return an honest `enabled: false` result instead of
    pretending to search with model knowledge.
    """
    max_results = max(1, min(int(max_results), 10))
    prov = _search_provider()
    if prov is None:
        settings = get_settings()
        if settings.bocha_api_key or settings.serper_api_key:
            return await _external_search(query, max_results)
        return _disabled(query)

    try:
        search = {
            "deepseek": _deepseek_search, "glm": _glm_search,
            "minimax": _minimax_search, "kimi": _kimi_search,
        }.get(prov["kind"])
        result = await search(prov, query, max_results) if search else _disabled(query)
        if not result.get("results") and result.get("enabled"):
            result = _unverified(query, prov["kind"])
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        result = (_disabled(query, note=f"当前 Provider 不支持内置联网搜索（HTTP {status}）")
                  if status in (400, 404, 405) else _error(query, exc))
    except Exception as exc:  # noqa: BLE001
        result = _error(query, exc)

    if not result.get("results"):
        settings = get_settings()
        if settings.bocha_api_key or settings.serper_api_key:
            try:
                fallback = await _external_search(query, max_results)
                if fallback.get("results"):
                    fallback["fallbackFrom"] = prov["kind"]
                    fallback["fallbackReason"] = "Primary search unavailable or returned no verifiable sources"
                    fallback["availability"] = "available"
                    return fallback
                result.setdefault("fallbackAttempts", []).append(
                    {"source": fallback.get("source"), "availability": "unverified"})
            except Exception:  # noqa: BLE001
                logger.warning("External search fallback failed", exc_info=True)
                result.setdefault("fallbackAttempts", []).append(
                    {"source": "external", "availability": "error"})
    if not result.get("results") and prov["kind"] == "minimax":
        try:
            fallback_provider = _deepseek_fallback_provider()
            if fallback_provider:
                fallback = await _deepseek_search(fallback_provider, query, max_results)
                # The legacy DeepSeek tool path can return uncited model text.
                if fallback.get("results"):
                    fallback["fallbackFrom"] = prov["kind"]
                    fallback["fallbackReason"] = "MiniMax search unavailable or returned no verifiable sources"
                    fallback["availability"] = "available"
                    return fallback
                result.setdefault("fallbackAttempts", []).append(
                    {"source": "deepseek", "availability": "unverified"})
        except Exception:  # noqa: BLE001
            logger.warning("DeepSeek search fallback failed", exc_info=True)
            result.setdefault("fallbackAttempts", []).append(
                {"source": "deepseek", "availability": "error"})
    return result


def _root_url(base_url: str) -> str:
    b = base_url.rstrip("/")
    if b.endswith("/v1"):
        return b[:-3].rstrip("/")
    return b


def _headers(api_key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}


async def _deepseek_search(
    prov: dict[str, Any], query: str, max_results: int
) -> dict[str, Any]:
    try:
        results = await _deepseek_search_endpoint(prov, query, max_results)
    except Exception as exc:  # noqa: BLE001
        logger.warning("DeepSeek /v1/tools/search failed, falling back to tool: %s", exc)
        return await _deepseek_tool_search(prov, query)

    summary = await _summarize_results(query, results)
    return {
        "query": query,
        "enabled": True,
        "results": results,
        "summary": summary,
        "source": "deepseek",
        "fetchedAt": _now(),
    }


async def _deepseek_search_endpoint(
    prov: dict[str, Any], query: str, max_results: int
) -> list[dict[str, Any]]:
    endpoint = f"{_root_url(prov['base_url'])}/v1/tools/search"
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            endpoint,
            headers=_headers(prov["api_key"]),
            json={"query": query, "count": max_results, "need_content": False},
        )
        resp.raise_for_status()
        data = resp.json()

    out: list[dict[str, Any]] = []
    for item in (data.get("results") or []):
        parsed = urlparse(item.get("url") or "")
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            continue
        if len(out) >= max_results:
            break
        out.append(
            {
                "title": item.get("title") or "",
                "url": item.get("url") or "",
                "snippet": item.get("snippet") or item.get("summary") or "",
            }
        )
    return out


async def _deepseek_tool_search(prov: dict[str, Any], query: str) -> dict[str, Any]:
    result = await chat_completion(
        [{"role": "user", "content": query}],
        model=prov["model"],
        base_url=prov["base_url"],
        api_key=prov["api_key"],
        tools=[{"type": "deepseek_web_search"}],
        temperature=0.3,
        max_tokens=1000,
    )
    record_model_usage(result, agent_id="system.web_search")
    summary = result.content or "DeepSeek 联网搜索未返回内容。"
    return {
        "query": query,
        "enabled": True,
        "results": [],
        "summary": summary,
        "source": "deepseek",
        "fetchedAt": _now(),
    }


async def _glm_search(
    prov: dict[str, Any], query: str, max_results: int
) -> dict[str, Any]:
    tools = [
        {
            "type": "web_search",
            "web_search": {
                "enable": True,
                "search_result": True,
                "count": str(max_results),
            },
        }
    ]
    result = await chat_completion(
        [{"role": "user", "content": query}],
        model=prov["model"],
        base_url=prov["base_url"],
        api_key=prov["api_key"],
        tools=tools,
        temperature=0.3,
        max_tokens=1000,
    )
    record_model_usage(result, agent_id="system.web_search")
    summary = result.content or "GLM 联网搜索未返回内容。"
    return {
        "query": query,
        "enabled": True,
        "results": [],
        "summary": summary,
        "source": "glm",
        "fetchedAt": _now(),
    }


def _unverified(query: str, source: str) -> dict[str, Any]:
    return {
        "query": query, "enabled": True, "results": [],
        "summary": "搜索服务未返回可核验来源，当前信息未核验；不能据此判断最新动态或趋势。",
        "source": source, "availability": "unverified", "fetchedAt": _now(),
    }


def _response_sources(data: dict[str, Any], max_results: int) -> list[dict[str, Any]]:
    """Read provider search evidence only; never promote URLs from generated text."""
    citations: list[dict[str, Any]] = []
    sources: list[dict[str, Any]] = []
    for item in data.get("output") or []:
        if item.get("type") == "web_search_call" and item.get("status") == "completed":
            action = item.get("action") or {}
            sources.extend(action.get("sources") or [])
        if item.get("type") == "message":
            for part in item.get("content") or []:
                for annotation in part.get("annotations") or []:
                    if annotation.get("type") == "url_citation":
                        citations.append(annotation.get("url_citation") or annotation)
    # Citations carry titles and snippets; action sources may only contain URLs.
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in citations + sources:
        url = item.get("url") or ""
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or url in seen:
            continue
        seen.add(url)
        out.append({
            "title": str(item.get("title") or parsed.hostname)[:300],
            "url": url,
            "snippet": str(item.get("content") or item.get("snippet") or "")[:800],
        })
        if len(out) >= max(1, min(max_results, 10)):
            break
    return out


async def _minimax_search(
    prov: dict[str, Any], query: str, max_results: int
) -> dict[str, Any]:
    endpoint = f"{prov['base_url'].rstrip('/')}/responses"
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            endpoint,
            headers=_headers(prov["api_key"]),
            json={
                "model": prov["model"],
                "input": query,
                "instructions": "必须联网检索并提供真实来源。只简洁概括检索发现，不超过600字；无来源时明确说明无法核验。",
                "tools": [{"type": "web_search"}],
                "include": ["web_search_call.action.sources"],
                "max_output_tokens": 1200,
            },
        )
        resp.raise_for_status()
        data = resp.json()

    results = _response_sources(data, max_results)
    if not results:
        return _unverified(query, "minimax")
    # Keep the summary tied to the sources retained in this bounded tool result.
    summary = "\n".join(f"- {r['title']}: {r['snippet'][:220]} ({r['url']})" for r in results)[:1800]
    return {
        "query": query, "enabled": True, "results": results,
        "summary": summary, "source": "minimax", "availability": "available",
        "fetchedAt": _now(),
    }


async def _kimi_search(
    prov: dict[str, Any], query: str, _max_results: int
) -> dict[str, Any]:
    base = prov["base_url"].rstrip("/")
    formula = "moonshot/web-search:latest"
    headers = _headers(prov["api_key"])
    async with httpx.AsyncClient(timeout=60.0) as client:
        tools_resp = await client.get(
            f"{base}/formulas/{formula}/tools", headers=headers
        )
        tools_resp.raise_for_status()
        tools = tools_resp.json().get("tools") or []

        messages: list[dict[str, Any]] = [{"role": "user", "content": query}]
        first = await client.post(
            f"{base}/chat/completions",
            headers=headers,
            json={"model": prov["model"], "messages": messages, "tools": tools},
        )
        first.raise_for_status()
        message = ((first.json().get("choices") or [{}])[0].get("message") or {})
        tool_calls = message.get("tool_calls") or []

        if not tool_calls:
            summary = message.get("content") or "Kimi 联网搜索未返回内容。"
        else:
            messages.append(
                {
                    "role": "assistant",
                    "content": message.get("content"),
                    "tool_calls": tool_calls,
                }
            )
            for tc in tool_calls:
                fn = tc["function"]
                fiber = await client.post(
                    f"{base}/formulas/{formula}/fibers",
                    headers=headers,
                    json={"name": fn["name"], "arguments": fn["arguments"]},
                )
                fiber.raise_for_status()
                ctx = fiber.json().get("context") or {}
                output = ctx.get("output") or ctx.get("encrypted_output") or ""
                messages.append(
                    {"role": "tool", "tool_call_id": tc["id"], "content": output}
                )
            second = await client.post(
                f"{base}/chat/completions",
                headers=headers,
                json={"model": prov["model"], "messages": messages, "tools": tools},
            )
            second.raise_for_status()
            summary = (
                ((second.json().get("choices") or [{}])[0].get("message") or {}).get(
                    "content"
                )
                or "Kimi 联网搜索未返回内容。"
            )

    return {
        "query": query,
        "enabled": True,
        "results": [],
        "summary": summary,
        "source": "kimi",
        "fetchedAt": _now(),
    }


async def _external_search(query: str, max_results: int) -> dict[str, Any]:
    settings = get_settings()
    provider = (settings.web_search_provider or "bocha").lower()
    results: list[dict[str, Any]] = []
    source = provider

    if provider == "serper" and settings.serper_api_key:
        results = await _serper_search(query, settings.serper_api_key, max_results)
    elif settings.bocha_api_key:
        results = await _bocha_search(query, settings.bocha_api_key, max_results)
        source = "bocha"
    elif settings.serper_api_key:
        results = await _serper_search(query, settings.serper_api_key, max_results)
        source = "serper"
    else:
        return _disabled(query)

    summary = await _summarize_results(query, results)
    return {
        "query": query,
        "enabled": True,
        "results": results,
        "summary": summary,
        "source": source,
        "fetchedAt": _now(),
    }


async def _bocha_search(
    query: str, api_key: str, max_results: int
) -> list[dict[str, Any]]:
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            "https://api.bochaai.com/v1/web-search",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={"query": query, "count": max_results},
        )
        resp.raise_for_status()
        data = resp.json()
    items = data.get("data", {}).get("webPages", {}).get("value") or data.get("results") or []
    out: list[dict[str, Any]] = []
    for item in items[:max_results]:
        out.append(
            {
                "title": item.get("name") or item.get("title") or "",
                "url": item.get("url") or item.get("link") or "",
                "snippet": item.get("snippet") or item.get("summary") or "",
            }
        )
    return out


async def _serper_search(
    query: str, api_key: str, max_results: int
) -> list[dict[str, Any]]:
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            "https://google.serper.dev/search",
            headers={"X-API-KEY": api_key, "Content-Type": "application/json"},
            json={"q": query, "num": max_results},
        )
        resp.raise_for_status()
        data = resp.json()
    out: list[dict[str, Any]] = []
    for item in (data.get("organic") or [])[:max_results]:
        out.append(
            {
                "title": item.get("title") or "",
                "url": item.get("link") or "",
                "snippet": item.get("snippet") or "",
            }
        )
    return out


async def _summarize_results(query: str, results: list[dict[str, Any]]) -> str:
    if not results:
        return "未检索到结果。"
    bullets = "\n".join(
        f"- {r.get('title')}: {r.get('snippet')} ({r.get('url')})" for r in results
    )
    try:
        result = await chat_completion(
            [
                {
                    "role": "system",
                    "content": "你是题材调研助手。根据检索结果用中文简洁总结，标明不确定处，勿编造链接。",
                },
                {"role": "user", "content": f"问题：{query}\n\n检索结果：\n{bullets}"},
            ],
            temperature=0.3,
            max_tokens=800,
        )
        record_model_usage(result, agent_id="system.web_search")
        return result.content
    except Exception:  # noqa: BLE001
        return bullets
