"""scheduler 事件触发例程：event_filter 匹配与唤醒（Fix 1）。"""

from __future__ import annotations

import importlib.util
from datetime import timedelta
from pathlib import Path

from app.bot_registry import CHIEF_BOT_ID, seed_system_bots
from app.db import engine, init_db
from app.models import AgentEvent, ScheduledTask, utcnow
from sqlmodel import Session, select


def _load_scheduler():
    path = Path(__file__).resolve().parents[2] / "scheduler" / "main.py"
    spec = importlib.util.spec_from_file_location("xzm_scheduler_main", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def test_match_recent_events_filters():
    mod = _load_scheduler()
    init_db()
    with Session(engine) as session:
        now = utcnow()
        session.add(
            AgentEvent(
                conversation_id="conv-1",
                source="job_done",
                payload={"agent_id": "prose.write", "status": "done"},
            )
        )
        session.add(
            AgentEvent(
                conversation_id="conv-1",
                source="job_done",
                payload={"agent_id": "qc.de_ai", "status": "done"},
            )
        )
        session.add(AgentEvent(conversation_id="conv-1", source="web", payload={"message": "hi"}))
        session.commit()

        ef = {"sources": ["job_done"], "agent_id_prefix": "prose."}
        hits = mod._match_recent_events(session, ef, now - timedelta(minutes=5))
        assert len(hits) == 1
        assert hits[0].payload["agent_id"] == "prose.write"

        # 未命中来源 / 未命中前缀都不该返回
        assert mod._match_recent_events(session, {"sources": ["timer"]}, now - timedelta(minutes=5)) == []
        assert mod._match_recent_events(
            session, {"sources": ["job_done"], "agent_id_prefix": "qc."}, now - timedelta(minutes=5)
        )[0].payload["agent_id"] == "qc.de_ai"


def test_dispatch_event_routine_wakes_bot():
    mod = _load_scheduler()
    init_db()
    with Session(engine) as session:
        bots = seed_system_bots(session)
        chief = next(b for b in bots if b.id == CHIEF_BOT_ID)
        task = ScheduledTask(
            id="test.event.routine",
            name="事件例程",
            cron_or_interval="1h",
            enabled=True,
            bot_id=chief.id,
            prompt="看到 prose 完成就汇报",
            trigger_type="event",
            event_filter={"sources": ["job_done"], "agent_id_prefix": "prose."},
        )
        session.add(task)
        session.add(
            AgentEvent(
                conversation_id="conv-1",
                source="job_done",
                payload={"agent_id": "prose.write", "status": "done", "run_id": "r1"},
            )
        )
        session.commit()

        mod._dispatch_event_routine(session, task, utcnow())

        rows = list(session.exec(select(AgentEvent).where(AgentEvent.source == "routine")))
        assert rows
        assert any("事件触发" in (r.payload or {}).get("message", "") for r in rows)
        # 第二次调用不该重复唤醒（last_run_at 前移 + 事件去重）
        before = len(rows)
        mod._dispatch_event_routine(session, task, utcnow())
        after = len(list(session.exec(select(AgentEvent).where(AgentEvent.source == "routine"))))
        assert after == before


def test_schedule_claim_rejects_stale_second_scheduler_and_rolls_back_with_dispatch():
    mod = _load_scheduler()
    init_db()
    now = utcnow()
    with Session(engine) as seed:
        task = ScheduledTask(id="test.claim.schedule", name="并发定时", cron_or_interval="1h", next_run_at=now, enabled=True)
        seed.add(task)
        seed.commit()
    with Session(engine) as first, Session(engine) as second:
        a = first.get(ScheduledTask, "test.claim.schedule")
        b = second.get(ScheduledTask, "test.claim.schedule")
        occurrence = mod._claim_schedule(first, a, now)
        assert occurrence is not None
        first.commit()
        assert mod._claim_schedule(second, b, now + timedelta(seconds=1)) is None
        second.rollback()
    with Session(engine) as session:
        task = session.get(ScheduledTask, "test.claim.schedule")
        before = task.next_run_at
        assert mod._claim_schedule(session, task, now + timedelta(hours=1)) is not None
        session.rollback()
        session.refresh(task)
        assert task.next_run_at == before


def test_active_window_uses_shanghai_hours():
    mod = _load_scheduler()
    now = utcnow().replace(hour=1, minute=0)
    task = ScheduledTask(id="test.window", name="早间例程", cron_or_interval="1h", active_window={"start_hour": 9, "end_hour": 10})
    assert mod._in_active_window(task, now)
    assert not mod._in_active_window(task, now.replace(hour=9))

def test_routine_claim_is_not_committed_before_durable_inbox_event(monkeypatch):
    import pytest
    from sqlmodel import SQLModel, create_engine
    from sqlalchemy.pool import StaticPool
    import app.agent_inbox as inbox
    mod = _load_scheduler()
    isolated = create_engine('sqlite://', connect_args={'check_same_thread':False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(isolated)
    now=utcnow()
    due=now-timedelta(minutes=1)
    def interrupted(*args,**kwargs):
        raise RuntimeError('interrupted before inbox commit')
    monkeypatch.setattr(inbox,'submit_event',interrupted)
    with Session(isolated) as session:
        from app.models import Bot
        session.add(Bot(id="bot",name="已绑定同事",owner_user_id=mod.get_settings().demo_user_id))
        task=ScheduledTask(id='crash-routine' ,name='恢复测试',cron_or_interval='1h',enabled=True,bot_id='bot',next_run_at=due)
        session.add(task);session.commit();session.refresh(task)
        occurrence=mod._claim_schedule(session,task,now)
        assert occurrence is not None
        with pytest.raises(RuntimeError,match='interrupted'):
            mod._enqueue_bot_routine(session,task,now,schedule_occurrence=occurrence)
        session.rollback()
    with Session(isolated) as session:
        assert session.get(ScheduledTask,'crash-routine').next_run_at.replace(tzinfo=None) == due.replace(tzinfo=None)
    isolated.dispose()
