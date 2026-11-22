from __future__ import annotations

import asyncio
from types import SimpleNamespace

from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app import crypto, db
from app.llm_service import resolve_active_provider, resolve_default_model
from app.models import AgentRun, ProviderConfig
from app.routers import llm as llm_router


def _routing_engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    return engine


def test_active_provider_follows_settings_and_selected_model(monkeypatch):
    engine = _routing_engine()
    monkeypatch.setattr(db, "engine", engine)
    monkeypatch.setattr(crypto, "decrypt_secret", lambda _value: "test-key")

    with Session(engine) as session:
        minimax = ProviderConfig(
            name="MiniMax",
            base_url="https://api.minimaxi.com/v1",
            api_key_enc="encrypted",
            models=["MiniMax-M3.1-Flash", "MiniMax-M3.1-Pro"],
            selected_model="MiniMax-M3.1-Pro",
            enabled=True,
            is_default=True,
        )
        deepseek = ProviderConfig(
            name="DeepSeek",
            base_url="https://api.deepseek.com",
            api_key_enc="encrypted",
            models=["deepseek-flash", "deepseek-v4-pro"],
            selected_model="deepseek-v4-pro",
            enabled=True,
            is_default=False,
        )
        session.add(minimax)
        session.add(deepseek)
        session.commit()

    assert resolve_active_provider() == (
        "https://api.minimaxi.com/v1",
        "test-key",
        "MiniMax-M3.1-Pro",
    )
    assert resolve_default_model() == "MiniMax-M3.1-Pro"

    # Switching the default in Settings must be reflected without restarting
    # the Agent Worker or changing hardcoded model IDs in code.
    with Session(engine) as session:
        rows = list(session.exec(select(ProviderConfig)))
        for row in rows:
            row.is_default = row.name == "DeepSeek"
            session.add(row)
        session.commit()

    assert resolve_active_provider() == (
        "https://api.deepseek.com",
        "test-key",
        "deepseek-v4-pro",
    )
    assert resolve_default_model() == "deepseek-v4-pro"


def test_selected_model_falls_back_to_first_available(monkeypatch):
    engine = _routing_engine()
    monkeypatch.setattr(db, "engine", engine)
    monkeypatch.setattr(crypto, "decrypt_secret", lambda _value: "test-key")

    with Session(engine) as session:
        session.add(
            ProviderConfig(
                name="Compatible",
                base_url="https://example.com/v1",
                api_key_enc="encrypted",
                models=["model-a", "model-b"],
                selected_model="missing-model",
                enabled=True,
                is_default=True,
            )
        )
        session.commit()

    assert resolve_active_provider()[2] == "model-a"


def test_agent_chat_proxy_returns_active_model_and_updates_run(monkeypatch):
    engine = _routing_engine()
    captured: dict = {}

    async def fake_chat_completion(messages, **kwargs):
        captured["messages"] = messages
        captured.update(kwargs)
        return SimpleNamespace(
            content="OK",
            model="model-b",
            prompt_tokens=7,
            completion_tokens=2,
            cache_hit_tokens=0,
            cache_miss_tokens=7,
            tool_calls=[],
        )

    monkeypatch.setattr(llm_router, "chat_completion", fake_chat_completion)

    with Session(engine) as session:
        run = AgentRun(agent_id="topic.core_hook_batch", status="running", model="old-model")
        session.add(run)
        session.commit()
        session.refresh(run)

        response = asyncio.run(
            llm_router.agent_chat(
                llm_router.AgentChatIn(
                    messages=[{"role": "user", "content": "ping"}],
                    max_tokens=8,
                    run_id=run.id,
                ),
                session,
            )
        )

        session.refresh(run)
        assert run.model == "model-b"

    assert captured["max_tokens"] == 8
    assert captured["messages"][0]["content"] == "ping"
    assert response["choices"][0]["message"]["content"] == "OK"
    assert response["model"] == "model-b"
    assert response["usage"]["prompt_cache_miss_tokens"] == 7


def test_worker_proxy_preserves_truncation_and_records_actual_usage(monkeypatch):
    from app.models import Project, UsageEvent
    engine=_routing_engine()
    async def truncated(messages,**kwargs):
        return SimpleNamespace(content='不完整',model='MiniMax-M3.1-Flash',prompt_tokens=123,
            completion_tokens=456,cache_hit_tokens=100,cache_miss_tokens=23,tool_calls=[],
            raw={'choices':[{'finish_reason':'length'}]})
    monkeypatch.setattr(llm_router,'chat_completion',truncated)
    with Session(engine) as session:
        project=Project(title='用量测试',format='manju',stage='S0_SETUP',user_id='test')
        session.add(project);session.commit();session.refresh(project)
        run=AgentRun(project_id=project.id,agent_id='prose.episode_body',status='running')
        session.add(run);session.commit();session.refresh(run)
        response=asyncio.run(llm_router.agent_chat(llm_router.AgentChatIn(
            messages=[{'role':'user','content':'写一集'}],run_id=run.id),session))
        assert response['choices'][0]['finish_reason']=='length'
        event=session.exec(select(UsageEvent).where(UsageEvent.run_id==run.id)).one()
        assert (event.prompt_tokens,event.completion_tokens,event.cache_hit_tokens,event.cache_miss_tokens)==(123,456,100,23)
        assert event.model=='MiniMax-M3.1-Flash'
        assert event.project_id==project.id
        session.refresh(project)
        assert project.token_used==579
    engine.dispose()


def test_saved_endpoint_blocks_environment_replacement(monkeypatch):
    from app import llm_service
    engine = _routing_engine()
    monkeypatch.setattr(db, "engine", engine)
    monkeypatch.setattr(crypto, "decrypt_secret", lambda value: value)
    monkeypatch.setattr(llm_service, "get_settings", lambda: SimpleNamespace(
        llm_default_provider="deepseek", effective_minimax_base_url="", effective_minimax_api_key="",
        effective_minimax_model="mini", deepseek_base_url="https://api.deepseek.com/",
        deepseek_api_key="environment-key", deepseek_model="env-model",
        openai_compat_base_url="", openai_compat_api_key="", openai_compat_model="other"))
    assert llm_service.list_provider_chain()[0]["model"] == "env-model"
    with Session(engine) as session:
        row = ProviderConfig(name="DeepSeek", base_url="https://api.deepseek.com",
                             api_key_enc="database-key", models=["saved-model"], enabled=False)
        session.add(row)
        session.commit()
        assert llm_service.list_provider_chain() == []
        assert llm_service.resolve_active_provider() is None
        assert llm_service.resolve_active_provider_info()["source"] == "unavailable"
        row.enabled = True
        row.api_key_enc = ""
        session.add(row)
        session.commit()
        assert llm_service.list_provider_chain() == []
        row.api_key_enc = "database-key"
        session.add(row)
        session.commit()
        assert llm_service.resolve_active_provider()[1:] == ("database-key", "saved-model")


def test_quota_cooldown_routes_until_expiry(monkeypatch):
    import httpx
    import pytest
    from llm_gateway import client
    from app import llm_governor as governor, llm_service as service

    clock = SimpleNamespace(now=100.0)
    monkeypatch.setattr(governor, "time", SimpleNamespace(time=lambda: clock.now))
    monkeypatch.setattr(governor, "_get_redis", lambda: None)
    monkeypatch.setattr(governor, "_MEM", dict(governor._MEM, quota={}, cooldowns={}))
    monkeypatch.setattr(governor, "report_success", lambda: None)
    monkeypatch.setattr(governor, "report_throttle", lambda **kw: pytest.fail("global throttle"))
    monkeypatch.setattr(governor, "failover_enabled", lambda: True)
    routes = [dict(base_url=f"https://{pid}.example", api_key="key", model=pid, provider_id=pid)
              for pid in ("minimax", "deepseek")]
    monkeypatch.setattr(service, "_primary_route", lambda: routes[0])
    monkeypatch.setattr(service, "list_provider_chain", lambda: routes)
    hosts = []

    def respond(request):
        hosts.append(request.url.host)
        if request.url.host == "minimax.example":
            return httpx.Response(429, json={"error": {"code": "2056"}})
        return httpx.Response(200, json={"model": "deepseek", "choices": [
            {"finish_reason": "stop", "message": {"content": "ok"}}]})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as transport:
            monkeypatch.setattr(client, "_shared_client", transport)
            for _ in range(2):
                result = await service.chat_completion([], skip_admit=True)
                assert result.model == "deepseek"
            routes.pop()
            with pytest.raises(client.RateLimitedError) as error:
                await service.chat_completion([], skip_admit=True)
            assert not error.value.retryable
            clock.now += 100
            with pytest.raises(client.RateLimitedError) as error:
                await service.chat_completion([], skip_admit=True)
            assert error.value.provider_code == "2056"

    asyncio.run(run())
    assert hosts == ["minimax.example", "deepseek.example", "deepseek.example", "minimax.example"]


def test_set_default_provider_rejects_missing_api_key(monkeypatch):
    """无有效 Key 的服务商不能设为默认，否则运行时会静默落到其它厂商。"""
    from fastapi.testclient import TestClient

    from app.db import init_db
    from app.main import app

    init_db()
    engine = db.engine
    with Session(engine) as session:
        keyed = ProviderConfig(
            name="DeepSeek",
            base_url="https://api.deepseek.com",
            api_key_enc=crypto.encrypt_secret("sk-real-deepseek-key"),
            api_key_masked="sk-…key",
            models=["deepseek-flash"],
            selected_model="deepseek-flash",
            enabled=True,
            is_default=True,
        )
        empty = ProviderConfig(
            name="MiniMax",
            base_url="https://api.minimaxi.com/v1",
            api_key_enc="",
            api_key_masked="****",
            models=["MiniMax-M3.1-Flash"],
            selected_model="MiniMax-M3.1-Flash",
            enabled=True,
            is_default=False,
        )
        session.add(keyed)
        session.add(empty)
        session.commit()
        empty_id = empty.id

    client = TestClient(app)
    denied = client.patch(f"/api/v1/settings/providers/{empty_id}/default")
    assert denied.status_code == 400, denied.text
    assert "API Key" in denied.json()["detail"]
    still = client.get("/api/v1/settings/providers").json()
    assert next(p for p in still if p["id"] == empty_id)["isDefault"] is False
