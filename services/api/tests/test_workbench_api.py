from __future__ import annotations

from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine
from starlette.testclient import TestClient
import pytest

from app.db import get_session
from app.main import api, app

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
SQLModel.metadata.create_all(engine)


def override_session():
    with Session(engine) as session:
        yield session


client = TestClient(app)


@pytest.fixture(autouse=True)
def _use_test_session():
    api.dependency_overrides[get_session] = override_session
    yield
    api.dependency_overrides.pop(get_session, None)


def test_create_and_expand_inspiration():
    created = client.post(
        "/api/v1/inspirations",
        json={"level": "idea", "sourceText": "废墟中捡到会说话的种子", "tags": ["脑洞"]},
    )
    assert created.status_code == 200
    body = created.json()
    assert body["id"]
    assert body["level"] == "idea"
    assert body["sourceText"] == "废墟中捡到会说话的种子"

    expanded = client.post(f"/api/v1/inspirations/{body['id']}/expand")
    assert expanded.status_code == 200
    data = expanded.json()
    assert len(data["candidates"]) >= 2
    for c in data["candidates"]:
        assert c.get("title")
        assert c.get("logline")
        scores = c.get("scores") or {}
        assert {"empathy", "thrill", "shell", "market"} <= set(scores)
    assert data["level"] == "concept"


def test_create_swap_plan():
    res = client.post(
        "/api/v1/swap-plans",
        json={
            "projectId": "11111111-1111-4111-8111-111111111111",
            "degree": "two",
            "mappingJson": [{"source": "都市", "target": "仙侠"}],
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["degree"] == "two"
    assert body["mappingJson"][0]["target"] == "仙侠"


def test_crawler_source_requires_robots_ack():
    created = client.post(
        "/api/v1/crawler-sources",
        json={"id": "fanqie", "name": "番茄", "scope": "公开榜", "interval": "12h"},
    )
    assert created.status_code == 200

    run = client.post("/api/v1/crawler-sources/fanqie/run")
    assert run.status_code == 400

    patched = client.patch(
        "/api/v1/crawler-sources/fanqie",
        json={"enabled": True, "robotsAck": True},
    )
    assert patched.status_code == 200
    run2 = client.post("/api/v1/crawler-sources/fanqie/run")
    assert run2.status_code == 200
    # 真实抓取：网络可达则为 ok，否则 failed（仍应返回结构化状态）
    assert run2.json()["status"] in {"ok", "failed", "running"}
