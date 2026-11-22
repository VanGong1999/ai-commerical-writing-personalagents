from __future__ import annotations

import asyncio
import json
import logging
import random
import math
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from typing import Any, Literal

import httpx

from .settings import GatewaySettings

Role = Literal["system", "user", "assistant", "tool"]
logger = logging.getLogger(__name__)

_shared_client: httpx.AsyncClient | None = None


def _get_http_client() -> httpx.AsyncClient:
    """复用共享 AsyncClient（连接池 + keep-alive），避免每次调用新建连接。"""
    global _shared_client
    if _shared_client is None or _shared_client.is_closed:
        _shared_client = httpx.AsyncClient(
            timeout=httpx.Timeout(120.0, connect=15.0),
            limits=httpx.Limits(max_connections=32, max_keepalive_connections=16),
        )
    return _shared_client


def reset_http_client() -> None:
    """测试/热切换配置时释放共享 client。"""
    global _shared_client
    if _shared_client is not None:
        try:
            if _shared_client.is_closed is False and asyncio.get_event_loop().is_running():
                # 在运行中的事件循环里优雅关闭；否则直接丢弃引用。
                asyncio.create_task(_shared_client.aclose())
        except Exception:  # noqa: BLE001
            pass
    _shared_client = None


def _retryable_status(status_code: int) -> bool:
    # 529 = provider overloaded / capacity（MiniMax / Anthropic 常见），按瞬时故障重试
    return status_code in {429, 500, 502, 503, 504, 529}


def _retry_after_seconds(headers: httpx.Headers, fallback: float) -> float:
    raw = headers.get("retry-after", "")
    if not raw:
        return fallback
    try:
        value=float(raw)
        return max(0.0,value) if math.isfinite(value) else fallback
    except ValueError:
        try:
            deadline=parsedate_to_datetime(raw)
            if deadline.tzinfo is None:
                deadline=deadline.replace(tzinfo=timezone.utc)
            return max(0.0,(deadline-datetime.now(timezone.utc)).total_seconds())
        except (ValueError,TypeError,OverflowError):
            return fallback


class RateLimitedError(RuntimeError):
    """同一 Provider 重试耗尽后仍为 429/529，供上层切备用或排队。"""

    def __init__(
        self,
        message: str,
        *,
        status_code: int = 429,
        retry_after_s: float = 15.0,
        provider_id: str | None = None,
        provider_code: str | None = None,
        trace_id: str | None = None,
        retryable: bool = True,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.retry_after_s = retry_after_s
        self.provider_id = provider_id
        self.provider_code = provider_code
        self.trace_id = trace_id
        self.retryable = retryable


class InvalidModelResponse(ValueError):
    code = 'invalid_model_response'


class ContextWindowError(ValueError):
    code = 'context_length_exceeded'


_QUOTA_CODES={'1004','1008','2022','2049','2053','2056','2057','2061','2067','2068','2069'}


def _provider_error_info(response: httpx.Response) -> dict[str, Any]:
    try:
        body=response.json()
    except (ValueError,UnicodeDecodeError):
        body={}
    body=body if isinstance(body,dict) else {}
    error=body.get('error') or body.get('base_resp') or {}
    error=error if isinstance(error,dict) else {'message':str(error)}
    code=str(error.get('code') or error.get('status_code') or '')
    message=str(error.get('message') or error.get('status_msg') or '')[:400]
    # Unknown errors stay retryable; only explicit account/plan/access codes stop retry.
    return {'provider_code':code or None,'retryable':code not in _QUOTA_CODES,
            'trace_id':response.headers.get('trace_id') or response.headers.get('x-request-id') or body.get('trace_id'),
            'message':message}


def _rate_limit_error(response: httpx.Response, provider_id: str | None=None) -> RateLimitedError:
    info=_provider_error_info(response)
    message=info.pop('message')
    return RateLimitedError(f"upstream {response.status_code}: {message or 'rate limited'}",
        status_code=response.status_code,retry_after_s=_retry_after_seconds(response.headers,15.0),
        provider_id=provider_id,**info)


async def _post_with_retry(
    client: httpx.AsyncClient,
    *,
    url: str,
    headers: dict[str, str],
    json: dict[str, Any],
    timeout_s: float,
    max_retries: int = 4,
    before_dispatch: Callable[[], None] | None = None,
) -> httpx.Response:
    """POST + 瞬时故障重试：429/529 尊重 Retry-After；5xx/连接错误指数退避 + 抖动。"""
    last_error: Exception | None = None
    last_resp: httpx.Response | None = None
    for attempt in range(max_retries + 1):
        try:
            if before_dispatch:
                before_dispatch()
            resp = await client.post(url, headers=headers, json=json, timeout=timeout_s)
            last_resp = resp
            if not _provider_error_info(resp)['retryable']:
                return resp
            if _retryable_status(resp.status_code) and attempt < max_retries:
                base = 3.0 if resp.status_code == 529 else 2.0
                wait = _retry_after_seconds(resp.headers, min(base * (attempt + 1), 20.0))
                if wait > timeout_s:
                    return resp
                wait += random.uniform(0, 0.5)
                logger.warning("llm upstream %s -> %s, retry in %.1fs (attempt %d)", url, resp.status_code, wait, attempt + 1)
                await asyncio_sleep(wait)
                continue
            return resp
        except httpx.TransportError as exc:
            last_error = exc
            if attempt < max_retries:
                wait = min(2.0 * (attempt + 1), 12.0) + random.uniform(0, 0.5)
                logger.warning("llm upstream transport error %s, retry in %.1fs (attempt %d)", exc, wait, attempt + 1)
                await asyncio_sleep(wait)
                continue
            raise
    if last_resp is not None and last_resp.status_code in {429, 529}:
        wait = _retry_after_seconds(last_resp.headers, 15.0)
        raise RateLimitedError(
            f"upstream rate limited: {last_resp.status_code}",
            status_code=last_resp.status_code,
            retry_after_s=wait,
        )
    if last_error is not None:
        raise last_error
    raise RuntimeError("llm upstream request failed")


async def asyncio_sleep(seconds: float) -> None:
    await asyncio.sleep(seconds)


@dataclass
class ChatMessage:
    role: Role
    content: str | None = None
    name: str | None = None
    tool_call_id: str | None = None
    tool_calls: list[dict[str, Any]] | None = None
    # MiniMax interleaved thinking：多轮 tool call 必须回传
    reasoning_content: str | None = None
    reasoning_details: Any | None = None

    def to_openai(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"role": self.role, "content": self.content}
        if self.name:
            payload["name"] = self.name
        if self.tool_call_id:
            payload["tool_call_id"] = self.tool_call_id
        if self.tool_calls:
            payload["tool_calls"] = self.tool_calls
        if self.reasoning_content:
            payload["reasoning_content"] = self.reasoning_content
        if self.reasoning_details is not None:
            payload["reasoning_details"] = self.reasoning_details
        return payload


@dataclass
class StreamChunk:
    type: Literal["token", "tool_call", "usage", "error", "done"]
    text: str = ""
    data: dict[str, Any] = field(default_factory=dict)


@dataclass
class ChatResult:
    content: str
    model: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cache_hit_tokens: int = 0
    cache_miss_tokens: int = 0
    raw: dict[str, Any] = field(default_factory=dict)
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    reasoning_content: str | None = None
    reasoning_details: Any | None = None


def extract_cache_tokens(usage: dict[str, Any] | None) -> tuple[int, int]:
    """从 usage 里抽 (缓存命中 tokens, 缓存未命中 tokens)，跨 provider 兼容。

    - DeepSeek：`prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`
    - OpenAI：`prompt_tokens_details.cached_tokens`（未命中 = prompt - cached）
    - Anthropic：`cache_read_input_tokens` / `cache_creation_input_tokens`
    """
    if not usage:
        return 0, 0

    # DeepSeek / 部分 OpenAI 兼容
    hit = usage.get("prompt_cache_hit_tokens")
    miss = usage.get("prompt_cache_miss_tokens")
    if hit is not None or miss is not None:
        return int(hit or 0), int(miss or 0)

    # OpenAI
    details = usage.get("prompt_tokens_details") or {}
    cached = details.get("cached_tokens")
    if cached is not None:
        prompt = int(usage.get("prompt_tokens") or 0)
        return int(cached or 0), max(0, prompt - int(cached or 0))

    # Anthropic
    read = usage.get("cache_read_input_tokens")
    if read is not None:
        creation = int(usage.get("cache_creation_input_tokens") or 0)
        prompt = int(usage.get("prompt_tokens") or 0)
        return int(read or 0), max(0, prompt - int(read or 0) - creation)

    return 0, 0


class LLMGateway:
    """Thin OpenAI-compatible client with provider routing."""

    def __init__(self, settings: GatewaySettings | None = None) -> None:
        self.settings = settings or GatewaySettings()

    def resolve_provider(
        self,
        provider: str | None = None,
        *,
        base_url: str | None = None,
        api_key: str | None = None,
        model: str | None = None,
    ) -> tuple[str, str, str]:
        name = (provider or self.settings.llm_default_provider or "minimax").lower()
        if base_url and api_key:
            return (
                base_url.rstrip("/"),
                api_key,
                model or self._default_model(name),
            )
        if name in {"minimax", "mini_max"}:
            if not self.settings.minimax_api_key:
                raise ValueError("MINIMAX_API_KEY is not configured")
            return (
                self.settings.minimax_base_url.rstrip("/"),
                self.settings.minimax_api_key,
                model or self.settings.minimax_model,
            )
        if name in {"openai", "openai_compat", "custom"}:
            if not self.settings.openai_compat_base_url or not self.settings.openai_compat_api_key:
                raise ValueError("OpenAI-compatible provider is not configured")
            return (
                self.settings.openai_compat_base_url.rstrip("/"),
                self.settings.openai_compat_api_key,
                model or self.settings.openai_compat_model,
            )
        if name in {"deepseek", "deepseek_chat"}:
            if not self.settings.deepseek_api_key:
                raise ValueError("DEEPSEEK_API_KEY is not configured")
            return (
                self.settings.deepseek_base_url.rstrip("/"),
                self.settings.deepseek_api_key,
                model or self.settings.deepseek_model,
            )
        raise ValueError(f"Unknown LLM provider: {name}")

    def _default_model(self, provider: str) -> str:
        if provider in {"minimax", "mini_max"}:
            return self.settings.minimax_model
        if provider in {"openai", "openai_compat", "custom"}:
            return self.settings.openai_compat_model
        if provider in {"deepseek", "deepseek_chat"}:
            return self.settings.deepseek_model
        return self.settings.minimax_model

    def _build_chat_payload(
        self,
        messages: list[ChatMessage],
        *,
        resolved_model: str,
        url: str,
        temperature: float,
        max_tokens: int | None,
        tools: list[dict[str, Any]] | None,
        tool_choice: str | dict[str, Any] | None,
        extra_body: dict[str, Any] | None,
        purpose: str | None = None,
        stream: bool = False,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": resolved_model,
            "messages": [m.to_openai() for m in messages],
            "temperature": temperature,
            "stream": stream,
        }
        if stream:
            payload["stream_options"] = {"include_usage": True}
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens
        if tools:
            payload["tools"] = tools
        if tool_choice is not None:
            payload["tool_choice"] = tool_choice
        if extra_body:
            payload.update(extra_body)
        is_deepseek = resolved_model.lower().startswith(("deepseek-flash", "deepseek-v4"))
        if is_deepseek and purpose == "context_summary":
            payload.setdefault("thinking", {"type": "disabled"})
        # DeepSeek enables thinking by default and requires exact historical
        # reasoning on every assistant message when tools are declared. Replay
        # or cross-provider history may not contain that private metadata; keep
        # the tool facts unchanged and use its supported non-thinking mode.
        if (is_deepseek
                and payload.get("tools") and any(
                    message.get("role") == "assistant" and not message.get("reasoning_content")
                    for message in payload["messages"]
                )):
            thinking = payload.get("thinking")
            if isinstance(thinking, dict) and thinking.get("type") == "enabled":
                raise ValueError(
                    "DeepSeek 工具历史缺少 reasoning_content，无法保留启用的 thinking；"
                    "请明确关闭 thinking 后恢复，或使用包含完整推理元数据的新会话。"
                )
            if thinking is None:
                payload["thinking"] = {"type": "disabled"}
                logger.info("DeepSeek tool history lacks reasoning metadata; using non-thinking compatibility mode")
        # M3.1 counts reasoning against the output limit and otherwise defaults
        # to maximum effort. Apply per attempt/model so DeepSeek fallbacks do
        # not inherit MiniMax-specific defaults, and preserve explicit choices.
        if resolved_model.lower().startswith("minimax-m3.1"):
            payload.setdefault("reasoning_effort", self.settings.minimax_reasoning_effort)
            payload.setdefault("max_tokens", 8192)
        # 本地推理（Ollama qwen3 等）：默认关闭 thinking，否则思考耗尽 max_tokens 导致 content 为空。
        is_local = any(
            host in str(url or "") for host in ("localhost", "127.0.0.1", "0.0.0.0", "[::1]")
        )
        if is_local and "reasoning_effort" not in payload:
            payload["reasoning_effort"] = "none"
        return payload

    @staticmethod
    def _parse_chat_result(data: dict[str, Any], resolved_model: str) -> ChatResult:
        if not isinstance(data,dict) or not isinstance(data.get('choices'),list) or not data['choices']:
            raise InvalidModelResponse('模型服务未返回有效 choices 列表')
        choice = (data.get("choices") or [{}])[0]
        if not isinstance(choice,dict) or not isinstance(choice.get('message'),dict):
            raise InvalidModelResponse('模型服务未返回有效 message 对象')
        message = choice.get("message") or {}
        if message.get('content') is not None and not isinstance(message['content'],str):
            raise InvalidModelResponse('模型服务 content 必须是文本')
        usage = data.get("usage") or {}
        if not isinstance(usage,dict) or (message.get('tool_calls') is not None and not isinstance(message['tool_calls'], list)):
            raise InvalidModelResponse('模型服务 usage 或 tool_calls 字段格式无效')
        for call in message.get('tool_calls') or []:
            fn = call.get('function') if isinstance(call, dict) else None
            if (not isinstance(fn, dict) or not isinstance(fn.get('name'), str)
                    or not fn['name'] or not isinstance(fn.get('arguments'), (dict, str))):
                raise InvalidModelResponse('模型服务工具调用结构无效')
        try:
            cache_hit, cache_miss = extract_cache_tokens(usage)
            prompt_tokens=int(usage.get('prompt_tokens') or 0)
            completion_tokens=int(usage.get('completion_tokens') or 0)
        except (ValueError,TypeError,AttributeError,OverflowError) as error:
            raise InvalidModelResponse('模型服务 Token 用量字段格式无效') from error
        content = message.get("content") or ""
        return ChatResult(
            content=content,
            model=data.get("model") or resolved_model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            cache_hit_tokens=cache_hit,
            cache_miss_tokens=cache_miss,
            raw=data,
            tool_calls=list(message.get("tool_calls") or []),
            reasoning_content=message.get("reasoning_content") or message.get("reasoning") or None,
            reasoning_details=message.get("reasoning_details"),
        )

    async def chat(
        self,
        messages: list[ChatMessage],
        *,
        provider: str | None = None,
        model: str | None = None,
        temperature: float = 0.7,
        max_tokens: int | None = None,
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str | dict[str, Any] | None = None,
        extra_body: dict[str, Any] | None = None,
        purpose: str | None = None,
        base_url: str | None = None,
        api_key: str | None = None,
        request_timeout_s: float | None = None,
        fallbacks: list[dict[str, Any]] | None = None,
        provider_id: str | None = None,
        on_quota: Callable[[RateLimitedError], None] | None = None,
        before_dispatch: Callable[[], None] | None = None,
    ) -> ChatResult:
        """Chat with optional failover chain.

        `fallbacks`: list of {base_url, api_key, model, provider_id?} tried after
        RateLimitedError on the primary (at most 2 extra providers).
        """
        candidates: list[dict[str, Any]] = [
            {
                "base_url": base_url,
                "api_key": api_key,
                "model": model,
                "provider": provider,
                "provider_id": provider_id or provider or "primary",
            }
        ]
        for fb in fallbacks or []:
            if not fb:
                continue
            candidates.append(
                {
                    "base_url": fb.get("base_url") or fb.get("baseUrl"),
                    "api_key": fb.get("api_key") or fb.get("apiKey"),
                    "model": fb.get("model"),
                    "provider": fb.get("provider"),
                    "provider_id": fb.get("provider_id") or fb.get("providerId") or fb.get("id"),
                }
            )

        timeout_s = request_timeout_s or self.settings.request_timeout_s
        client = _get_http_client()
        last_rate: RateLimitedError | None = None
        tried = 0
        for cand in candidates:
            if tried > 2 and cand is not candidates[0]:
                # primary + at most 2 backups
                break
            if tried > 0 and not (cand.get("base_url") and cand.get("api_key")):
                continue
            try:
                url, key, resolved_model = self.resolve_provider(
                    cand.get("provider"),
                    base_url=cand.get("base_url"),
                    api_key=cand.get("api_key"),
                    model=cand.get("model"),
                )
            except ValueError:
                continue
            pid = str(cand.get("provider_id") or url)
            payload = self._build_chat_payload(
                messages,
                resolved_model=resolved_model,
                url=url,
                temperature=temperature,
                max_tokens=max_tokens,
                tools=tools,
                tool_choice=tool_choice,
                extra_body=extra_body,
                purpose=purpose,
                stream=False,
            )
            tried += 1
            try:
                resp = await _post_with_retry(
                    client,
                    **({"before_dispatch": before_dispatch} if before_dispatch else {}),
                    url=f"{url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {key}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                    timeout_s=timeout_s,
                )
                if resp.status_code in {429, 529} or not _provider_error_info(resp)['retryable']:
                    raise _rate_limit_error(resp,pid)
                if resp.status_code in {400,413}:
                    info=_provider_error_info(resp)
                    marker=(str(info['provider_code'])+' '+info['message']).lower()
                    if resp.status_code==413 or any(term in marker for term in (
                        'context_length_exceeded','maximum context length','context window','too many input tokens','input is too long',
                    )):
                        error=ContextWindowError(info['message'] or '模型上下文超过允许窗口')
                        error.provider_code=info['provider_code']
                        error.trace_id=info['trace_id']
                        raise error
                resp.raise_for_status()
                try:
                    data=resp.json()
                except (ValueError,UnicodeDecodeError) as error:
                    raise InvalidModelResponse('模型服务返回了无法解析的 JSON 响应') from error
                result = self._parse_chat_result(data, resolved_model)
                if tried > 1:
                    logger.warning(
                        "llm provider failover succeeded via %s (attempt %d)",
                        pid,
                        tried,
                    )
                    result.raw = {
                        **(result.raw or {}),
                        "_failover": {"providerId": pid, "attempt": tried},
                    }
                return result
            except RateLimitedError as exc:
                exc.provider_id = exc.provider_id or pid
                if not exc.retryable and on_quota is not None:
                    on_quota(exc)
                last_rate = exc
                logger.warning(
                    "llm provider %s rate-limited; trying next fallback if any",
                    pid,
                )
                continue
        if last_rate is not None:
            raise last_rate
        raise RuntimeError("llm chat failed: no usable provider")

    async def chat_stream(
        self,
        messages: list[ChatMessage],
        *,
        provider: str | None = None,
        model: str | None = None,
        temperature: float = 0.7,
        max_tokens: int | None = None,
        extra_body: dict[str, Any] | None = None,
        base_url: str | None = None,
        api_key: str | None = None,
        request_timeout_s: float | None = None,
        fallbacks: list[dict[str, Any]] | None = None,
        provider_id: str | None = None,
    ) -> AsyncIterator[StreamChunk]:
        """Stream tokens; on 429/5xx before first token, fall back to non-stream chat once."""
        url, key, resolved_model = self.resolve_provider(
            provider, base_url=base_url, api_key=api_key, model=model
        )
        payload = self._build_chat_payload(
            messages,
            resolved_model=resolved_model,
            url=url,
            temperature=temperature,
            max_tokens=max_tokens,
            tools=None,
            tool_choice=None,
            extra_body=extra_body,
            stream=True,
        )

        timeout_s = request_timeout_s or self.settings.request_timeout_s
        client = _get_http_client()
        emitted = False
        finished = False
        try:
            async with client.stream(
                "POST",
                f"{url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {key}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=timeout_s,
            ) as resp:
                if resp.is_error:
                    body = bytearray()
                    async for block in resp.aiter_bytes(chunk_size=4096):
                        body.extend(block)
                        if len(body) >= 16384:
                            break
                    headers = {name: resp.headers[name] for name in
                               ("retry-after", "trace_id", "x-request-id") if name in resp.headers}
                    buffered = httpx.Response(resp.status_code, headers=headers, content=bytes(body))
                    error = _rate_limit_error(buffered, provider_id or provider)
                    if not error.retryable or resp.status_code in {429, 500, 502, 503, 504, 529}:
                        raise error
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line:
                        continue
                    if line.startswith("data:"):
                        data_str = line[5:].strip()
                    elif line.lstrip().startswith("{"):
                        data_str = line.strip()
                    else:
                        continue
                    if not data_str:
                        continue
                    if data_str == "[DONE]":
                        if not finished:
                            raise InvalidModelResponse("stream ended without a finish reason")
                        yield StreamChunk(type="done")
                        return
                    try:
                        data = json.loads(data_str)
                    except json.JSONDecodeError as exc:
                        raise InvalidModelResponse("invalid stream JSON") from exc
                    if isinstance(data, dict) and ("error" in data or "base_resp" in data):
                        error = _rate_limit_error(httpx.Response(200, json=data), provider_id or provider)
                        if not error.retryable:
                            raise error
                    if data.get("usage"):
                        emitted = True
                        yield StreamChunk(type="usage", data=data["usage"])
                    choices = data.get("choices") or []
                    if not choices:
                        continue
                    reason = choices[0].get("finish_reason")
                    if reason is not None:
                        if reason not in {"stop", "tool_calls", "function_call"}:
                            raise InvalidModelResponse(f"incomplete stream: {reason}")
                        finished = True
                    delta = choices[0].get("delta") or {}
                    content = delta.get("content")
                    if content:
                        emitted = True
                        yield StreamChunk(type="token", text=content)
                    if delta.get("tool_calls"):
                        emitted = True
                        yield StreamChunk(
                            type="tool_call", data={"tool_calls": delta["tool_calls"]}
                        )
            if not finished:
                raise InvalidModelResponse("stream ended prematurely")
            yield StreamChunk(type="done")
            return
        except (RateLimitedError, httpx.HTTPStatusError, httpx.TransportError) as exc:
            if emitted:
                raise
            logger.warning(
                "chat_stream failed (%s); falling back to non-stream chat",
                exc,
            )
            if isinstance(exc, RateLimitedError) and not exc.retryable:
                eligible = [fb for fb in (fallbacks or []) if fb and
                            (fb.get("base_url") or fb.get("baseUrl")) and
                            (fb.get("api_key") or fb.get("apiKey"))][:2]
                if not eligible:
                    raise
                first, *fallbacks = eligible
                base_url = first.get("base_url") or first.get("baseUrl")
                api_key = first.get("api_key") or first.get("apiKey")
                model = first.get("model")
                provider = first.get("provider")
                provider_id = first.get("provider_id") or first.get("providerId") or first.get("id")
            result = await self.chat(
                messages,
                provider=provider,
                model=model,
                temperature=temperature,
                max_tokens=max_tokens,
                extra_body=extra_body,
                base_url=base_url,
                api_key=api_key,
                request_timeout_s=request_timeout_s,
                fallbacks=fallbacks,
                provider_id=provider_id,
            )
            reason = result.raw["choices"][0].get("finish_reason")
            if reason not in {"stop", "tool_calls", "function_call"}:
                raise InvalidModelResponse("incomplete fallback response")
            if result.tool_calls:
                yield StreamChunk(type="tool_call", data={"tool_calls": result.tool_calls})
            if result.content:
                yield StreamChunk(type="token", text=result.content)
            if result.prompt_tokens or result.completion_tokens:
                yield StreamChunk(
                    type="usage",
                    data={
                        "prompt_tokens": result.prompt_tokens,
                        "completion_tokens": result.completion_tokens,
                    },
                )
            yield StreamChunk(type="done")

    async def embed(
        self,
        texts: list[str],
        *,
        model: str | None = None,
    ) -> list[list[float]]:
        base = (self.settings.embedding_base_url or self.settings.minimax_base_url).rstrip("/")
        key = self.settings.embedding_api_key or self.settings.minimax_api_key
        if not key:
            raise ValueError("Embedding API key is not configured")
        emb_model = model or self.settings.embedding_model
        client = _get_http_client()
        resp = await _post_with_retry(
            client,
            url=f"{base}/embeddings",
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
            json={"model": emb_model, "input": texts},
            timeout_s=self.settings.request_timeout_s,
        )
        resp.raise_for_status()
        data = resp.json()
        items = sorted(data.get("data") or [], key=lambda x: x.get("index", 0))
        return [list(item.get("embedding") or []) for item in items]
