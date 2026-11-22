"""信任分级与打扰策略单元测试。"""

from __future__ import annotations

from app.disturb_policy import build_catch_up_summary, decide_disturb
from app.trust_policy import (
    TRUST_OWN_ROLE,
    TRUST_PROPOSE,
    TRUST_READONLY,
    requires_confirm,
    trust_label,
    veto_window_applies,
)


def test_trust_labels():
    assert "只读" in trust_label(TRUST_READONLY)
    assert "否决" in trust_label(TRUST_OWN_ROLE) or "岗位" in trust_label(TRUST_OWN_ROLE)


def test_requires_confirm_readonly():
    need, reason = requires_confirm(tool_name="run_agent", trust_level=TRUST_READONLY, args={})
    assert need is True
    need2, _ = requires_confirm(tool_name="read_memory", trust_level=TRUST_READONLY, args={})
    assert need2 is False


def test_requires_confirm_irreversible():
    need, reason = requires_confirm(
        tool_name="adopt_artifact", trust_level=TRUST_PROPOSE, args={}
    )
    assert need is True
    need3, reason3 = requires_confirm(
        tool_name="adopt_artifact", trust_level=TRUST_OWN_ROLE, args={}
    )
    assert need3 is True
    assert veto_window_applies(reason3, TRUST_OWN_ROLE)


def test_disturb_silent_when_no_change():
    d = decide_disturb(quiet_policy="silent_if_nothing", has_change=False, completed=False)
    assert d == "silent"


def test_disturb_immediate_on_failure():
    d = decide_disturb(failed=True)
    assert d == "immediate"


def test_catch_up_summary():
    text = build_catch_up_summary(
        since_text="上次消息",
        events=[{"title": "tool_call", "detail": "run_agent"}],
        action_items=[{"title": "confirm_required", "context": "批准写正文"}],
    )
    assert "进度摘要" in text
    assert "需要你拍板" in text
