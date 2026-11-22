"""429 耗尽后切备用 Provider。"""

from __future__ import annotations

import httpx
import pytest

from llm_gateway import ChatMessage, LLMGateway, RateLimitedError
from llm_gateway import client as client_module
from llm_gateway.settings import GatewaySettings


@pytest.mark.asyncio
async def test_chat_fails_over_to_backup_on_429():
    hosts_hit: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        hosts_hit.append(str(request.url))
        if "primary.example" in str(request.url):
            return httpx.Response(429, headers={"Retry-After": "1"}, json={"error": "rate"})
        return httpx.Response(
            200,
            json={
                "model": "backup-model",
                "choices": [{"message": {"role": "assistant", "content": "from-backup"}}],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1},
            },
        )

    client_module._shared_client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        limits=httpx.Limits(max_connections=4),
    )
    try:
        gateway = LLMGateway(
            GatewaySettings(
                minimax_api_key="primary-key",
                minimax_base_url="https://primary.example/v1",
                minimax_model="primary-model",
            )
        )
        # Force fewer retries so we hit failover faster: monkeypatch by exhausting
        # — RateLimitedError is raised after retries; reduce retries via wrapping
        original = client_module._post_with_retry

        async def fast_retry(*args, **kwargs):
            kwargs["max_retries"] = 0
            return await original(*args, **kwargs)

        client_module._post_with_retry = fast_retry  # type: ignore[assignment]
        try:
            result = await gateway.chat(
                [ChatMessage(role="user", content="ping")],
                provider="minimax",
                fallbacks=[
                    {
                        "base_url": "https://backup.example/v1",
                        "api_key": "backup-key",
                        "model": "backup-model",
                        "provider_id": "backup",
                    }
                ],
            )
            assert result.content == "from-backup"
            assert any("primary.example" in h for h in hosts_hit)
            assert any("backup.example" in h for h in hosts_hit)
            assert (result.raw or {}).get("_failover", {}).get("providerId") == "backup"
        finally:
            client_module._post_with_retry = original  # type: ignore[assignment]
    finally:
        await client_module._shared_client.aclose()
        client_module._shared_client = None


@pytest.mark.asyncio
async def test_chat_raises_rate_limited_when_all_fail():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={"error": "rate"})

    client_module._shared_client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        limits=httpx.Limits(max_connections=4),
    )
    original = client_module._post_with_retry

    async def fast_retry(*args, **kwargs):
        kwargs["max_retries"] = 0
        return await original(*args, **kwargs)

    client_module._post_with_retry = fast_retry  # type: ignore[assignment]
    try:
        gateway = LLMGateway(GatewaySettings(minimax_api_key="k"))
        with pytest.raises(RateLimitedError):
            await gateway.chat(
                [ChatMessage(role="user", content="ping")],
                provider="minimax",
                fallbacks=[
                    {
                        "base_url": "https://backup.example/v1",
                        "api_key": "b",
                        "model": "m",
                        "provider_id": "b1",
                    }
                ],
            )
    finally:
        client_module._post_with_retry = original  # type: ignore[assignment]
        await client_module._shared_client.aclose()
        client_module._shared_client = None


@pytest.mark.asyncio
@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize("backup", ["healthy", "exhausted", "disabled"])
async def test_quota_attempts_each_provider_once(monkeypatch, stream, backup):
    hosts = []

    def respond(request):
        hosts.append(request.url.host)
        if request.url.host == "primary.example" or backup == "exhausted":
            return httpx.Response(429, json={"error": {"code": "2056"}})
        return httpx.Response(200, json={"model": "deepseek", "choices": [
            {"finish_reason": "stop", "message": {"content": "ok"}}]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        monkeypatch.setattr(client_module, "_shared_client", client)
        gateway = LLMGateway(GatewaySettings(minimax_api_key="key"))
        options = dict(base_url="https://primary.example", api_key="key", fallbacks=[
            dict(base_url="https://backup.example", api_key="key", model="deepseek", provider_id="backup")
        ] if backup != "disabled" else [])
        async def call():
            if stream:
                return [chunk async for chunk in gateway.chat_stream([], **options)]
            return await gateway.chat([], **options)
        if backup == "healthy":
            result = await call()
            if not stream:
                assert result.model == "deepseek"
                assert result.raw["_failover"] == {"providerId": "backup", "attempt": 2}
        else:
            with pytest.raises(RateLimitedError) as error:
                await call()
            assert not error.value.retryable
        assert hosts == ["primary.example"] + (["backup.example"] if backup != "disabled" else [])


@pytest.mark.asyncio
@pytest.mark.parametrize("first", [
    '{"choices":[{"delta":{"content":"x"}}]}',
    '{"choices":[{"delta":{"tool_calls":[{"id":"t"}]}}]}',
    '{"usage":{"prompt_tokens":1}}',
])
async def test_stream_quota_after_output_never_replays(monkeypatch, first):
    hits = []

    def respond(request):
        hits.append(request.url.host)
        return httpx.Response(200, text='data: ' + first + '\n' + 'data: {"error":{"code":"2056"}}\n')

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        monkeypatch.setattr(client_module, "_shared_client", client)
        gateway = LLMGateway(GatewaySettings(minimax_api_key="key"))
        chunks = gateway.chat_stream([], base_url="https://primary.example", api_key="key",
                                     fallbacks=[dict(base_url="https://backup.example", api_key="key")])
        await anext(chunks)
        with pytest.raises(RateLimitedError) as error:
            await anext(chunks)
        assert not error.value.retryable
        assert hits == ["primary.example"]


@pytest.mark.asyncio
async def test_stream_gzip_quota_switches_once(monkeypatch):
    import gzip

    hosts = []

    def respond(request):
        hosts.append(request.url.host)
        if request.url.host == "primary.example":
            body = gzip.compress(b'{"error":{"code":"2056"}}')
            return httpx.Response(429, headers={"Content-Encoding": "gzip"},
                                  stream=httpx.ByteStream(body))
        return httpx.Response(200, json={"choices": [
            {"finish_reason": "stop", "message": {"content": "ok"}}]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        monkeypatch.setattr(client_module, "_shared_client", client)
        gateway = LLMGateway(GatewaySettings(minimax_api_key="key"))
        chunks = [chunk async for chunk in gateway.chat_stream(
            [], base_url="https://primary.example", api_key="key",
            fallbacks=[dict(base_url="https://backup.example", api_key="key", model="deepseek")],
        )]
        assert [chunk.text for chunk in chunks if chunk.type == "token"] == ["ok"]
        assert hosts == ["primary.example", "backup.example"]
