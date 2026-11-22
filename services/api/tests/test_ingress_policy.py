"""统一 Ingress Fast Path。"""

from __future__ import annotations

from app.ingress_policy import decide


def test_web_must():
    d = decide(source="web", text="写核心梗")
    assert d.action == "must"


def test_feishu_group_silent():
    d = decide(
        source="feishu",
        text="今天天气不错",
        chat_type="group",
        mentioned=False,
        candidate_review=False,
    )
    assert d.action == "ignore"
    assert d.reason == "group_no_mention"


def test_feishu_group_candidate_review():
    d = decide(
        source="feishu",
        text="今天天气不错",
        chat_type="group",
        mentioned=False,
        candidate_review=True,
    )
    assert d.action == "candidate"


def test_feishu_writing_trigger():
    d = decide(
        source="feishu",
        text="帮我写大纲",
        chat_type="group",
        mentioned=False,
    )
    assert d.action == "must"


def test_timer_and_job_done():
    assert decide(source="timer", text="跟进").action == "must"
    assert decide(source="job_done", text="").action == "must"
