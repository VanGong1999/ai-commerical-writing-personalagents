"""会话 runtime / inbox / subscriptions API。"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from app.seed import DEMO_USER


client = TestClient(app)


def test_runtime_and_inbox_endpoints():
    res = client.post("/api/v1/conversations", json={"title": "runtime-test", "source": "assistant"})
    assert res.status_code == 200
    conv_id = res.json()["id"]

    r = client.get(f"/api/v1/conversations/{conv_id}/runtime")
    assert r.status_code == 200
    body = r.json()
    assert body["conversationId"] == conv_id
    assert body["state"] in {"idle", "thinking", "waiting_confirm"}
    assert "activeRuns" in body
    assert "subscriptions" in body

    r2 = client.get(f"/api/v1/conversations/{conv_id}/inbox")
    assert r2.status_code == 200
    assert "events" in r2.json()

    r3 = client.get(f"/api/v1/conversations/{conv_id}/subscriptions")
    assert r3.status_code == 200
    assert "subscriptions" in r3.json()

    r4 = client.get(f"/api/v1/conversations/{conv_id}/steps?after_seq=0")
    assert r4.status_code == 200
    assert "steps" in r4.json()
