"""AgentEvent 收件箱：去重 / 抢占 / 合并 / 步间注入 / reap。"""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.agent_inbox import (
    claim_additional,
    claim_pending,
    mark_done,
    merge_user_messages,
    render_event,
    reap_stale,
    submit_event,
)
from app.models import AgentEvent, Conversation, utcnow
from app.seed import DEMO_USER

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
SQLModel.metadata.create_all(engine)


def test_dedupe_and_claim():
    with Session(engine) as session:
        conv = Conversation(user_id=DEMO_USER, source="assistant", title="t")
        session.add(conv)
        session.commit()
        session.refresh(conv)

        a = submit_event(
            session,
            conversation_id=conv.id,
            source="web",
            payload={"message": "你好"},
            dedupe_key="m1",
        )
        b = submit_event(
            session,
            conversation_id=conv.id,
            source="web",
            payload={"message": "你好"},
            dedupe_key="m1",
        )
        assert a.id == b.id

        submit_event(
            session,
            conversation_id=conv.id,
            source="web",
            payload={"message": "第二句"},
            dedupe_key="m2",
        )
        batch = claim_pending(session, conv.id)
        assert len(batch) == 2
        assert merge_user_messages(batch).startswith("以下是连续收到")
        # 单活跃：再次 claim 应为空
        assert claim_pending(session, conv.id) == []
        mark_done(session, batch)
        # 完成后可再抢
        submit_event(
            session,
            conversation_id=conv.id,
            source="timer",
            payload={"note": "跟进"},
        )
        batch2 = claim_pending(session, conv.id)
        assert len(batch2) == 1
        assert "跟进" in merge_user_messages(batch2)


def test_claim_additional_while_busy():
    with Session(engine) as session:
        conv = Conversation(user_id=DEMO_USER, source="assistant", title="t2")
        session.add(conv)
        session.commit()
        session.refresh(conv)
        submit_event(session, conversation_id=conv.id, source="web", payload={"message": "一"})
        batch = claim_pending(session, conv.id)
        assert len(batch) == 1
        submit_event(session, conversation_id=conv.id, source="web", payload={"message": "二"})
        assert claim_pending(session, conv.id) == []
        extra = claim_additional(session, conv.id)
        assert len(extra) == 1
        assert "二" in (extra[0].payload or {}).get("message", "")


def test_render_event_inline_spill():
    ev = AgentEvent(
        conversation_id="c",
        source="job_done",
        payload={
            "run_id": "r1",
            "agent_id": "topic.x",
            "status": "succeeded",
            "project_id": "p1",
            "artifact_ids": ["a1"],
            "project_title": "测试",
        },
    )
    text = render_event(ev)
    assert "topic.x" in text
    assert "/runs/r1" in text
    assert "a1" in text


def test_reap_stale_processing():
    with Session(engine) as session:
        conv = Conversation(user_id=DEMO_USER, source="assistant", title="t3")
        session.add(conv)
        session.commit()
        session.refresh(conv)
        ev = submit_event(
            session,
            conversation_id=conv.id,
            source="web",
            payload={"message": "卡住"},
        )
        ev.status = "processing"
        # 回拨创建时间
        ev.created_at = utcnow() - timedelta(minutes=60)
        session.add(ev)
        session.commit()
        assert reap_stale(session, timeout_minutes=20) == []
        ev.claimed_at = utcnow() - timedelta(minutes=21)
        session.commit()
        stale = reap_stale(session, timeout_minutes=20)
        assert any(s.id == ev.id for s in stale)
        session.refresh(ev)
        assert ev.status == "failed"
