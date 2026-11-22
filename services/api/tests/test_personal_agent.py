from __future__ import annotations

from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine
from starlette.testclient import TestClient
import pytest

from app.db import get_session
from app.main import api, app
from app.models import ActivityLog, AgentRun, Conversation, Job, new_id

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


def test_conversation_lifecycle():
    res = client.post("/api/v1/conversations", json={"source": "assistant", "title": "生成核心梗"})
    assert res.status_code == 200, res.text
    conv_id = res.json()["id"]
    assert res.json()["title"] == "生成核心梗"
    assert res.json()["source"] == "assistant"

    res = client.get("/api/v1/conversations")
    assert res.status_code == 200
    assert any(c["id"] == conv_id for c in res.json())

    res = client.get(f"/api/v1/conversations/{conv_id}")
    assert res.status_code == 200

    res = client.get(f"/api/v1/conversations/{conv_id}/messages")
    assert res.status_code == 200
    assert res.json() == []

    res = client.get(f"/api/v1/conversations/{conv_id}/timeline")
    assert res.status_code == 200
    assert res.json()["events"] == []


def test_timeline_aggregates_run_and_job():
    res = client.post("/api/v1/conversations", json={"title": "一键写正文"})
    conv_id = res.json()["id"]

    with Session(engine) as session:
        session.add(ActivityLog(
            conversation_id=conv_id,
            actor="assistant",
            action="run_agent",
            summary="触发 agent",
        ))
        run = AgentRun(conversation_id=conv_id, agent_id="prose.episode_body", status="done")
        session.add(run)
        session.add(Job(
            conversation_id=conv_id,
            type="agent.run",
            status="done",
            user_id="00000000-0000-4000-8000-000000000001",
        ))
        session.commit()

    res = client.get(f"/api/v1/conversations/{conv_id}/timeline")
    assert res.status_code == 200
    kinds = {e["kind"] for e in res.json()["events"]}
    assert kinds == {"activity", "run", "job"}
