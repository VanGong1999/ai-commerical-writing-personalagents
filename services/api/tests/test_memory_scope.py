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


def test_memory_write_rejects_cross_project_path():
    ok = client.put(
        "/api/v1/memory/file",
        json={"path": "/memories/projects/p1/characters.md", "content": "x", "project_id": "p1"},
    )
    assert ok.status_code == 200

    denied = client.put(
        "/api/v1/memory/file",
        json={"path": "/memories/projects/p2/characters.md", "content": "x", "project_id": "p1"},
    )
    assert denied.status_code == 403


def test_memory_write_viewer_role_denied():
    denied = client.put(
        "/api/v1/memory/file",
        json={"path": "/memories/projects/p1/x.md", "content": "x", "project_id": "p1"},
        headers={"X-User-Role": "viewer"},
    )
    assert denied.status_code == 403


def test_memory_read_cross_project_denied_for_writer():
    denied = client.get(
        "/api/v1/memory/file",
        params={"path": "/memories/projects/p2/x.md", "project_id": "p1"},
        headers={"X-User-Role": "writer"},
    )
    assert denied.status_code == 403


def test_memory_version_snapshot_and_rollback():
    path = "/memories/projects/test-rollback/decisions.md"

    # 第一次写：新建，不产生快照，但会算 hash
    r1 = client.put("/api/v1/memory/file", json={"path": path, "content": "v1"})
    assert r1.status_code == 200
    assert r1.json()["hash"]

    # 第二次写：内容变化，自动快照上一个版本 v1
    r2 = client.put("/api/v1/memory/file", json={"path": path, "content": "v2"})
    assert r2.status_code == 200

    vers = client.get("/api/v1/memory/versions", params={"path": path}).json()
    assert len(vers) == 1
    assert vers[0]["content"] == "v1"

    # 手动快照当前 v2
    snap = client.post(
        "/api/v1/memory/versions",
        json={"path": path, "note": "checkpoint"},
    )
    assert snap.status_code == 200
    assert snap.json()["content"] == "v2"
    assert snap.json()["note"] == "checkpoint"

    vers = client.get("/api/v1/memory/versions", params={"path": path}).json()
    assert len(vers) == 2

    # 回滚到 v1 快照（前端发 camelCase versionId）
    v1_version_id = next(v["id"] for v in vers if v["content"] == "v1")
    roll = client.post("/api/v1/memory/rollback", json={"versionId": v1_version_id})
    assert roll.status_code == 200
    assert roll.json()["content"] == "v1"

    # 回滚前会自动快照 v2，历史变 3 条（回滚可撤销）
    vers = client.get("/api/v1/memory/versions", params={"path": path}).json()
    assert len(vers) == 3

    # 最终文件内容回到 v1
    f = client.get("/api/v1/memory/file", params={"path": path}).json()
    assert f["content"] == "v1"
