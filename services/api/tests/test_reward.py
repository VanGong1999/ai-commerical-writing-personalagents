"""GRPO 程序化奖励：评分、TRL 接口形状、奖励与人工偏好一致率、grpo_prompts 导出。"""

import json

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.db import engine, init_db
from app.eval.config import put_eval_config
from app.eval.feedback import create_preference, export_grpo_prompts
from app.eval.reward import (
    make_trl_reward_funcs,
    reward_agreement,
    score_completion,
)
from app.main import app
from app.models import PreferencePair

client = TestClient(app)
API = "/api/v1/eval"

CLEAN = "她推开门，屋里很暗，只有一盏灯还亮着。" * 60  # ~1000 字，无套路比喻/总结腔
BAD = CLEAN + "她像一朵凋零的牡丹。综上所述，她感到无比悲伤。"
SHORT = "太短了。"


def setup_module():
    init_db()
    with Session(engine) as session:
        session.exec(PreferencePair.__table__.delete())  # type: ignore[attr-defined]
        session.commit()


def test_style_phrases_do_not_change_default_reward():
    good = score_completion(CLEAN, format="manju", min_chars=800, max_chars=1200)
    bad = score_completion(BAD, format="manju", min_chars=800, max_chars=1200)
    assert good["total"] == bad["total"] == 1.0
    assert list(bad["breakdown"]) == ["common.length_band_manju"]


def test_length_out_of_band_is_penalised():
    res = score_completion(SHORT, format="manju", min_chars=800, max_chars=1200)
    assert res["verdicts"]["common.length_band_manju"] != "pass"
    assert res["total"] < 1.0


def test_score_range_is_unit_interval():
    for txt in (CLEAN, BAD, SHORT, ""):
        t = score_completion(txt)["total"]
        assert 0.0 <= t <= 1.0


def test_trl_reward_func_plain_strings():
    (fn,) = make_trl_reward_funcs(format="manju", min_chars=800, max_chars=1200)
    scores = fn([CLEAN, BAD])
    assert len(scores) == 2
    assert all(isinstance(s, float) for s in scores)
    assert scores[0] == scores[1]


def test_trl_reward_func_conversational_and_per_row_kwargs():
    (fn,) = make_trl_reward_funcs()
    completions = [[{"role": "assistant", "content": CLEAN}], [{"role": "assistant", "content": BAD}]]
    scores = fn(completions, format=["manju", "manju"], min_chars=[800, 800], max_chars=[1200, 1200])
    assert scores[0] == 1.0
    assert scores[1] == 1.0


def test_reward_agreement_counts():
    pairs = [(CLEAN, BAD), (SHORT, CLEAN), (CLEAN, SHORT)]
    out = reward_agreement(pairs, format="manju", min_chars=800, max_chars=1200)
    assert out["n"] == 3
    assert out["agree"] == out["tie"] == 1
    assert out["disagree"] == 1
    assert out["agreementRate"] == round(1 / 3, 4)


def test_reward_agreement_empty():
    out = reward_agreement([])
    assert out["n"] == 0
    assert out["agreementRate"] is None


def test_grpo_export_blocked_without_authorization():
    with Session(engine) as session:
        put_eval_config(session, {"preference_export_authorized": False})
        out = export_grpo_prompts(session, write_file=False)
    assert out["ok"] is False
    assert out["count"] == 0


def test_grpo_export_format_and_skips_bad_prompts(tmp_path, monkeypatch):
    import app.eval.feedback as fb

    monkeypatch.setattr(fb, "_EXPORT_DIR", tmp_path)
    with Session(engine) as session:
        put_eval_config(session, {"preference_export_authorized": True})
        session.exec(PreferencePair.__table__.delete())  # type: ignore[attr-defined]
        session.commit()
        # 有效 prompt
        create_preference(
            session,
            chosen_text=CLEAN,
            rejected_text=SHORT,
            source="bestofn_pick",
            prompt="写一段都市开篇，主角被退婚",
            context_key="p|s|1",
            format="manju",
        )
        # A/B 版本对比（prompt 太短）应被跳过
        create_preference(
            session,
            chosen_text=CLEAN + "甲",
            rejected_text=SHORT,
            source="ab_pick",
            prompt="版本对比",
            context_key="p|s|2",
            format="manju",
        )
        out = export_grpo_prompts(session, write_file=True)
        put_eval_config(session, {"preference_export_authorized": False})

    assert out["ok"] is True
    assert out["count"] == 1
    assert out["path"] and out["path"].endswith(".jsonl")
    lines = [json.loads(x) for x in open(out["path"], encoding="utf-8")]
    assert lines[0]["prompt"] == "写一段都市开篇，主角被退婚"
    assert set(lines[0]["meta"]) >= {"chosenCodeReward", "rejectedCodeReward", "source"}
    assert lines[0]["meta"]["chosenCodeReward"] > lines[0]["meta"]["rejectedCodeReward"]
    assert out["rewardAgreement"]["agree"] == 1


def test_grpo_endpoint_accepts_format():
    with Session(engine) as session:
        put_eval_config(session, {"preference_export_authorized": False})
    r = client.get(f"{API}/preferences/export", params={"format": "grpo_prompts", "writeFile": False})
    assert r.status_code == 200
    assert r.json()["ok"] is False
