"""守护任务编排与审批挂起保护测试。"""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.agent_inbox import has_pending_confirm, list_pending_conversation_ids, submit_event
from app.db import engine, init_db
from app.main import app
from app.models import AgentRun, AsyncTaskGroup, Conversation, Message, Project, new_id, utcnow
from app.seed import DEMO_USER
from app import task_daemon as daemon


def setup_module() -> None:
    init_db()


def _session() -> Session:
    return Session(engine)


def test_create_task_group_and_unlock_independent_books() -> None:
    with _session() as session:
        p1 = Project(title="书A", format="short_novel", user_id=DEMO_USER, stage="S0_SETUP")
        p2 = Project(title="书B", format="short_novel", user_id=DEMO_USER, stage="S0_SETUP")
        session.add(p1)
        session.add(p2)
        session.commit()
        session.refresh(p1)
        session.refresh(p2)

        conv = Conversation(user_id=DEMO_USER, title="测试多书", source="assistant")
        session.add(conv)
        session.commit()
        session.refresh(conv)

        result = daemon.create_task_group(
            session,
            user_id=DEMO_USER,
            conversation_id=conv.id,
            title="双书并行",
            goal="同时写两本书第一章",
            kind="multi_book",
            approval_mode="auto_pilot",
            max_concurrency=4,
            tasks=[
                {
                    "project_id": p1.id,
                    "agent_id": "topic.core_hook_batch",
                    "instruction": "书A核心梗",
                    "label": "书A选题",
                    "checkpoint": False,
                },
                {
                    "project_id": p2.id,
                    "agent_id": "topic.core_hook_batch",
                    "instruction": "书B核心梗",
                    "label": "书B选题",
                    "checkpoint": False,
                },
            ],
        )
        assert result["task_group_id"]
        assert len(result["run_ids"]) == 2

        runs = list(
            session.exec(
                select(AgentRun).where(AgentRun.task_group_id == result["task_group_id"])
            )
        )
        # auto_pilot + 无依赖 → tick 后应已 queued
        assert all(r.status in {"queued", "running", "pending_deps"} for r in runs)
        queuedish = [r for r in runs if r.status == "queued"]
        assert len(queuedish) >= 1


def test_checkpoint_gate_waits_for_approval() -> None:
    with _session() as session:
        p = Project(title="审批书", format="manju", user_id=DEMO_USER, stage="S0_SETUP")
        session.add(p)
        session.commit()
        session.refresh(p)
        conv = Conversation(user_id=DEMO_USER, title="审批测试", source="assistant")
        session.add(conv)
        session.commit()
        session.refresh(conv)

        result = daemon.create_task_group(
            session,
            user_id=DEMO_USER,
            conversation_id=conv.id,
            title="需审批",
            goal="正文需确认",
            kind="multi_chapter",
            approval_mode="checkpoint_gate",
            max_concurrency=2,
            tasks=[
                {
                    "project_id": p.id,
                    "agent_id": "prose.episode_body",
                    "instruction": "写第1集",
                    "label": "第1集正文",
                    "checkpoint": True,
                }
            ],
        )
        run_id = result["run_ids"][0]
        run = session.get(AgentRun, run_id)
        assert run is not None
        # checkpoint_gate 下应进入 waiting
        assert run.approval_state == "waiting" or run.status == "pending_deps"

        daemon.approve_run(session, run_id, approve=True)
        run = session.get(AgentRun, run_id)
        assert run is not None
        assert run.approval_state == "approved"


def test_has_pending_confirm_blocks_background_pump() -> None:
    with _session() as session:
        conv = Conversation(user_id=DEMO_USER, title="确认挂起", source="assistant")
        session.add(conv)
        session.commit()
        session.refresh(conv)

        session.add(
            Message(
                id=new_id(),
                conversation_id=conv.id,
                role="assistant",
                content="需要确认写正文",
                actions=[{"type": "confirm_required", "tool": "run_agent", "args": {}}],
            )
        )
        session.commit()
        assert has_pending_confirm(session, conv.id) is True

        submit_event(
            session,
            conversation_id=conv.id,
            source="job_done",
            payload={"run_id": "x", "status": "succeeded"},
            dedupe_key=f"job_done:x:{utcnow().isoformat()}",
        )
        ids = list_pending_conversation_ids(session, limit=50)
        assert conv.id not in ids

        # 用户消息应仍可唤醒
        submit_event(
            session,
            conversation_id=conv.id,
            source="web",
            payload={"message": "先别写了"},
        )
        ids2 = list_pending_conversation_ids(session, limit=50)
        assert conv.id in ids2


def test_tasks_api_summary() -> None:
    client = TestClient(app)
    res = client.get("/api/v1/tasks/summary")
    assert res.status_code == 200
    body = res.json()
    assert "running" in body
    assert "slots" in body


def test_agents_overview() -> None:
    client = TestClient(app)
    res = client.get("/api/v1/agents/overview")
    assert res.status_code == 200
    body = res.json()
    assert body.get("personalAgent", {}).get("id") == "chief"
    assert body.get("stats", {}).get("domainAgents", 0) > 0
    assert "workflows" in body
    assert "toolsCatalog" in body
