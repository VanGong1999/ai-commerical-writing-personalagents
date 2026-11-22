from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from types import SimpleNamespace
import asyncio
from pathlib import Path

import pytest
from sqlmodel import SQLModel, Session, create_engine, select

from app import agent_inbox as inbox
from app.models import AgentEvent, InboxLease, RunStep, utcnow


@pytest.fixture
def database(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path}/race.db")
    SQLModel.metadata.create_all(engine)
    yield engine
    engine.dispose()


def race(database, operation):
    start = Barrier(2)
    def participant(_):
        with Session(database) as session:
            start.wait(timeout=5)
            return operation(session)
    with ThreadPoolExecutor(2) as workers:
        return list(workers.map(participant, range(2)))


def submit(session, cid, key=None):
    return inbox.submit_event(session, conversation_id=cid, source="web", payload={}, dedupe_key=key)


def test_cross_process_equivalent_sessions(database):
    assert len(set(race(database, lambda s: submit(s, "a", "same").id))) == 1
    with Session(database) as session:
        assert len(session.exec(select(AgentEvent)).all()) == 1
        assert submit(session, "b", "same").id != submit(session, "a", "same").id
        for _ in range(5):
            submit(session, "a")
        assert len(session.exec(select(AgentEvent)).all()) == 7
    sizes = race(database, lambda s: len(inbox.claim_pending(s, "a", limit=2)))
    assert sorted(sizes) == [0, 2]
    with Session(database) as observer:
        assert inbox.claim_additional(observer, "a") == []
        assert len(inbox.claim_pending(observer, "b")) == 1


def test_lease_recovery_and_stale_fencing(database):
    with Session(database) as old, Session(database) as new:
        event = submit(old, "c")
        event.created_at = utcnow() - timedelta(days=4)
        old.commit()
        batch = inbox.claim_pending(old, "c")
        assert not inbox.preempt_stale_processing(new, "c")
        lease = new.get(InboxLease, "c")
        lease.expires_at = utcnow() - timedelta(seconds=1)
        new.commit()
        assert len(inbox.reap_stale(new)) == 1
        assert not inbox.reap_stale(new)
        assert len(new.exec(select(RunStep)).all()) == 1
        assert inbox.list_pending_conversation_ids(new) == ["c"]
        successor = inbox.claim_pending(new, "c")
        with pytest.raises(inbox.LostInboxLease):
            inbox.mark_done(old, batch)
        old.rollback()
        with pytest.raises(inbox.LostInboxLease):
            inbox.check_owner(old, "c")
        inbox.mark_done(new, successor)


def test_uncertain_execution_not_replayed(database):
    with Session(database) as worker, Session(database) as watchdog:
        submit(worker, "c")
        batch = inbox.claim_pending(worker, "c")
        batch[0].execution_started = True
        worker.commit()
        watchdog.get(InboxLease, "c").expires_at = utcnow() - timedelta(seconds=1)
        watchdog.commit()
        assert inbox.reap_stale(watchdog)[0].status == "failed"
        assert not inbox.list_pending_conversation_ids(watchdog)


def test_legacy_duplicate_selection(database, monkeypatch):
    from app import db
    monkeypatch.setattr(db, "engine", database)
    with Session(database) as session:
        for cid, statuses in [("a", ("done","pending")), ("b", ("pending","pending"))]:
            for n, status in enumerate(statuses):
                session.add(AgentEvent(id=f"{cid}{n}", conversation_id=cid, dedupe_key="key",
                                       payload={"original": n}, status=status))
        session.commit()
        db.init_db()
        db.init_db()
        assert inbox.list_pending_conversation_ids(session) == ["b"]
        assert submit(session, "b", "key").id == "b0"
        assert [r.id for r in inbox.claim_pending(session, "b")] == ["b0"]
        assert session.get(AgentEvent, "a1").payload == {"original":1}
        assert session.get(AgentEvent, "a1").status == "superseded"
        assert session.get(AgentEvent, "a0").status == "done"


def test_sdk_envelope_duplicate_dispatch(database, monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2] / "feishu"))
    import handler
    monkeypatch.setattr(handler, "engine", database)
    hints = []
    dispatched = []
    monkeypatch.setattr(handler, "enqueue_message", lambda item, priority: hints.append(item))
    async def receive(item):
        dispatched.append(item)
    monkeypatch.setattr(handler, "handle_message_async", receive)
    message = SimpleNamespace(message_id="om-123", content='{"text":"批准"}', chat_id="chat")
    sdk = SimpleNamespace(event=SimpleNamespace(message=message, sender=None))
    for _ in range(2):
        handler.handle_message_event_sync(sdk)
    assert len(hints) == 2 and hints[0]["id"] == hints[1]["id"]
    for hint in hints:
        asyncio.run(handler._dispatch_ingress(hint["id"]))
    assert [item["ingress_id"] for item in dispatched] == ["om-123"]


@pytest.mark.asyncio
async def test_pump_progress(database, monkeypatch):
    from app import inbox_pump as pump, chief_runner, watchdog, task_daemon
    entered = asyncio.Event()
    finished = asyncio.Event()
    blocked = asyncio.Event()
    ticks = []
    sessions = []
    async def process(session, cid):
        sessions.append(session)
        if cid == "slow":
            entered.set()
            await blocked.wait()
        else:
            finished.set()
        return {}
    monkeypatch.setattr(pump, "engine", database)
    monkeypatch.setattr(pump, "list_pending_conversation_ids", lambda *args, **kw: ["slow","fast"])
    monkeypatch.setattr(chief_runner, "pump_one", process)
    monkeypatch.setattr(watchdog, "scan", lambda *args, **kw: ticks.append(1))
    monkeypatch.setattr(task_daemon, "tick", lambda s: {})
    try:
        await pump._tick()
        await asyncio.wait_for(entered.wait(), 1)
        await asyncio.wait_for(finished.wait(), 1)
        await pump._tick()
        assert len(ticks) == 2 and sessions[0] is not sessions[1]
    finally:
        await pump.stop_inbox_pump()


@pytest.mark.asyncio
async def test_control_during_slow_turn_and_recovery_message(database, monkeypatch):
    from app import chief_runner
    from app.bot_registry import seed_system_bots
    from app.models import Conversation, Message
    from app.routers import personal_agent as pa
    from app.schemas import ChatConversationIn
    from app.seed import DEMO_USER
    with Session(database) as worker, Session(database) as control:
        seed_system_bots(worker)
        conv = Conversation(user_id=DEMO_USER, source="assistant")
        worker.add(conv)
        worker.commit()
        cid = conv.id
        original = submit(worker, cid)
        pa._append_message(worker, cid, "user", "recovered", actions=inbox.inbox_event_actions([original]))
        entered, release = asyncio.Event(), asyncio.Event()
        async def supervisor(*args, **kwargs):
            entered.set()
            await release.wait()
            return "OK"
        monkeypatch.setattr(pa, "_run_supervisor", supervisor)
        work = asyncio.create_task(chief_runner.run_conversation_turns(worker, cid))
        try:
            await asyncio.wait_for(entered.wait(), 1)
            for _ in range(2):
                response = await pa.chat_conversation(cid, ChatConversationIn(message="agent_ps",client_message_id="client1"),control)
                chunks = [part async for part in response.body_iterator]
                assert chunks and "done" in chunks[0]
            assert len(control.exec(select(Message).where(Message.role == "user")).all()) == 2
            assert len(control.exec(select(Message).where(Message.role == "assistant")).all()) == 1
            assert not work.done()
            assert not inbox.reap_stale(control)
        finally:
            release.set()
            await work


def test_conflict_preserves_outer_work_and_rollback(database):
    with Session(database) as session:
        original = submit(session, "c", "key")
        note = RunStep(conversation_id="c", kind="test")
        session.add(note)
        existing = inbox.submit_event(session, conversation_id="c", source="web",
                                      payload={}, dedupe_key="key", commit=False)
        assert existing.id == original.id
        session.rollback()
        assert not session.exec(select(RunStep)).all()


@pytest.mark.asyncio
async def test_heartbeat_renews_while_owner_waits(database, monkeypatch):
    from types import SimpleNamespace
    clock = utcnow()
    tick = asyncio.Event()
    renewed = asyncio.Event()
    never = asyncio.Event()
    async def sleep(_seconds):
        if tick.is_set():
            renewed.set()
            await never.wait()
        else:
            await tick.wait()
    monkeypatch.setattr(inbox, "asyncio", SimpleNamespace(
        sleep=sleep, current_task=asyncio.current_task, create_task=asyncio.create_task,
        gather=asyncio.gather))
    monkeypatch.setattr(inbox, "utcnow", lambda: clock)
    with Session(database) as session, Session(database) as observer:
        submit(session, "c")
        batch = inbox.claim_pending(session, "c")
        async with inbox.maintain_owner(session, "c"):
            await asyncio.sleep(0)
            clock += timedelta(seconds=70)
            tick.set()
            await asyncio.wait_for(renewed.wait(), 1)
            clock += timedelta(seconds=30)
            assert not inbox.reap_stale(observer)
            assert not inbox.claim_pending(observer, "c")
        inbox.mark_done(session, batch)


def test_paused_turn_leaves_background_pending(database):
    from app.models import Message
    with Session(database) as session:
        session.add(Message(conversation_id="c", role="assistant", content="confirm?",
                            actions=[{"type": "confirm_required"}]))
        session.commit()
        background = inbox.submit_event(session, conversation_id="c", source="job_done", payload={})
        assert not inbox.claim_pending(session, "c")
        assert not session.get(InboxLease, "c")
        user = submit(session, "c")
        assert [row.id for row in inbox.claim_pending(session, "c")] == [user.id]
        assert background.status == "pending"


def test_fix1_owner_requires_requested_mailbox(database):
    with Session(database) as session:
        with pytest.raises(inbox.LostInboxLease):
            inbox.check_owner(session, "missing")
        submit(session, "parent")
        inbox.claim_pending(session, "parent")
        with pytest.raises(inbox.LostInboxLease):
            inbox.check_owner(session, "child")


@pytest.mark.asyncio
async def test_fix1_admission_takeover_skips_gateway(database, monkeypatch):
    from app import llm_service, llm_governor
    from unittest.mock import AsyncMock
    calls = []
    async def admit(**kwargs):
        with Session(database) as successor:
            successor.get(InboxLease, "c").expires_at = utcnow() - timedelta(seconds=1)
            successor.commit()
            inbox.reap_stale(successor)
            assert inbox.claim_pending(successor, "c")
        return "slot"
    async def gateway(*args, **kwargs):
        calls.append("dispatch")
        raise AssertionError("stale dispatch")
    monkeypatch.setattr(llm_service, "get_gateway", lambda: SimpleNamespace(chat=gateway))
    monkeypatch.setattr(llm_service, "_fallbacks_for", lambda *args: [])
    monkeypatch.setattr(llm_governor, "acquire", admit)
    monkeypatch.setattr(llm_governor, "keep_alive", AsyncMock())
    monkeypatch.setattr(llm_governor, "release", lambda *args: None)
    with Session(database) as session:
        submit(session, "c")
        inbox.claim_pending(session, "c")
        with pytest.raises(inbox.LostInboxLease):
            async with inbox.maintain_owner(session, "c"):
                await llm_service.chat_completion([], base_url="mock", api_key="mock")
    assert not calls


@pytest.mark.asyncio
async def test_fix1_followup_then_status(database, monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2] / "feishu"))
    import handler
    from app import chief_runner
    async def forbid(*args, **kwargs):
        pytest.fail("ingress worker entered inference")
    monkeypatch.setattr(chief_runner, "run_conversation_turns", forbid)
    monkeypatch.setattr(handler, "engine", database)
    received = []
    monkeypatch.setattr(handler, "get_delivery", lambda: SimpleNamespace(text=lambda *args: received.append(args)))
    import json
    hints = []
    monkeypatch.setattr(handler, "enqueue_message", lambda item, priority: hints.append(item))
    for text, remote_id in [("/followup hello", "om-follow"), ("/status", "om-status")]:
        message = SimpleNamespace(content=json.dumps({"text":text}), chat_id="oc", message_id=remote_id)
        sender = SimpleNamespace(sender_id=SimpleNamespace(open_id="ou"))
        handler.handle_message_event_sync(SimpleNamespace(event=SimpleNamespace(message=message, sender=sender)))
        await handler._dispatch_ingress(hints.pop()["id"])
    with Session(database) as s:
        event = s.exec(select(AgentEvent).where(AgentEvent.source == "feishu")).one()
        assert event.dedupe_key == "om-follow" and event.status == "pending"
    assert "状态" in received[-1][1]


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["card","message"])
async def test_fix1_busy_approval_retry(database, monkeypatch, kind):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2] / "feishu"))
    import handler
    from app.models import Message
    monkeypatch.setattr(handler, "engine", database)
    monkeypatch.setattr(handler, "get_delivery", lambda: SimpleNamespace(text=lambda *args: None))
    completed = []
    with Session(database) as owner:
        conv = handler.find_or_create_conversation(owner, open_id="ou", chat_id="oc", chat_type="p2p")
        cid = conv.id
        pending = Message(conversation_id=cid, role="assistant", actions=[{"type":"confirm_required"}])
        owner.add(pending)
        owner.commit()
        mid = pending.id
        submit(owner, cid)
        batch = inbox.claim_pending(owner, cid)
        async def approval(session, conv, **kwargs):
            try:
                async with inbox.conversation_owner(session, conv.id):
                    assert kwargs["message_id"] == mid
                    completed.append(mid)
                    return {"ok":True, "reply":"ok"}
            except inbox.InboxBusy:
                return {"ok":False, "error":"conversation_busy"}
        monkeypatch.setattr(handler, "respond_conversation_impl", approval)
        eid = handler._persist_ingress(dict(kind=kind, open_id="ou", chat_id="oc", text="批准",
            value={"action":"confirm","approve":True,"conversation_id":cid,"message_id":mid}),"om",0)
        await handler._dispatch_ingress(eid)
        assert owner.get(AgentEvent, eid).status == "ingress_busy"
        duplicate = await handler._dispatch_ingress(eid)
        assert "重试" in duplicate["toast"]["content"]
        inbox.mark_done(owner, batch)
        monkeypatch.setattr(handler, "utcnow", lambda: utcnow()+timedelta(minutes=1))
        await handler._dispatch_ingress(eid)
        await handler._dispatch_ingress(eid)
        assert completed == [mid]


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["backoff", "quota_fallback"])
async def test_fix1_guard_each_provider_attempt(database, monkeypatch, failure):
    from app import llm_service
    from llm_gateway import client, GatewaySettings
    import httpx
    requests = []
    def takeover():
        with Session(database) as other:
            other.get(InboxLease, "c").expires_at = utcnow() - timedelta(seconds=1)
            other.commit()
            inbox.reap_stale(other)
            assert inbox.claim_pending(other, "c")
    async def post(url, **kwargs):
        requests.append(url)
        if failure == "backoff":
            return httpx.Response(503, json={"error":"temporary"})
        takeover()
        return httpx.Response(429, json={"error":{"code":"insufficient_quota","message":"quota exhausted"}})
    async def backoff(_):
        takeover()
    monkeypatch.setattr(client, "_get_http_client", lambda: SimpleNamespace(post=post))
    monkeypatch.setattr(client, "asyncio_sleep", backoff)
    monkeypatch.setattr(llm_service, "get_gateway", lambda: client.LLMGateway(GatewaySettings()))
    monkeypatch.setattr(llm_service, "_fallbacks_for", lambda *a: [dict(base_url="mock2",api_key="test",model="test")])
    from app import llm_governor
    monkeypatch.setattr(llm_governor, "set_provider_cooldown", lambda *a, **kw: None)
    with Session(database) as session:
        submit(session, "c")
        inbox.claim_pending(session, "c")
        with pytest.raises(inbox.LostInboxLease):
            async with inbox.maintain_owner(session, "c"):
                await llm_service.chat_completion([], base_url="mock1", api_key="test", skip_admit=True)
    assert requests == ["mock1/chat/completions"]


@pytest.mark.asyncio
async def test_fix1_nested_turn_rejects_lost_ancestor(database):
    with Session(database) as parent, Session(database) as child, Session(database) as takeover:
        with pytest.raises(inbox.LostInboxLease):
            async with inbox.conversation_owner(parent, "parent"):
                async with inbox.conversation_owner(child, "child"):
                    takeover.get(InboxLease, "parent").expires_at = utcnow() - timedelta(seconds=1)
                    takeover.commit()
                    inbox.reap_stale(takeover)
                    with pytest.raises(inbox.LostInboxLease):
                        inbox.dispatch_guard.get()()


@pytest.mark.asyncio
async def test_fix1_busy_retry_exhaustion(database, monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2] / "feishu"))
    import handler
    monkeypatch.setattr(handler, "engine", database)
    attempts = []
    async def busy(item):
        attempts.append(item.get("approval_message_id"))
        return {"error":"conversation_busy", "approval_message_id":"original"}
    monkeypatch.setattr(handler, "handle_card_async", busy)
    clock = utcnow()
    monkeypatch.setattr(handler, "utcnow", lambda: clock)
    eid = handler._persist_ingress({"kind":"card","chat_id":"oc"}, "event", 1)
    for n in range(6):
        result = await handler._dispatch_ingress(eid)
        clock += timedelta(minutes=1)
    assert attempts == [None, "original", "original", "original"]
    assert "重新提交" in result["toast"]["content"]
    with Session(database) as session:
        assert session.get(AgentEvent, eid).status == "ingress_busy_exhausted"


@pytest.mark.parametrize("kind", ["card", "message"])
def test_fix2_queue_status_during_resumed_approval(database, monkeypatch, kind):
    import threading
    import json
    from app.models import Message
    from app.routers import personal_agent as pa
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2] / "feishu"))
    import handler
    monkeypatch.setattr(handler, "engine", database)
    monkeypatch.setattr(handler, "_MAX_APPROVAL_TASKS", 1, raising=False)
    entered = threading.Event()
    status = threading.Event()
    calls = []
    release = asyncio.Event()
    async def supervisor(*args, **kwargs):
        calls.append("resume")
        entered.set()
        await release.wait()
        return "done"
    async def approved_tool(*args, **kwargs):
        return "ok", {}
    async def watchdog():
        await asyncio.Event().wait()
    def delivered(chat, text):
        if chat == "other" and "状态" in text:
            status.set()
    monkeypatch.setattr(handler, "_watchdog_loop", watchdog)
    monkeypatch.setattr(handler, "get_delivery", lambda: SimpleNamespace(text=delivered, progress=lambda *a: None))
    monkeypatch.setattr(pa, "_execute_supervisor_tool", approved_tool)
    monkeypatch.setattr(pa, "_run_supervisor", supervisor)
    with Session(database) as s:
        conv = handler.find_or_create_conversation(s, open_id="ou", chat_id="oc", chat_type="p2p")
        pending = Message(conversation_id=conv.id, role="assistant", actions=[
            {"type":"confirm_required","tool":"agent_ps","args":{},"tool_call_id":"call"}])
        s.add(pending)
        s.commit()
        payload = dict(kind="card", chat_id="oc", open_id="ou", value=dict(
            action="confirm", approve=True, conversation_id=conv.id, message_id=pending.id))
        if kind == "message":
            payload = dict(kind="message", chat_id="oc", open_id="ou", text="批准", approval_message_id=pending.id)
        eid = handler._persist_ingress(payload, "first", 1)
        row = s.get(AgentEvent, eid)
        row.status = "ingress_busy"
        row.claimed_at = utcnow() - timedelta(seconds=4)
        s.commit()
    loop = handler.ensure_async_runtime()
    try:
        assert entered.wait(3)
        handler.enqueue_message({"kind":"ingress","id":eid})
        second = handler._persist_ingress(payload, "card2", 1)
        handler.enqueue_message({"kind":"ingress","id":second})
        msg = SimpleNamespace(content=json.dumps({"text":"/status"}), chat_id="other", message_id="status")
        handler.handle_message_event_sync(SimpleNamespace(event=SimpleNamespace(
            message=msg, sender=SimpleNamespace(sender_id=SimpleNamespace(open_id="ou2")))))
        assert status.wait(2), "the SDK control lane waited for approval inference"
        with Session(database) as s:
            assert s.get(AgentEvent, second).status == "ingress_ready"
            assert s.get(AgentEvent, eid).status == "ingress_processing"
        assert calls == ["resume"]
        if kind == "message":
            async def finish():
                task = handler._approval_tasks[eid]
                release.set()
                await task
                await handler._route_ingress(eid, wait_for_result=True)
            asyncio.run_coroutine_threadsafe(finish(), loop).result(3)
    finally:
        handler.stop_async_runtime()
    with Session(database) as s:
        assert s.get(AgentEvent, eid).status == ("done" if kind == "message" else "ingress_unknown")
        assert s.get(AgentEvent, second).status == "ingress_ready"
    assert calls == ["resume"]


@pytest.mark.asyncio
@pytest.mark.parametrize("initial", ["pending", "none", "reset"])
async def test_fix3_raw_approval_keeps_acceptance_target(database, monkeypatch, initial):
    import json
    from app.models import Message
    from app.routers import personal_agent as pa
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2] / "feishu"))
    import handler
    hints, dispatched = [], []
    monkeypatch.setattr(handler, "engine", database)
    monkeypatch.setattr(handler, "enqueue_message", lambda item, priority: hints.append(item["id"]))
    monkeypatch.setattr(handler, "_MAX_APPROVAL_TASKS", 1)
    monkeypatch.setattr(handler, "_approval_tasks", {"occupied": asyncio.current_task()})
    monkeypatch.setattr(handler, "get_delivery", lambda: SimpleNamespace(text=lambda *a: None))
    async def tool(*args, **kwargs):
        dispatched.append(args[1])
        return "done", {}
    async def supervisor(*args, **kwargs):
        return "done"
    monkeypatch.setattr(pa, "_execute_supervisor_tool", tool)
    monkeypatch.setattr(pa, "_run_supervisor", supervisor)
    def pending(session, cid, label):
        msg = Message(conversation_id=cid, role="assistant", actions=[
            {"type":"confirm_required","tool":"agent_ps","args":{"label":label},"tool_call_id":label}])
        session.add(msg)
        session.commit()
        return msg
    msg = SimpleNamespace(content=json.dumps({"text":"批准"}), chat_id="chat", message_id="remote")
    sdk = SimpleNamespace(event=SimpleNamespace(message=msg, sender=SimpleNamespace(sender_id=SimpleNamespace(open_id="ou"))))
    with Session(database) as session:
        conv = handler.find_or_create_conversation(session, open_id="ou", chat_id="chat")
        cid = conv.id
        a = pending(session, cid, "A") if initial != "none" else None
        aid = a.id if a else None
        handler.handle_message_event_sync(sdk)
        eid = hints[-1]
        await handler._route_ingress(eid)
        assert session.get(AgentEvent, eid).status == "ingress_ready"
        if a:
            a.actions = [{"type":"confirm_rejected"}]
            session.commit()
        if initial == "reset":
            conv = handler.reset_conversation(session, conv)
        b = pending(session, conv.id, "B")
        handler.handle_message_event_sync(sdk)
        assert hints == [eid, eid]
        handler._approval_tasks.clear()
        await handler._route_ingress(eid, wait_for_result=True)
        session.refresh(b)
        assert b.actions[0]["type"] == "confirm_required" and not dispatched
        receipt = session.get(AgentEvent, eid)
        session.refresh(receipt)
        assert receipt.payload["approval_conversation_id"] == cid
        assert receipt.payload["approval_message_id"] == aid
        assert receipt.payload["approval_target_status"] == ("bound" if aid else "no_pending_confirmation")
