"""Worker steer 信箱 API。"""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.db import engine
from app.main import app
from app.models import AgentRun

client = TestClient(app)


def test_steer_post_and_poll():
    with Session(engine) as session:
        run = AgentRun(agent_id="topic.core_hook_batch", status="running")
        session.add(run)
        session.commit()
        session.refresh(run)
        run_id = run.id

    r = client.post(f"/api/v1/runs/{run_id}/steer", json={"message": "加一点反转"})
    assert r.status_code == 200
    assert r.json().get("ok") is True

    r2 = client.get(f"/api/v1/runs/{run_id}/steer")
    assert r2.status_code == 200
    body = r2.json()
    assert body["count"] >= 1
    assert any("反转" in m for m in body["messages"])

    # 再次拉取应为空（已 mark_done）
    r3 = client.get(f"/api/v1/runs/{run_id}/steer")
    assert r3.json()["count"] == 0
