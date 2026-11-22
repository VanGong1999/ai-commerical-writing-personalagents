import pytest
from sqlmodel import Session
from starlette.testclient import TestClient

from app.db import engine, init_db
from app.memory_service import touch_memory
from app.main import app
from app.models import MemoryFile
from app.seed import DEMO_USER


@pytest.fixture(autouse=True)
def _init():
    init_db()


def test_touch_increments_and_recomputes():
    with Session(engine) as s:
        row = MemoryFile(
            path="/memories/user/x.md",
            user_id=DEMO_USER,
            content="x",
            confidence=0.5,
            access_count=0,
        )
        s.add(row)
        s.commit()
        out = touch_memory(s, "/memories/user/x.md")
        assert out is not None
        assert out.access_count == 1
        assert out.last_accessed_at is not None


def test_touch_missing_returns_none():
    with Session(engine) as s:
        assert touch_memory(s, "/memories/nope.md") is None


def test_touch_endpoint_increments():
    with Session(engine) as s:
        s.add(MemoryFile(path="/memories/user/ep.md", user_id=DEMO_USER, content="e"))
        s.commit()
    client = TestClient(app)
    res = client.post("/api/v1/memory/touch", params={"path": "/memories/user/ep.md"})
    assert res.status_code == 200
    assert res.json()["accessCount"] == 1
