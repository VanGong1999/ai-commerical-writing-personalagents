"""Thread 订阅与直通。"""

from __future__ import annotations

from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.agent_inbox import claim_pending, steer_mailbox
from app.models import AgentRun, Conversation
from app.seed import DEMO_USER
from app.thread_router import (
    project_thread_key,
    route_job_done,
    route_user_message,
    upsert_subscription,
)

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
SQLModel.metadata.create_all(engine)


def test_steer_when_run_active():
    with Session(engine) as session:
        conv = Conversation(user_id=DEMO_USER, source="assistant", title="t")
        session.add(conv)
        session.commit()
        session.refresh(conv)
        run = AgentRun(
            agent_id="topic.core_hook_batch",
            status="running",
            conversation_id=conv.id,
            project_id="p1",
        )
        session.add(run)
        session.commit()
        session.refresh(run)
        upsert_subscription(
            session,
            thread_key=project_thread_key("p1"),
            conversation_id=conv.id,
            run_id=run.id,
            agent_id=run.agent_id,
            project_id="p1",
        )
        route = route_user_message(
            session,
            conversation_id=conv.id,
            message="改得更狠一点",
            project_id="p1",
        )
        assert route["action"] == "steer"
        assert route["run_id"] == run.id
        steered = claim_pending(session, steer_mailbox(run.id))
        assert len(steered) == 1
        assert "狠" in (steered[0].payload or {}).get("message", "")

        # 元操作不得被活跃订阅劫持 → 总编 wake_chief
        meta = route_user_message(
            session,
            conversation_id=conv.id,
            message="请 schedule_task：name=巡检，cron=0 9 * * *",
            project_id="p1",
        )
        assert meta["action"] == "wake_chief"
        assert meta.get("meta") is True


def test_job_done_observe_vs_wake():
    with Session(engine) as session:
        conv = Conversation(user_id=DEMO_USER, source="assistant", title="t2")
        session.add(conv)
        session.commit()
        session.refresh(conv)
        run = AgentRun(
            agent_id="char.bio_manju",
            status="succeeded",
            conversation_id=conv.id,
            project_id="p2",
            output_artifact_ids=["a1"],
        )
        session.add(run)
        session.commit()
        session.refresh(run)
        upsert_subscription(
            session,
            thread_key=project_thread_key("p2"),
            conversation_id=conv.id,
            run_id=run.id,
            agent_id=run.agent_id,
            project_id="p2",
            mode="observe",
        )
        r = route_job_done(session, conversation_id=conv.id, run=run, status="succeeded")
        assert r["action"] == "observe_only"

        run2 = AgentRun(
            agent_id="char.bio_manju",
            status="failed",
            conversation_id=conv.id,
            project_id="p2",
        )
        session.add(run2)
        session.commit()
        session.refresh(run2)
        upsert_subscription(
            session,
            thread_key=project_thread_key("p2"),
            conversation_id=conv.id,
            run_id=run2.id,
            agent_id=run2.agent_id,
            project_id="p2",
            mode="observe",
        )
        r2 = route_job_done(session, conversation_id=conv.id, run=run2, status="failed")
        assert r2["action"] == "wake_chief"
