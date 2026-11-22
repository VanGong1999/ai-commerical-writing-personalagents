"""人工偏好：段落反馈、好坏例检索、偏好对与 DPO 导出。"""

import json

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.db import engine, init_db
from app.eval.config import put_eval_config
from app.eval.feedback import export_preferences_dpo, select_exemplars
from app.main import app
from app.models import ArtifactFeedback, PreferencePair

client = TestClient(app)
API = "/api/v1/eval"


def setup_module():
    init_db()
    with Session(engine) as session:
        session.query(ArtifactFeedback).delete()
        session.query(PreferencePair).delete()
        session.commit()
        put_eval_config(session, {"exemplar_inject_enabled": True, "preference_export_authorized": False})


def _post_feedback(**kw):
    body = {
        "artifactId": "art-1",
        "spanText": "她像一朵凋零的牡丹，心里满是复杂的情绪。",
        "polarity": "bad",
        "reasonTags": ["W07"],
        "format": "manju",
        "artifactType": "manuscript",
    }
    body.update(kw)
    return client.post(f"{API}/feedback", json=body)


def test_feedback_crud_and_validation():
    r = _post_feedback()
    assert r.status_code == 200, r.text
    row = r.json()
    assert row["polarity"] == "bad"
    assert row["reasonTags"] == ["W07"]

    listed = client.get(f"{API}/feedback", params={"artifactId": "art-1"}).json()
    assert listed["count"] >= 1
    assert all(x["artifactId"] == "art-1" for x in listed["items"])

    bad = _post_feedback(polarity="meh")
    assert bad.status_code == 400
    empty = _post_feedback(spanText="   ")
    assert empty.status_code == 422 or empty.status_code == 400


def test_feedback_tags_endpoint():
    r = client.get(f"{API}/feedback/tags").json()
    codes = {t["code"] for t in r["tags"]}
    assert {"W07", "W08"} <= codes


def test_exemplar_respects_char_limit_and_polarity():
    _post_feedback(spanText="好例" * 300, polarity="good", reasonTags=["GOOD_HOOK"])
    _post_feedback(spanText="坏例" * 300, polarity="bad", reasonTags=["W07"])
    with Session(engine) as session:
        out = select_exemplars(session, format="manju", max_chars=400)
    assert out["enabled"] is True
    assert out["chars"] <= 400
    assert "好例" in out["text"] or out["good"] == []
    assert len(out["good"]) <= 3
    assert len(out["bad"]) <= 2


def test_exemplar_disabled_by_config():
    with Session(engine) as session:
        put_eval_config(session, {"exemplar_inject_enabled": False})
        out = select_exemplars(session, format="manju")
        put_eval_config(session, {"exemplar_inject_enabled": True})
    assert out["enabled"] is False
    assert out["text"] == ""


def test_exemplar_endpoint():
    r = client.get(f"{API}/exemplars", params={"format": "manju", "maxChars": 800})
    assert r.status_code == 200
    assert r.json()["chars"] <= 800


def test_preference_create_validation():
    ok = client.post(
        f"{API}/preferences",
        json={
            "chosenText": "A 版本更有钩子。",
            "rejectedText": "B 版本平淡。",
            "source": "ab_pick",
            "prompt": "写开篇",
            "projectId": "p1",
            "format": "manju",
        },
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["source"] == "ab_pick"

    same = client.post(
        f"{API}/preferences",
        json={"chosenText": "x", "rejectedText": "x", "source": "ab_pick"},
    )
    assert same.status_code == 400

    wrong_src = client.post(
        f"{API}/preferences",
        json={"chosenText": "x", "rejectedText": "y", "source": "random"},
    )
    assert wrong_src.status_code == 400


def test_export_blocked_without_authorization():
    with Session(engine) as session:
        put_eval_config(session, {"preference_export_authorized": False})
        out = export_preferences_dpo(session, min_per_context=1, write_file=False)
    assert out["ok"] is False
    assert out["count"] == 0


def test_export_dpo_jsonl_format_and_min_per_context(tmp_path, monkeypatch):
    import app.eval.feedback as fb

    monkeypatch.setattr(fb, "_EXPORT_DIR", tmp_path)
    with Session(engine) as session:
        put_eval_config(session, {"preference_export_authorized": True})
        session.query(PreferencePair).delete()
        session.commit()
        from app.eval.feedback import create_preference

        # 同一 context 两条 -> 导出；另一 context 只一条 -> 排除
        for i in range(2):
            create_preference(
                session,
                chosen_text=f"好稿{i}",
                rejected_text=f"差稿{i}",
                source="ab_pick",
                context_key="p|step|aaa",
                prompt="写一段",
                format="manju",
            )
        create_preference(
            session,
            chosen_text="单条好",
            rejected_text="单条差",
            source="bestofn_pick",
            context_key="p|step|bbb",
        )
        out = export_preferences_dpo(session, min_per_context=2, write_file=True)
        put_eval_config(session, {"preference_export_authorized": False})

    assert out["ok"] is True
    assert out["count"] == 2
    assert out["path"]
    lines = [json.loads(x) for x in open(out["path"], encoding="utf-8")]
    assert len(lines) == 2
    for obj in lines:
        assert set(obj) >= {"prompt", "chosen", "rejected", "meta"}
        assert obj["chosen"] != obj["rejected"]
        assert obj["meta"]["contextKey"] == "p|step|aaa"


def test_export_endpoint_rejects_unknown_format():
    r = client.get(f"{API}/preferences/export", params={"format": "csv"})
    assert r.status_code == 400
