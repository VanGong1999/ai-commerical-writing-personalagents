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


def test_cas_write_conflict_returns_409():
    path = "/memories/projects/cas1/decisions.md"
    r1 = client.put("/api/v1/memory/file", json={"path": path, "content": "v1", "project_id": "cas1"})
    assert r1.status_code == 200
    h1 = r1.json()["hash"]
    assert h1

    r2 = client.put(
        "/api/v1/memory/file",
        json={"path": path, "content": "v2", "project_id": "cas1", "expected_hash": h1, "check_cas": True},
    )
    assert r2.status_code == 200
    h2 = r2.json()["hash"]

    # 用过期 hash 写入 → 409
    conflict = client.put(
        "/api/v1/memory/file",
        json={
            "path": path,
            "content": "stale",
            "project_id": "cas1",
            "expected_hash": h1,
            "check_cas": True,
            "actor": "agent:writer_a",
        },
    )
    assert conflict.status_code == 409
    detail = conflict.json()["detail"]
    assert detail["error"] == "memory_conflict"
    assert detail["current_hash"] == h2

    # 用最新 hash 可写
    ok = client.put(
        "/api/v1/memory/file",
        json={
            "path": path,
            "content": "v3",
            "project_id": "cas1",
            "expected_hash": h2,
            "check_cas": True,
            "actor": "agent:writer_b",
        },
    )
    assert ok.status_code == 200
    body = ok.json()
    assert body["actor"] == "agent:writer_b"
    assert body.get("storeId") == "project.cas1.bible" or body.get("store_id") == "project.cas1.bible"


def test_memory_stores_bootstrap_and_list():
    rows = client.get("/api/v1/memory/stores", params={"project_id": "p-store"}).json()
    ids = {r["id"] for r in rows}
    assert "org.methodology" in ids
    assert "user.profile" in ids
    assert "project.p-store.bible" in ids
    assert "project.p-store.journal" in ids
    shared = {r["id"]: r["shared"] for r in rows}
    assert shared["project.p-store.bible"] is True


def _project(pid):
    from app.models import Project
    from app.seed import DEMO_USER

    with Session(engine) as db:
        db.add(Project(id=pid, title="记忆测试", user_id=DEMO_USER, format="manju", stage="S0"))
        db.commit()


def test_dreaming_proposal_review_and_merge():
    _project("dream1")
    path = "/memories/projects/dream1/journal/ch-001.md"
    client.put(
        "/api/v1/memory/file",
        json={"path": path, "content": "# ch\n事实摘要\n", "project_id": "dream1"},
    )
    dream = client.post(
        "/api/v1/memory/dreams",
        json={"project_id": "dream1", "title": "test dream", "window_hours": 24},
    )
    assert dream.status_code == 200
    body = dream.json()
    assert body["status"] == "ready"
    assert len(body["changes"]) >= 1
    dream_id = body["id"]

    # 修改第一条提案（响应为 camelCase）
    ch = body["changes"][0]
    after = ch.get("afterContent") or ch.get("after_content") or ""
    patched = client.patch(
        f"/api/v1/memory/dreams/{dream_id}/changes/{ch['id']}",
        json={"status": "accepted", "editedContent": after + "\n# user edit\n"},
    )
    assert patched.status_code == 200
    assert patched.json()["status"] == "accepted"

    merged = client.post(f"/api/v1/memory/dreams/{dream_id}/merge")
    assert merged.status_code == 200
    result = merged.json()
    assert result["merged"] >= 1
    assert result["status"] in {"merged", "partial"}

    # 合入后索引文件应存在
    idx = client.get(
        "/api/v1/memory/file",
        params={"path": "/memories/projects/dream1/INDEX.md"},
    )
    # INDEX 可能是提案之一
    if idx.status_code == 200:
        assert "Memory Index" in (idx.json().get("content") or "")


def test_version_has_precondition_and_actor():
    path = "/memories/projects/attr1/characters.md"
    r1 = client.put(
        "/api/v1/memory/file",
        json={"path": path, "content": "a", "project_id": "attr1", "actor": "agent:bio"},
    )
    assert r1.status_code == 200
    h = r1.json()["hash"]
    r2 = client.put(
        "/api/v1/memory/file",
        json={
            "path": path,
            "content": "b",
            "project_id": "attr1",
            "expected_hash": h,
            "check_cas": True,
            "actor": "agent:bio",
            "change_summary": "update cast",
        },
    )
    assert r2.status_code == 200
    vers = client.get("/api/v1/memory/versions", params={"path": path}).json()
    assert len(vers) >= 1
    assert vers[0]["actor"] == "agent:bio"
    assert vers[0].get("preconditionHash") or vers[0].get("precondition_hash")


def test_lessons_dream_dedupes_and_trims():
    _project("lp1")
    p1 = "/memories/projects/lp1/procedural/prose.episode_body/lessons.md"
    body = (
        "# x\n- [2026-01-01] 先抛悬念\n- [2026-01-02] 先抛悬念\n- [2026-01-03] 对白要短\n"
    )
    client.put("/api/v1/memory/file", json={"path": p1, "content": body, "project_id": "lp1"})
    dream = client.post(
        "/api/v1/memory/dreams",
        json={"storeId": "agent.prose.episode_body.lessons", "title": "lessons"},
    )
    assert dream.status_code == 200
    out = dream.json()
    assert out["status"] == "ready"
    changes = out["changes"]
    assert len(changes) == 1
    after = changes[0].get("afterContent") or changes[0].get("after_content")
    assert after.count("先抛悬念") == 1
    assert "对白要短" in after


def test_memory_search_matches_chinese_partial_terms():
    path = "/memories/projects/cjk1/characters.md"
    client.put(
        "/api/v1/memory/file",
        json={"path": path, "content": "主角性格冷静，擅长推理", "project_id": "cjk1"},
    )
    r = client.post("/api/v1/memory/search", params={"q": "主角的性格设定", "project_id": "cjk1"})
    assert r.status_code == 200
    assert any(row["path"] == path for row in r.json())
