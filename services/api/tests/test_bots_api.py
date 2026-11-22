"""AI 同事 Bot / Team / Template API 测试。"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.bot_registry import CHIEF_BOT_ID, EGG_BOT_ID, resolve_mentions, seed_system_bots
from app.db import engine, init_db
from app.main import app
from app.models import Bot
from sqlmodel import Session


def _client() -> TestClient:
    init_db()
    with Session(engine) as session:
        seed_system_bots(session)
    return TestClient(app)


def test_seed_system_bots():
    init_db()
    with Session(engine) as session:
        bots = seed_system_bots(session)
        ids = {b.id for b in bots}
        assert CHIEF_BOT_ID in ids
        assert EGG_BOT_ID in ids
        chief = session.get(Bot, CHIEF_BOT_ID)
        assert chief is not None
        assert chief.name == "幕僚长"
        assert chief.is_system is True


def test_list_and_create_bot():
    client = _client()
    r = client.get("/api/v1/bots")
    assert r.status_code == 200
    rows = r.json()
    assert any(b.get("id") == CHIEF_BOT_ID or b.get("name") == "幕僚长" for b in rows)

    r2 = client.post(
        "/api/v1/bots",
        json={
            "name": "测试同事",
            "duties": ["写大纲"],
            "neverDo": ["公开发布"],
            "trustLevel": 1,
        },
    )
    assert r2.status_code == 200
    body = r2.json()
    assert body["name"] == "测试同事"
    assert body["id"]


def test_teams_crud():
    client = _client()
    r = client.post(
        "/api/v1/bots/teams",
        json={
            "name": "测试团队",
            "memberBotIds": [CHIEF_BOT_ID, EGG_BOT_ID],
            "leadBotId": CHIEF_BOT_ID,
            "speakPolicy": "orchestrated",
            "maxRounds": 4,
        },
    )
    assert r.status_code == 200
    team = r.json()
    assert team["name"] == "测试团队"
    tid = team["id"]
    r2 = client.get(f"/api/v1/bots/teams/{tid}")
    assert r2.status_code == 200
    r3 = client.patch(f"/api/v1/bots/teams/{tid}", json={"maxRounds": 5})
    assert r3.status_code == 200
    assert r3.json()["maxRounds"] == 5


def test_resolve_mentions():
    init_db()
    with Session(engine) as session:
        bots = seed_system_bots(session)
        ids = resolve_mentions("@幕僚长 请看一下，蛋博士：也来", bots)
        assert CHIEF_BOT_ID in ids
        assert EGG_BOT_ID in ids


def test_templates_list():
    client = _client()
    r = client.get("/api/v1/bots/templates")
    assert r.status_code == 200
    # 模板目录可能为空（若子代理未写入），但接口应可用
    assert isinstance(r.json(), list)


def test_create_dm_conversation_binds_chief():
    client = _client()
    r = client.post("/api/v1/conversations", json={"source": "assistant", "title": "测"})
    assert r.status_code == 200
    body = r.json()
    assert body.get("kind") == "dm"
    assert body.get("botId") == CHIEF_BOT_ID
