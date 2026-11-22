"""GET /kb/tropes/stats 桥段/情节频次统计测试。"""

from __future__ import annotations

import pytest
from sqlmodel import Session
from starlette.testclient import TestClient

from app.db import engine, init_db
from app.main import app
from app.models import KnowledgeDoc, StoryFingerprint, TropeClip, new_id


@pytest.fixture(scope="module", autouse=True)
def _setup_db():
    init_db()
    yield


@pytest.fixture()
def client():
    return TestClient(app)


@pytest.fixture()
def session():
    with Session(engine) as s:
        yield s


def test_trope_stats_aggregates_tags(client, session):
    # 种子：TropeClip(name="追妻火葬场", tags=["追妻","虐恋"])；
    #       StoryFingerprint(doc_id=..., trope_tags=["追妻"], genre="女频", hook_category="追妻")
    session.add(TropeClip(name="追妻火葬场", summary="", tags=["追妻", "虐恋"]))
    session.add(
        StoryFingerprint(
            doc_id=new_id(),
            trope_tags=["追妻"],
            genre="女频",
            hook_category="追妻",
        )
    )
    session.commit()

    r = client.get("/api/v1/kb/tropes/stats")
    assert r.status_code == 200, r.text
    body = r.json()

    counts = {x["tag"]: x["count"] for x in body["tropeCounts"]}
    assert counts["追妻"] == 2  # 桥段 + 书指纹合并
    assert counts["虐恋"] == 1

    genres = {x["genre"]: x["count"] for x in body["genreCounts"]}
    assert genres["女频"] == 1

    categories = {x["category"]: x["count"] for x in body["hookCategoryCounts"]}
    assert categories["追妻"] == 1

    assert body["totalTropes"] == 2  # 追妻 + 虐恋
    assert body["totalDocs"] == 1


def test_search_tropes_matches_tags_and_genre(client, session):
    # 种子：TropeClip(name="浪漫追妻", tags=["浪漫","追妻"], applicable_genres=["女频"])；
    #       StoryFingerprint(doc_id=..., trope_tags=["浪漫"], genre="女频")
    doc_id = new_id()
    session.add(
        TropeClip(
            name="浪漫追妻",
            summary="",
            tags=["浪漫", "追妻"],
            applicable_genres=["女频"],
        )
    )
    session.add(
        StoryFingerprint(
            doc_id=doc_id,
            trope_tags=["浪漫"],
            genre="女频",
        )
    )
    session.commit()

    r = client.get("/api/v1/kb/search/tropes", params={"q": "浪漫"})
    assert r.status_code == 200, r.text
    body = r.json()

    assert any(t["name"] == "浪漫追妻" for t in body["tropes"])
    assert len(body["books"]) == 1
    assert body["books"][0]["matchedTags"] == ["浪漫"]
    assert body["books"][0]["docId"] == doc_id
    assert body["books"][0]["genre"] == "女频"


def test_search_tropes_empty_q(client):
    r = client.get("/api/v1/kb/search/tropes", params={"q": "   "})
    assert r.status_code == 200
    assert r.json()["tropes"] == []
    assert r.json()["books"] == []


def test_search_tropes_title_falls_back_to_doc_id(client, session):
    # 关联到已存在 KnowledgeDoc 的指纹应取到 title；
    # 关联不到 doc 的指纹 title 应回退为 doc_id。
    linked_id = new_id()
    orphan_id = new_id()
    session.add(
        KnowledgeDoc(
            id=linked_id,
            title="已关联书名",
            doc_type="novel",
            user_id="u1",
        )
    )
    session.add(
        StoryFingerprint(
            doc_id=linked_id,
            trope_tags=["回退测试独有梗"],
        )
    )
    session.add(
        StoryFingerprint(
            doc_id=orphan_id,
            trope_tags=["回退测试独有梗"],
        )
    )
    session.commit()

    r = client.get("/api/v1/kb/search/tropes", params={"q": "回退测试独有梗"})
    assert r.status_code == 200, r.text
    books = {b["docId"]: b for b in r.json()["books"]}
    assert books[linked_id]["title"] == "已关联书名"
    assert books[orphan_id]["title"] == orphan_id
