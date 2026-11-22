"""Personal Agent / Bot 代操作：审计 + 通知策略 + 生命周期工具。"""

from __future__ import annotations

import asyncio
from unittest.mock import patch

from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app import action_audit
from app.models import ActivityLog, AgentRun, Bot, Conversation, Job
from app.routers.personal_agent import _TOOL_INDEX, _audit_safe, _execute_supervisor_tool

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
SQLModel.metadata.create_all(engine)


def _conv(s: Session) -> Conversation:
    conv = Conversation(source="web", user_id="u", title="t")
    s.add(conv)
    s.commit()
    s.refresh(conv)
    return conv


def _run(s: Session, status="running") -> AgentRun:
    r = AgentRun(agent_id="prose.episode_body", project_id="p1", status=status)
    s.add(r)
    s.commit()
    s.refresh(r)
    s.add(Job(type="agent.run", payload={}, user_id="u", result_ref=r.id, status="running"))
    s.commit()
    return r


def test_notify_policy_matrix():
    assert action_audit.should_notify("none", "stop_agent") is False
    assert action_audit.should_notify("all", "write_memory") is True
    assert action_audit.should_notify("important", "write_memory") is False
    assert action_audit.should_notify("important", "stop_agent") is True
    assert action_audit.should_notify("important", "adopt_artifact") is True
    assert action_audit.tool_requires_audit("agent_ps") is False
    assert action_audit.tool_requires_audit("agent_pause") is True
    assert action_audit.tool_requires_audit("tool_search") is False


def test_lifecycle_tools_registered_but_not_core():
    from app.routers.personal_agent import CORE_SUPERVISOR_TOOLS

    core = {(t.get("function") or {}).get("name") for t in CORE_SUPERVISOR_TOOLS}
    for n in ("agent_ps", "agent_inspect", "agent_pause", "agent_resume"):
        assert n in _TOOL_INDEX
        assert n not in core  # 默认工具面不膨胀，按需 tool_search 发现


def test_pause_resume_via_tools_audited_with_undo_and_notified():
    with Session(engine) as s:
        conv = _conv(s)
        run = _run(s)
        events: list[dict] = []
        with patch("app.action_audit.publish_task_event", side_effect=events.append):
            text, detail = asyncio.run(_execute_supervisor_tool("agent_pause", {"run_id": run.id}, s, conv))
            assert "已暂停" in text
            _audit_safe(s, conv, "agent_pause", {"run_id": run.id}, text, detail)
        s.refresh(run)
        assert run.control_signal == "pause" or run.status == "paused"
        rows = [r for r in s.exec(select(ActivityLog)) if (r.detail or {}).get("audit") and r.action == "agent_pause"]
        assert rows and rows[0].detail["undo"]["action"] == "agent_resume"
        assert rows[0].detail["onBehalfOfUser"] is True
        assert any(e["type"] == "action_audit" and e["action"] == "agent_pause" for e in events)

        ps_text, ps_detail = asyncio.run(_execute_supervisor_tool("agent_ps", {}, s, conv))
        assert any(i["runId"] == run.id for i in ps_detail["instances"])
        ins_text, ins_detail = asyncio.run(_execute_supervisor_tool("agent_inspect", {"run_id": run.id}, s, conv))
        assert ins_detail["instance"]["runId"] == run.id


def test_bot_notify_policy_none_suppresses_push_but_keeps_audit():
    with Session(engine) as s:
        conv = _conv(s)
        bot = Bot(name="静音同事", notify_policy="none")
        s.add(bot)
        s.commit()
        events: list[dict] = []
        with patch("app.action_audit.publish_task_event", side_effect=events.append):
            action_audit.audit_tool_call(
                s,
                name="stop_agent",
                args={"run_id": "r1"},
                text="已请求停止",
                detail={"run_id": "r1"},
                conversation_id=conv.id,
                bot=bot,
            )
        assert events == []
        rows = [r for r in s.exec(select(ActivityLog)) if (r.detail or {}).get("audit") and r.actor == f"bot:{bot.id}"]
        assert len(rows) == 1 and rows[0].detail["target"] == "run:r1"


def test_audit_enriches_existing_activity_row_instead_of_duplicating():
    with Session(engine) as s:
        conv = _conv(s)
        s.add(ActivityLog(actor="assistant", action="schedule_task", summary="已定时", conversation_id=conv.id, detail={}))
        s.commit()
        with patch("app.action_audit.publish_task_event"):
            action_audit.audit_tool_call(
                s, name="schedule_task", args={}, text="已定时", detail={}, conversation_id=conv.id
            )
        rows = list(s.exec(select(ActivityLog).where(ActivityLog.conversation_id == conv.id)))
        assert len(rows) == 1 and rows[0].detail["audit"] is True


def test_readonly_and_failed_calls_are_not_audited():
    with Session(engine) as s:
        conv = _conv(s)
        assert action_audit.audit_tool_call(s, name="agent_ps", args={}, text="x", detail={}, conversation_id=conv.id) is None
        assert (
            action_audit.audit_tool_call(
                s, name="stop_agent", args={}, text="未知工具 stop_agent", detail={}, conversation_id=conv.id
            )
            is None
        )


def test_stop_agent_goes_through_lease_module():
    with Session(engine) as s:
        conv = _conv(s)
        run = _run(s)
        text, _ = asyncio.run(_execute_supervisor_tool("stop_agent", {"run_id": run.id}, s, conv))
        assert "已请求停止" in text
        s.refresh(run)
        assert run.status == "cancelled"
        text2, _ = asyncio.run(_execute_supervisor_tool("stop_agent", {"run_id": run.id}, s, conv))
        assert "已结束" in text2
