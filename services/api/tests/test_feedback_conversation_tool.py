"""Declared feedback through the shared Personal Agent/Bot executor."""
import asyncio
import pytest
from sqlmodel import Session, SQLModel, create_engine, select
from sqlalchemy.pool import StaticPool
from app.models import ActivityLog, Conversation, Message, Project, Bot
from app.routers.personal_agent import _execute_supervisor_tool, CORE_SUPERVISOR_TOOLS
from app.settings import get_settings

@pytest.fixture
def bound():
    db = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(db)
    with Session(db) as session:
        project = Project(user_id=get_settings().demo_user_id, title="feedback", format="manju", stage="S0_SETUP")
        session.add(project); session.commit()
        conv = Conversation(user_id=project.user_id, project_id=project.id, source="feishu")
        session.add(conv); session.commit()
        user = Message(conversation_id=conv.id, role="user", content="这一版需要修改，人物对白太长。")
        session.add(user); session.commit()
        yield session, conv, user

def test_feedback_records_once_without_inferred_outcome(bound):
    session, conv, user = bound
    args = {"user_statement": user.content, "decision": "revise", "reason": "人物对白太长"}
    _, detail = asyncio.run(_execute_supervisor_tool("record_writing_feedback", args, session, conv))
    assert detail["feedback"]["source"] == "declared"
    assert detail["feedback"]["outcome"] == "unknown"
    assert detail["feedback"]["decision"] == "revise"
    asyncio.run(_execute_supervisor_tool("record_writing_feedback", args, session, conv))
    rows = session.exec(select(ActivityLog).where(ActivityLog.action == "quality_feedback")).all()
    assert len(rows) == 1
    assert rows[0].project_id == conv.project_id

@pytest.mark.parametrize("case", ["foreign", "missing_context", "fabricated_quote", "inferred_success"])
def test_unbound_or_unstated_feedback_refused(bound, case):
    session, conv, user = bound
    args = {"user_statement": user.content, "decision": "revise", "reason": "对白太长"}
    if case == "foreign": args["project_id"] = "other-project"
    if case == "missing_context": conv.project_id = None
    if case == "fabricated_quote": args["user_statement"] = "编辑已经录用"
    if case == "inferred_success": args["outcome"] = "accepted"
    _, detail = asyncio.run(_execute_supervisor_tool("record_writing_feedback", args, session, conv))
    assert detail.get("error")
    assert not session.exec(select(ActivityLog).where(ActivityLog.action == "quality_feedback")).all()

def test_specialist_and_chief_receive_feedback_tool():
    from app.bot_runtime import tools_for_bot
    from app.trust_policy import requires_confirm
    for kind in ("chief", "specialist"):
        bot = Bot(name=kind, role_kind=kind, trust_level=1, tool_allowlist=["search_knowledge"])
        names = {(t.get("function") or {}).get("name") for t in tools_for_bot(bot, CORE_SUPERVISOR_TOOLS)}
        assert "record_writing_feedback" in names
    assert requires_confirm(tool_name="record_writing_feedback", trust_level=1)[0] is False

@pytest.mark.parametrize("statement,extra", [
    ("这本书已过稿了吗？", {"outcome": "accepted"}),
    ("这一版需要修改，人物对白太长。", {"decision": "adopt"}),
    ("也许已经过稿了。", {"outcome": "accepted"}),
    ("如果这一版修改好了，就采纳。", {"decision": "adopt"}),
    ("我不会采纳这一版。", {"decision": "adopt"}),
    ("我想问，这一版要修改吗？", {"decision": "revise"}),
])
def test_question_uncertainty_and_unsupported_decision_are_not_declarations(bound, statement, extra):
    session, conv, user = bound
    user.content = statement
    session.add(user); session.commit()
    _, detail = asyncio.run(_execute_supervisor_tool("record_writing_feedback", {"user_statement": statement, **extra}, session, conv))
    assert detail.get("error")
    assert not session.exec(select(ActivityLog).where(ActivityLog.action == "quality_feedback")).all()


@pytest.mark.parametrize("statement,extra", [
    ("我决定采纳这一版。", {"decision": "adopt"}),
    ("这一版需要修改，人物对白太长。", {"decision": "revise"}),
    ("这一版弃用，不要了。", {"decision": "discard"}),
    ("这本书已经过稿了。", {"outcome": "accepted"}),
])
def test_explicit_decisions_and_completed_outcomes_are_preserved(bound, statement, extra):
    session, conv, user = bound
    user.content = statement
    session.add(user); session.commit()
    _, detail = asyncio.run(_execute_supervisor_tool("record_writing_feedback", {"user_statement": statement, **extra}, session, conv))
    assert detail["feedback"][next(iter(extra))] == next(iter(extra.values()))
