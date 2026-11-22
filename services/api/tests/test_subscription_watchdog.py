from datetime import timedelta

import pytest
from sqlmodel import SQLModel, Session, create_engine, select

from app.models import AgentEvent, AgentRun, Conversation, RunStep, ThreadSubscription, utcnow
from app.watchdog import scan


@pytest.mark.parametrize("status", ["paused", "waiting_approval", "pending_deps", "failed", "succeeded", "cancelled", "dead"])
def test_watchdog_subscription_scope_and_dedupe(tmp_path, status):
    engine = create_engine(f"sqlite:///{tmp_path / 'watchdog.db'}")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        conv = Conversation(user_id="test")
        run = AgentRun(agent_id="test", conversation_id=conv.id, status=status,
                       created_at=utcnow() - timedelta(hours=1))
        sub = ThreadSubscription(thread_key="project:test", conversation_id=conv.id, run_id=run.id)
        previous = RunStep(conversation_id=conv.id, run_id=run.id, seq=1, kind="watchdog",
                           actor="system", payload={"reason": "stuck"})
        session.add_all([conv, run, sub, previous])
        session.commit()
        for _ in range(2):
            scan(session, announce=False)
        steps = session.exec(select(RunStep)).all()
        warnings = [step for step in steps if step.payload.get("reason") == "subscription_unreleased"]
        assert not warnings
        terminal = status in {"failed", "succeeded", "cancelled", "dead"}
        assert sub.status == ("completed" if terminal else "active")
        assert not session.exec(select(AgentEvent)).all()
        if terminal:
            receipts = [step for step in steps if step.kind == "agent_status"]
            assert len(receipts) == 1
            assert receipts[0].payload["missingCompletion"]
            assert receipts[0].payload["passiveRepair"]


def test_history_scope_and_continuation(tmp_path):
    from app.routers.personal_agent import _current_watchdog_steps
    from app.thread_router import route_user_message
    from app.watchdog import reconcile_subscriptions

    engine = create_engine(f"sqlite:///{tmp_path / 'history.db'}")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        conv = Conversation(user_id="test")
        run = AgentRun(agent_id="test", status="succeeded", conversation_id=conv.id)
        sub = ThreadSubscription(thread_key="project:p", mode="observe", conversation_id=conv.id, run_id=run.id)
        observer = ThreadSubscription(thread_key="project:p", mode="observe", conversation_id=conv.id)
        leak = RunStep(conversation_id=conv.id, run_id=run.id, kind="watchdog", seq=1,
                       payload={"reason": "subscription_unreleased", "subId": sub.id})
        stuck = RunStep(conversation_id=conv.id, run_id=run.id, kind="watchdog", seq=2,
                        payload={"reason": "stuck_run"})
        session.add_all([conv, run, sub, observer, leak, stuck])
        session.commit()
        assert {r.id for r in _current_watchdog_steps(session, 30)} == {leak.id, stuck.id}
        reconcile_subscriptions(session)
        session.commit()
        assert [r.id for r in _current_watchdog_steps(session, 30, conv.id)] == [stuck.id]
        assert session.get(RunStep, leak.id).payload["reason"] == "subscription_unreleased"
        assert observer.status == "active"
        routed = route_user_message(session, conversation_id=conv.id, project_id="p",
                                    message="继续", force_continue=True)
        assert routed["parent_run_id"] == run.id


@pytest.mark.parametrize("mode", ["wake", "observe"])
def test_concurrent_completion_and_stale_resume(tmp_path, mode):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from app.models import Message
    from app.thread_router import deliver_completion

    engine = create_engine(f"sqlite:///{tmp_path / 'concurrent.db'}")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        conv = Conversation(user_id="test")
        run = AgentRun(agent_id="test", status="succeeded", conversation_id=conv.id)
        sub = ThreadSubscription(thread_key="project:p", mode=mode, conversation_id=conv.id, run_id=run.id)
        session.add_all([conv, run, sub])
        session.commit()
        rid, sid = run.id, sub.id
    barrier = Barrier(2)
    def notify(_):
        with Session(engine) as session:
            run = session.get(AgentRun, rid)
            barrier.wait(timeout=5)
            delivered = deliver_completion(session, run, "succeeded")
            session.commit()
            return delivered
    with ThreadPoolExecutor(2) as pool:
        assert sorted(pool.map(notify, range(2))) == [False, True]
    with Session(engine) as session:
        assert len(session.exec(select(AgentEvent)).all()) == int(mode == "wake")
        assert len(session.exec(select(Message)).all()) == int(mode == "observe")
        stale = session.get(AgentRun, rid)
        with Session(engine) as other:
            resumed = other.get(AgentRun, rid)
            resumed.status = "running"
            other.get(ThreadSubscription, sid).status = "active"
            other.commit()
        assert not deliver_completion(session, stale, "succeeded", legacy_sub_id=sid)
        session.commit()
        assert session.get(ThreadSubscription, sid).status == "active"


def test_paused_subscription_routes_after_explicit_resume(tmp_path, monkeypatch):
    from app import run_lease, task_daemon
    from app.thread_router import route_user_message

    for name in ("enqueue_job", "publish_job_event", "publish_task_event"):
        monkeypatch.setattr(task_daemon, name, lambda *args, **kwargs: None)
    engine = create_engine(f"sqlite:///{tmp_path / 'resume.db'}")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        conv = Conversation(user_id="test")
        run = AgentRun(agent_id="test", status="paused", conversation_id=conv.id,
                       exec_checkpoint={"turn": 7})
        sub = ThreadSubscription(thread_key="project:p", conversation_id=conv.id, run_id=run.id)
        session.add_all([conv, run, sub])
        session.commit()
        scan(session, announce=False)
        assert run_lease.resume(session, run.id)["status"] == "queued"
        assert run.exec_checkpoint["turn"] == 7
        routed = route_user_message(session, conversation_id=conv.id, thread_key="project:p", message="改")
        assert (routed["action"], routed["run_id"]) == ("steer", run.id)


def test_unroutable_terminal_mismatch_alert_is_deduped(tmp_path):
    from app.watchdog import reconcile_subscriptions

    engine = create_engine(f"sqlite:///{tmp_path / 'mismatch.db'}")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        conv = Conversation(user_id="test")
        other = Conversation(user_id="test")
        run = AgentRun(agent_id="test", conversation_id=other.id, status="dead")
        sub = ThreadSubscription(thread_key="project:p", conversation_id=conv.id, run_id=run.id)
        noisy = RunStep(conversation_id=conv.id, run_id=run.id, kind="watchdog",
                        payload={"reason": "stuck_run"})
        session.add_all([conv, other, run, sub, noisy])
        session.commit()
        assert reconcile_subscriptions(session)[0]["subId"] == sub.id
        session.commit()
        assert reconcile_subscriptions(session) == []
        assert sub.status == "active"


def test_fresh_terminal_watchdog_delivers_once(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'fresh.db'}")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        conv = Conversation(user_id="test")
        run = AgentRun(agent_id="test", conversation_id=conv.id, status="cancelled", finished_at=utcnow())
        sub = ThreadSubscription(thread_key="project:p", conversation_id=conv.id, run_id=run.id)
        session.add_all([conv, run, sub])
        session.commit()
        scan(session, announce=False)
        scan(session, announce=False)
        assert len(session.exec(select(AgentEvent)).all()) == 1
        assert sub.status == "completed"


def test_late_subscription_closed_and_worker_notification_claimed(tmp_path, monkeypatch):
    from app import feishu_notify
    from app.routers.jobs import _maybe_announce_run
    from app.thread_router import upsert_subscription

    calls = []
    monkeypatch.setattr(feishu_notify, "announce_run_finished", lambda *a, **kw: calls.append(kw))
    engine = create_engine(f"sqlite:///{tmp_path / 'late.db'}")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        conv = Conversation(user_id="test")
        run = AgentRun(agent_id="test", conversation_id=conv.id, status="succeeded", finished_at=utcnow())
        session.add_all([conv, run])
        session.commit()
        def subscribe():
            return upsert_subscription(session, thread_key="project:p", conversation_id=conv.id, run_id=run.id)
        subscribe()
        scan(session, announce=False)
        late = subscribe()
        for _ in range(2):
            scan(session, announce=False)
            _maybe_announce_run(session, run, run.status)
        assert (late.status, len(calls)) == ("completed", 1)
        assert len(session.exec(select(AgentEvent)).all()) == 1
        assert len([s for s in session.exec(select(RunStep)).all()
                    if late.id in s.payload.get("closedSubscriptionIds", [])]) == 1
