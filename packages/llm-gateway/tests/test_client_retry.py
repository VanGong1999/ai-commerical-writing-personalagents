"""上游瞬时故障重试：503/429 与连接错误不直接抛给调用方。"""

from __future__ import annotations

import httpx
import pytest

from llm_gateway import ChatMessage, LLMGateway
from llm_gateway import client as client_module
from llm_gateway.settings import GatewaySettings


@pytest.mark.asyncio
async def test_subscription_quota_is_not_retried_and_preserves_provider_trace(monkeypatch):
    calls=[]
    def handler(request):
        calls.append(request)
        return httpx.Response(429,headers={'trace_id':'trace-quota'},json={
            'error':{'code':2056,'message':'M Plan window resource exhausted'},
        })
    client_module._shared_client=httpx.AsyncClient(transport=httpx.MockTransport(handler))
    monkeypatch.setattr(client_module,'asyncio_sleep',lambda seconds: _no_wait())
    try:
        from llm_gateway import RateLimitedError
        with pytest.raises(RateLimitedError) as caught:
            await LLMGateway(GatewaySettings(minimax_api_key='test-key')).chat([ChatMessage(role='user',content='ping')],provider='minimax')
        assert len(calls)==1
        assert caught.value.retryable is False
        assert caught.value.provider_code=='2056'
        assert caught.value.trace_id=='trace-quota'
    finally:
        await client_module._shared_client.aclose()
        client_module._shared_client=None


async def _no_wait():
    pass


def test_retry_after_is_not_shortened_below_provider_deadline():
    assert client_module._retry_after_seconds(httpx.Headers({'Retry-After':'60'}),15)==60


@pytest.mark.parametrize('data',[{},[],{'choices':[{'message':{'content':123}}]},
    {'choices':[{'message':{'content':'ok'}}],'usage':{'prompt_tokens':'oops'}},
    {'choices':[{'message':{'content':'ok'}}],'usage':[1]},
    {'choices':[{'message':{'tool_calls':7}}]},
])
def test_invalid_provider_envelopes_have_a_repairable_protocol_code(data):
    with pytest.raises(ValueError) as caught:
        LLMGateway._parse_chat_result(data,'MiniMax-M3.1-Flash')
    assert caught.value.code=='invalid_model_response'


@pytest.mark.asyncio
async def test_http_context_overflow_preserves_repair_code():
    client_module._shared_client=httpx.AsyncClient(transport=httpx.MockTransport(lambda request:
        httpx.Response(400,json={'error':{'code':'context_length_exceeded','message':'maximum context length exceeded'}})))
    try:
        with pytest.raises(ValueError) as caught:
            await LLMGateway(GatewaySettings(minimax_api_key='test-key')).chat([ChatMessage(role='user',content='ping')],provider='minimax')
        assert caught.value.code=='context_length_exceeded'
    finally:
        await client_module._shared_client.aclose()
        client_module._shared_client=None


@pytest.mark.asyncio
async def test_chat_retries_on_503_then_succeeds():
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if len(calls) == 1:
            return httpx.Response(503, json={"error": "temporarily unavailable"})
        return httpx.Response(
            200,
            json={
                "model": "MiniMax-M3.1-Flash",
                "choices": [{"message": {"role": "assistant", "content": "ok"}}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 2},
            },
        )

    client_module._shared_client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        limits=httpx.Limits(max_connections=4),
    )
    try:
        gateway = LLMGateway(GatewaySettings(minimax_api_key="test-key"))
        result = await gateway.chat(
            [ChatMessage(role="user", content="ping")], provider="minimax"
        )
        assert result.content == "ok"
        assert len(calls) == 2
    finally:
        await client_module._shared_client.aclose()
        client_module._shared_client = None


@pytest.mark.asyncio
async def test_chat_retries_on_529_then_succeeds():
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if len(calls) <= 2:
            return httpx.Response(529, json={"error": "overloaded"})
        return httpx.Response(
            200,
            json={
                "model": "MiniMax-M3.1-Flash",
                "choices": [{"message": {"role": "assistant", "content": "ok529"}}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 2},
            },
        )

    client_module._shared_client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        limits=httpx.Limits(max_connections=4),
    )
    try:
        gateway = LLMGateway(GatewaySettings(minimax_api_key="test-key"))
        result = await gateway.chat(
            [ChatMessage(role="user", content="ping")], provider="minimax"
        )
        assert result.content == "ok529"
        assert len(calls) == 3
    finally:
        await client_module._shared_client.aclose()
        client_module._shared_client = None


@pytest.mark.asyncio
async def test_chat_retries_on_connect_error_then_succeeds():
    attempts = {"count": 0}

    class FlakyTransport(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request):
            attempts["count"] += 1
            if attempts["count"] == 1:
                raise httpx.ConnectError("connection reset", request=request)
            return httpx.Response(
                200,
                json={
                    "model": "test",
                    "choices": [{"message": {"role": "assistant", "content": "ok2"}}],
                    "usage": {"prompt_tokens": 1, "completion_tokens": 1},
                },
            )

    client_module._shared_client = httpx.AsyncClient(
        transport=FlakyTransport(), limits=httpx.Limits(max_connections=4)
    )
    try:
        gateway = LLMGateway(GatewaySettings(minimax_api_key="test-key"))
        result = await gateway.chat(
            [ChatMessage(role="user", content="ping")], provider="minimax"
        )
        assert result.content == "ok2"
        assert attempts["count"] == 2
    finally:
        await client_module._shared_client.aclose()
        client_module._shared_client = None


@pytest.mark.asyncio
@pytest.mark.parametrize("finish,complete", [("", False), ("length", False), ("stop", True)])
async def test_stream_requires_valid_finish(finish, complete, monkeypatch):
    import json
    data = json.dumps({"choices": [{"delta": {"content": "hello"}, "finish_reason": finish or None}]})
    transport = httpx.MockTransport(lambda request: httpx.Response(200, text=f"data: {data}\n\n"))
    async with httpx.AsyncClient(transport=transport) as client:
        monkeypatch.setattr(client_module, "_shared_client", client)
        gateway = LLMGateway(GatewaySettings(minimax_api_key="test-key"))
        stream = gateway.chat_stream([ChatMessage(role="user", content="hi")], provider="minimax")
        if complete:
            assert [chunk.type async for chunk in stream] == ["token", "done"]
        else:
            with pytest.raises(client_module.InvalidModelResponse):
                _ = [chunk async for chunk in stream]


@pytest.mark.asyncio
async def test_disconnect_after_token_does_not_append_fallback(monkeypatch):
    class Interrupted(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'
            raise httpx.ReadError("disconnected")
    calls = []
    def respond(request):
        calls.append(request)
        return httpx.Response(200, stream=Interrupted())
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        monkeypatch.setattr(client_module, "_shared_client", client)
        gateway = LLMGateway(GatewaySettings(minimax_api_key="test-key"))
        stream = gateway.chat_stream([ChatMessage(role="user", content="hi")], provider="minimax")
        assert (await anext(stream)).text == "partial"
        with pytest.raises(httpx.ReadError):
            await anext(stream)
        assert len(calls) == 1
