"""best-of-N：排序规则 + 选稿生成偏好对。"""

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.db import engine, init_db
from app.eval.best_of_n import sort_ranked
from app.main import app
from app.models import PreferencePair

client = TestClient(app)
API = "/api/v1/eval"


def setup_module():
    init_db()
    with Session(engine) as session:
        session.exec(PreferencePair.__table__.delete())  # type: ignore[attr-defined]
        session.commit()


def test_sort_ranked_gate_first_then_score_then_stable():
    items = [
        {"id": "a", "passed": False, "score": 0.95},
        {"id": "b", "passed": True, "score": 0.60},
        {"id": "c", "passed": True, "score": 0.80},
        {"id": "d", "passed": True, "score": 0.80},
    ]
    ranked = sort_ranked(items)
    assert [x["id"] for x in ranked] == ["c", "d", "b", "a"]
    assert [x["rank"] for x in ranked] == [1, 2, 3, 4]


def test_rank_endpoint_returns_best():
    body = {
        "candidates": [
            {"id": "x1", "text": "她垂着头，肩膀微微耷拉。手指抠着衣角，一声不吭。"},
            {"id": "x2", "text": "她像一朵凋零的牡丹，仿佛整个世界都在与她作对。综上所述，她感到无比悲伤。"},
        ],
        "format": "manju",
        "includeLlm": False,
    }
    r = client.post(f"{API}/best-of-n/rank", json=body)
    assert r.status_code == 200, r.text
    out = r.json()
    assert len(out["ranked"]) == 2
    assert out["best"] == (out["ranked"][0]["id"] if out["ranked"][0]["assessment"] != "not_assessed" else None)
    assert out["ranked"][0]["rank"] == 1


def test_rank_rejects_empty_and_too_many():
    assert client.post(f"{API}/best-of-n/rank", json={"candidates": []}).status_code == 400
    many = [{"id": f"c{i}", "text": "文字内容" * 5} for i in range(9)]
    assert client.post(f"{API}/best-of-n/rank", json={"candidates": many}).status_code == 400


def test_pick_writes_pairs_for_unpicked_only():
    cands = [
        {"id": "p1", "text": "被选中的稿子内容A"},
        {"id": "p2", "text": "未选中的稿子内容B"},
        {"id": "p3", "text": "未选中的稿子内容C"},
    ]
    r = client.post(
        f"{API}/best-of-n/pick",
        json={"candidates": cands, "pickedId": "p1", "projectId": "proj-bon", "format": "manju"},
    )
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["count"] == 2

    prefs = client.get(f"{API}/preferences", params={"source": "bestofn_pick", "projectId": "proj-bon"}).json()
    assert prefs["count"] == 2
    for item in prefs["items"]:
        assert item["chosenText"] == "被选中的稿子内容A"
        assert item["chosenArtifactId"] == "p1"
        assert item["rejectedArtifactId"] in {"p2", "p3"}


def test_pick_rejects_unknown_id():
    r = client.post(
        f"{API}/best-of-n/pick",
        json={"candidates": [{"id": "a", "text": "文本一"}], "pickedId": "zzz"},
    )
    assert r.status_code == 400
