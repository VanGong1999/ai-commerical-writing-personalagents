import asyncio
import json
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from datetime import timedelta
from threading import Barrier, Event

import pytest
from fastapi import HTTPException
from sqlalchemy import text
from sqlmodel import SQLModel, Session, create_engine, select

from app import db
from app.agent_inbox import reap_stale
from app.models import (AgentEvent, AgentRun, Conversation, InboxLease, Job, Message, Project,
                        RunStep, RunStepCounter, ThreadSubscription, utcnow)
from app.pipeline_checkpoint import _notice
from app.routers import personal_agent as pa
from app.routers.jobs import RunStepIn, append_run_step, project_replay_conversation_id
from app.run_lease import _note
from app.run_steps import conversation_steps, next_step_seq
from app.seed import DEMO_USER
from app.thread_router import deliver_completion
from app.watchdog import _append_watchdog_step


@pytest.fixture
def engine(tmp_path):
    database = create_engine(f"sqlite:///{tmp_path}/steps.db")
    with database.connect() as conn:
        assert conn.exec_driver_sql("PRAGMA journal_mode=WAL").scalar() == "wal"
    SQLModel.metadata.create_all(database)
    yield database
    database.dispose()


@pytest.mark.parametrize("virtual", [False, True])
def test_two_worker_transactions_allocate_above_duplicate_history(engine, virtual):
    cid = "project:p" if virtual else "group"
    with Session(engine) as s:
        s.add(Project(id="p", user_id=DEMO_USER, title="p", format="manju", stage="setup"))
        s.add(Conversation(id="group", project_id="p", user_id=DEMO_USER))
        for worker in ("a", "c"):
            binding = None if virtual else cid
            s.add(AgentRun(id=worker, agent_id=worker, project_id="p", conversation_id=binding))
            s.add(Job(id="job-"+worker, type="agent.run", project_id="p", user_id=DEMO_USER,
                      conversation_id=binding, result_ref=worker, payload={"agentId": worker}))
        for i, seq in enumerate([0, 5, 5, 6, 6, 7, 7]):
            s.add(RunStep(id=f"old{i}", conversation_id=cid, seq=seq))
        s.commit()
    start = Barrier(2)

    def produce(worker):
        with Session(engine) as s:
            start.wait(timeout=5)
            return [append_run_step(worker, RunStepIn(job_id="job-"+worker, actor=worker,
                    turn_id=f"turn-{n}", kind="status", payload={"n": n}), s)["id"] for n in range(12)]

    with ThreadPoolExecutor(2) as workers:
        expected = dict(zip(("a", "c"), workers.map(produce, ("a", "c"))))
    with Session(engine) as s:
        rows = s.exec(conversation_steps(cid, 0, None)).all()
        assert [r.seq for r in rows] == [0, 5, 5, 6, 6, 7, 7, *range(8, 32)]
        for actor, ids in expected.items():
            assert [(r.id, r.turn_id, r.payload) for r in rows if r.actor == actor and r.run_id == actor
                    ] == [(identity, f"turn-{n}", {"n": n}) for n, identity in enumerate(ids)]
        assert next_step_seq(s, project_replay_conversation_id(None, "separate")) == 1
        assert next_step_seq(s, "project:another") == 1


@pytest.mark.parametrize("commit", [True, False])
def test_blocked_writer_observer_and_business_rollback(engine, commit):
    attempted = Event()

    def second():
        with Session(engine) as s:
            attempted.set()
            return pa._append_run_step(s, "c", "reply", {}).seq

    with ThreadPoolExecutor(1) as pool, Session(engine) as first:
        _notice(first, Conversation(id="c"), dict(executionId="e", stageId="s", projectId="p",
                memberPosition=1), "waiting", "gate")
        first.flush()
        later = pool.submit(second)
        assert attempted.wait(2)
        with pytest.raises(TimeoutError):
            later.result(timeout=0.15)
        with Session(engine) as observer:
            assert observer.get(RunStepCounter, "c") is None
            assert not observer.exec(select(RunStep)).all()
            assert not observer.exec(select(Message)).all()
        first.commit() if commit else first.rollback()
        assert later.result(timeout=3) == (2 if commit else 1)
    with Session(engine) as s:
        assert len(s.exec(select(Message)).all()) == int(commit)
        assert len(s.exec(select(RunStep)).all()) == s.get(RunStepCounter, "c").last_seq == 1 + int(commit)


def test_completion_recovery_and_maintenance_share_counter(engine):
    past = utcnow() - timedelta(hours=1)
    with Session(engine) as s:
        run = AgentRun(id="r", agent_id="a", conversation_id="c", status="succeeded")
        sub = ThreadSubscription(conversation_id="c", run_id="r", thread_key="project:p", mode="observe")
        s.add_all([run, sub, InboxLease(conversation_id="c", token="expired", expires_at=past)])
        for token in ("expired", None):
            s.add(AgentEvent(conversation_id="c", status="processing", owner_token=token,
                             claimed_at=past, source="web"))
        s.commit()
        assert len(reap_stale(s)) == 2
        _note(s, run, {"reason": "lease_reclaimed"})
        _append_watchdog_step(s, "c", {"reason": "stuck_run"}, run_id="r")
        s.commit()
        assert deliver_completion(s, run, run.status, claim_worker_notification=True)
        s.rollback()
        assert sub.status == "active"
        assert not s.exec(select(Message)).all()
        assert s.get(RunStepCounter, "c").last_seq == 4
        assert deliver_completion(s, run, run.status, claim_worker_notification=True)
        s.commit()
        assert not deliver_completion(s, run, run.status, claim_worker_notification=True)
        s.commit()
        assert sub.status == "completed"
        rows = s.exec(conversation_steps("c", 0, None)).all()
        assert [(r.seq, r.kind) for r in rows] == list(enumerate(
            ["watchdog"] * 4 + ["notification_claim", "agent_status"], start=1))


@pytest.mark.asyncio
async def test_historical_pages_and_reconnected_stream(engine, monkeypatch):
    monkeypatch.setattr(db, "engine", engine)
    with Session(engine) as s:
        s.add(Conversation(id="c", user_id=DEMO_USER))
        s.add(Conversation(id="other", user_id="different-owner"))
        for i in reversed(range(117)):
            s.add(RunStep(id=f"row{i:03d}", conversation_id="c", seq=0 if i < 56 else 7,
                          actor=str(i % 2), run_id=str(i % 3)))
        s.commit()

        def page(seq=0, identity=None, limit=None, actor=None, run=None):
            return pa.list_conversation_steps("c", s, seq, run, actor, identity, limit)["steps"]

        async def take(seq, identity, count):
            response = await pa.conversation_stream("c", seq, s, identity)
            events = []
            try:
                async for chunk in response.body_iterator:
                    data = json.loads(chunk.removeprefix("data: "))
                    if data["event"] == "step":
                        events.append(data)
                    if len(events) == count:
                        break
            finally:
                await response.body_iterator.aclose()
            return events

        first = await asyncio.wait_for(take(0, None, 51), timeout=5)
        pa._append_run_step(s, "c", "watchdog", {})
        last = first[-1]
        rest = await asyncio.wait_for(take(last["seq"], last["id"], 67), timeout=5)
        rows = page()
        assert [r["id"] for r in rows] == [r["id"] for r in first + rest]
        assert len({r["id"] for r in rows}) == 118
        assert page(7) == rows[-1:]
        assert page(0, last["id"], 1) == rows[51:52]
        filtered = [r for r in rows if r["actor"] == "1" and r["runId"] == "0"]
        paged = []
        while batch := page(paged[-1]["seq"] if paged else 0, paged[-1]["id"] if paged else None,
                            limit=4, actor="1", run="0"):
            paged.extend(batch)
        assert paged == filtered
        with pytest.raises(HTTPException) as denied:
            await pa.conversation_stream("other", 0, s, None)
        assert denied.value.status_code == 404
        with pytest.raises(HTTPException):
            pa.list_conversation_steps("other", s)


def test_stale_sqlite_snapshot_aborts_whole_business_transaction(engine):
    # An explicitly pinned read snapshot cannot upgrade after another writer.
    # No nested retry may advance the cursor or resurrect its stale business write.
    with Session(engine) as stale, Session(engine) as current:
        stale.connection().exec_driver_sql("BEGIN")
        assert not stale.exec(select(RunStep)).all()
        pa._append_run_step(current, "c", "watchdog", {})
        stale.add(Message(conversation_id="c", role="system", content="stale"))
        from sqlalchemy.exc import OperationalError
        with pytest.raises(OperationalError):
            pa._append_run_step(stale, "c", "reply", {})
        assert not stale.exec(select(Message)).all()
        assert stale.get(RunStepCounter, "c").last_seq == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("actor", ["chief", "bot"])
async def test_failed_trace_write_stops_turn_before_emit_or_inference(engine, monkeypatch, actor):
    from app import bot_registry, bot_runtime
    from app.models import Bot
    from sqlalchemy.exc import IntegrityError

    def forbidden(*args, **kwargs):
        pytest.fail("continued after a trace failure")

    monkeypatch.setattr(pa, "chat_completion", forbidden)
    monkeypatch.setattr(bot_runtime, "chat_completion", forbidden)
    with Session(engine) as s:
        conv = Conversation(id="c", user_id=DEMO_USER)
        bot = Bot(id="b", name="Bot", execution={"enabled": True})
        s.add_all([conv, bot])
        if actor == "chief":
            # The fallback chief's additional inbox event logs before inference.
            monkeypatch.setattr(bot_registry, "seed_system_bots", lambda session: None)
            s.add(AgentEvent(conversation_id="c", source="web", payload={"message": "new item"}))
        s.commit()
        s.execute(text("""CREATE TRIGGER reject_trace BEFORE INSERT ON runstep
            BEGIN SELECT RAISE(ABORT, 'ledger failure'); END"""))
        s.commit()
        with pytest.raises(IntegrityError, match="ledger failure"):
            if actor == "chief":
                await pa._run_supervisor(s, conv, forbidden)
            else:
                # A knowledge bot with no admitted work normally logs/emits a no-op.
                await bot_runtime._run_bot_turn_impl(s, conv, bot, forbidden)
        assert not s.exec(select(RunStep)).all()
        assert not s.exec(select(RunStepCounter)).all()
        if actor == "chief":
            assert s.exec(select(AgentEvent)).one().status == "failed"


def test_rejected_worker_owner_and_receipt_lease_do_not_advance_counter(engine):
    with Session(engine) as s:
        for pid, owner in [("mine", DEMO_USER), ("theirs", "someone-else")]:
            s.add(Project(id=pid, user_id=owner, title="p", format="manju", stage="setup"))
            s.add(AgentRun(id=pid, project_id=pid, agent_id="a", status="running",
                           lease_version=2, lease_until=utcnow()+timedelta(minutes=5)))
            s.add(Job(id="j-"+pid, type="agent.run", project_id=pid, result_ref=pid,
                      payload={"agentId":"a"}, user_id=owner))
        s.commit()
        with pytest.raises(HTTPException) as wrong:
            append_run_step("theirs", RunStepIn(job_id="j-theirs"), s)
        assert wrong.value.status_code == 404
        s.rollback()
        with pytest.raises(HTTPException) as stale:
            append_run_step("mine", RunStepIn(job_id="j-mine", kind="receipt",
                payload={"terminalResult":{"runId":"mine"}, "jobId":"j-mine", "leaseVersion":1}), s)
        assert stale.value.status_code == 409
        s.rollback()
        assert not s.exec(select(RunStepCounter)).all()
        assert not s.exec(select(RunStep)).all()


@pytest.mark.asyncio
async def test_stream_message_keeps_persisted_group_identity_and_metadata(engine, monkeypatch):
    monkeypatch.setattr(db, "engine", engine)
    with Session(engine) as session:
        session.add(Conversation(id="group", user_id=DEMO_USER))
        session.add(Message(id="stored", conversation_id="group", role="tool", content="",
                            bot_id="agent:fixture", run_id="r", mentions=["member"],
                            tool_calls=[{"id": "call"}], actions=[{"type": "status"}],
                            evidence=[{"kind": "receipt", "id": "e"}]))
        session.commit()
        expected = pa.list_messages("group", session)[0].model_dump(by_alias=True, mode="json")
        for _ in range(2):
            stream = await pa.conversation_stream("group", 0, session)
            try:
                event = json.loads((await anext(stream.body_iterator)).removeprefix("data: "))
                assert event == {"event": "message", **expected}
                assert event["botId"] and event["runId"] and event["toolCalls"] and event["mentions"]
            finally:
                await stream.body_iterator.aclose()
