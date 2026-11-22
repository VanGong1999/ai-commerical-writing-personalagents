"""SQLite and SDK-boundary tests. The transport payload is a captured real reply."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Event
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from sqlmodel import SQLModel, Session, create_engine, select

from app import agent_inbox, chief_runner, feishu_notify, feishu_outbox as box
from app.models import AgentEvent, Conversation, FeishuDeliveryBind, InboxLease, Message, Project, utcnow
from app.routers import personal_agent as pa
from app.seed import DEMO_USER

# Captured assistant text from .xzm/live-selection-summary-current.json, events[done].
TEXT = '周衡声称自己整夜都在码头，却盯着自己的鞋底与晃动的茶杯露出破绽——通往码头的路刚铺好，只有废窑外才有这种红泥，他的说辞因此站不住脚。红泥这一线索把周衡的"码头不在场"指向废窑，而林月没有接话、只是伸手关上了门，沉默本身成了两人之间的张力所在。'


@pytest.fixture
def db(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path}/isolated.db")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as s:
        s.add(Conversation(id="c", user_id=DEMO_USER, source="feishu", external_chat_id="own-chat"))
        s.commit()
    yield engine
    engine.dispose()


def queue(db, text=TEXT, target="own-chat"):
    with Session(db) as s:
        msg = Message(conversation_id="c", role="assistant", content=text)
        s.add(msg)
        box.enqueue(s, msg, target)
        s.commit()
        return msg.id


def parts(db):
    with Session(db) as s:
        return s.exec(select(box.Part).order_by(box.Part.position)).all()


@pytest.mark.parametrize("response", [None, False])
def test_missing_ack_restart_stable_sdk_request(db, response, monkeypatch):
    mid = queue(db)
    received = Mock()
    client = Mock()
    client.im.v1.message.create = received
    accepted = SimpleNamespace(success=lambda: True, data=SimpleNamespace(message_id="remote-1"))
    received.side_effect = [response, accepted]
    monkeypatch.setattr(feishu_notify, "_get_client", lambda: client)
    now = utcnow()
    assert box.deliver_one(db, clock=lambda: now)
    before, = parts(db)
    assert (before.status, before.ambiguous, before.remote_id) == ("pending", True, None)
    with Session(db) as s:
        s.get(Conversation, "c").external_chat_id = "changed"
        s.commit()
    assert not box.deliver_one(db, clock=lambda: now)
    assert box.deliver_one(db, clock=lambda: now + timedelta(seconds=3))
    after, = parts(db)
    assert (after.status, after.message_id, after.remote_id) == ("delivered", mid, "remote-1")
    for call in received.call_args_list:
        body = call.args[0].request_body
        assert (body.uuid, body.content, body.receive_id) == (before.id, before.body, "own-chat")


def test_partial_cards_only_unaccepted_parts_retried(db, monkeypatch):
    queue(db, "\n\n".join([TEXT] * 90))
    rows = parts(db)
    assert len(rows) > 1
    sent = []
    def transport(row):
        sent.append(row.id)
        return None if len(sent) == 2 else f"remote-{row.position}"
    now = utcnow()
    assert box.deliver_one(db, transport=transport, clock=lambda: now)
    assert box.deliver_one(db, transport=transport, clock=lambda: now)
    assert not box.deliver_one(db, transport=transport, clock=lambda: now)
    later = now + timedelta(seconds=4)
    for _ in rows[1:]:
        assert box.deliver_one(db, transport=transport, clock=lambda: later)
    assert sent == [rows[0].id, rows[1].id, *[r.id for r in rows[1:]]]
    assert all(p.status == "delivered" for p in parts(db))


def test_concurrent_claim_stale_ack_cannot_replace_receipt(db):
    queue(db)
    now = utcnow()
    started, resume = Event(), Event()
    remote_ids = set()
    def delayed(row):
        remote_ids.add(row.id)
        started.set()
        assert resume.wait(10)
        return "stale"
    def successor(row):
        remote_ids.add(row.id)
        return "current"
    with ThreadPoolExecutor() as ex:
        slow = ex.submit(box.deliver_one, db, transport=delayed, clock=lambda: now)
        try:
            assert started.wait(5)
            assert not box.deliver_one(db, transport=successor, clock=lambda: now)
            assert box.deliver_one(db, transport=successor, clock=lambda: now + box.LEASE)
        finally:
            resume.set()
        assert not slow.result()
    assert len(remote_ids) == 1 and parts(db)[0].remote_id == "current"


def test_accepted_before_crash_past_window_is_uncertain(db):
    mid = queue(db)
    now = utcnow()
    with Session(db) as s:
        assert box.claim(s, now)
    transport = Mock()
    assert not box.deliver_one(db, transport=transport, clock=lambda: now + timedelta(hours=2))
    transport.assert_not_called()
    assert parts(db)[0].status == "uncertain"
    with Session(db) as s:
        assert not box.retry(s, s.get(Conversation, "c"), s.get(Message, mid))


def test_missing_target_and_owner_scoped_retry_audit(db):
    mid = queue(db, target=None)
    with Session(db) as s:
        conv = s.get(Conversation, "c")
        conv.external_chat_id = None
        s.add_all([Conversation(id="x", user_id="other"), FeishuDeliveryBind(conversation_id="x", chat_id="other")])
        s.commit()
        assert box.origin_chat(s, conv) is None
        with pytest.raises(pa.HTTPException) as denied:
            pa.retry_feishu_reply("x", mid, s)
        assert denied.value.status_code == 404
        with pytest.raises(pa.HTTPException) as missing:
            pa.retry_feishu_reply("c", mid, s)
        assert missing.value.status_code == 409
        s.add(FeishuDeliveryBind(conversation_id="c", chat_id="correct"))
        s.commit()
        assert pa.retry_feishu_reply("c", mid, s)["ok"]
        out, = pa.list_messages("c", s)
        assert out.actions[-1]["parts"][0]["retries"] == 1
    part, = parts(db)
    assert (part.chat_id, part.status) == ("correct", "pending")


@pytest.mark.parametrize("commit", [False, True])
def test_final_assistant_fenced_with_intent_and_inbox(db, commit):
    with Session(db) as s:
        conv = s.get(Conversation, "c")
        agent_inbox.submit_event(s, conversation_id="c", source="feishu", payload={"message": "核对本段"})
        events = agent_inbox.claim_pending(s, "c")
        turn = s.info["feishu_reply_turn"] = box.ReplyTurn(conv)
        msg = pa._append_message(s, "c", "assistant", TEXT, bot_id="chief", final_reply=True)
        mid = msg.id
        # A separate supervisor timeline commit cannot flush the candidate.
        s.commit()
        with Session(db) as read:
            assert read.get(Message, mid) is None
        turn.finish(s, conv, TEXT, events)
        s.flush()
        if commit:
            agent_inbox.mark_done(s, events)
    with Session(db) as read:
        event, = read.exec(select(AgentEvent)).all()
        assert event.status == ("done" if commit else "processing")
        assert bool(read.get(Message, mid)) == commit
        assert len(parts(db)) == int(commit)


def test_quiet_and_defer(db):
    with Session(db) as s:
        conv = s.get(Conversation, "c")
        for payload, text in [({}, "[NOOP]"), ({}, ""), ({"quiet_policy": "digest"}, TEXT)]:
            turn = box.ReplyTurn(conv)
            turn.finish(s, conv, text, [SimpleNamespace(payload=payload, source="routine")])
        s.commit()
    assert parts(db) == []


def test_pipeline_dispatch_commit_contains_final_even_if_process_dies(db, monkeypatch):
    from app.routers import assistant
    def crash_after_child_commit(*args):
        with Session(db) as observer:
            parent, = observer.exec(select(AgentEvent)).all()
            state = observer.get(Conversation, "c").group_rules["pipeline_execution"]
            part, = parts(db)
            assert parent.status == "done" and state["inflight"]
            assert part.message_id == state["noticeMessageId"]
            assert observer.get(Message, part.message_id).content == state["detail"]
        raise SystemExit("simulated process death")
    monkeypatch.setattr(assistant, "enqueue_job", crash_after_child_commit)
    with Session(db) as s:
        conv = s.get(Conversation, "c")
        project = Project(user_id=DEMO_USER, title="Pipeline", format="manju", stage="S0")
        conv.kind = "group"
        conv.project_id = project.id
        conv.member_bot_ids = ["topic.market_brief"]
        conv.group_rules = {"speak_policy": "pipeline", "stages":[{"id":"P","agentIds":conv.member_bot_ids}]}
        s.add(project)
        s.commit()
        agent_inbox.submit_event(s, conversation_id=conv.id, source="feishu",
                                 payload={"message":"本次创作目标","project_id":project.id})
        with pytest.raises(SystemExit):
            asyncio.run(chief_runner.pump_one(s, conv.id))
    assert box.deliver_one(db, transport=lambda part: "remote")
    with Session(db) as s:
        assert asyncio.run(chief_runner.pump_one(s, "c"))["idle"]


def test_explicit_binding_immutable_and_conflicting_origin_blocked(db):
    with Session(db) as s:
        conv = s.get(Conversation, "c")
        conv.source, conv.external_chat_id = "assistant", None
        s.commit()
        assert box.ReplyTurn.open(s, conv) is None
        binding = FeishuDeliveryBind(conversation_id="c", chat_id="original")
        s.add(binding)
        s.commit()
        authorized = box.ReplyTurn.open(s, conv)
        binding.chat_id = "other"
        s.commit()
        authorized.finish(s, conv, TEXT, [])
        s.commit()
        blocked = box.ReplyTurn.open(s, conv)
        event = SimpleNamespace(source="feishu", payload={"chat_id":"conflict"})
        blocked.finish(s, conv, TEXT, [event])
        s.commit()
        rows = parts(db)
        assert {(p.chat_id, p.status) for p in rows} == {("original", "pending"), (None, "blocked")}
        msg = s.get(Message, next(p.message_id for p in rows if p.status == "blocked"))
        assert not box.retry(s, conv, msg)


def test_max_attempts_and_manual_retry_definite_failure_only(db):
    mid = queue(db)
    now = utcnow()
    def reject(part):
        raise box.SendRejected("local configuration")
    for _ in range(box.MAX_ATTEMPTS):
        assert box.deliver_one(db, transport=reject, clock=lambda: now)
        now += timedelta(minutes=1)
    assert parts(db)[0].status == "failed"
    with Session(db) as s:
        assert pa.retry_feishu_reply("c", mid, s)["ok"]
        assert pa.get_feishu_delivery("c", mid, s)["parts"][0]["attempts"] == box.MAX_ATTEMPTS
    assert box.deliver_one(db, transport=lambda p: "remote", clock=lambda: now)
    assert parts(db)[0].total_attempts == box.MAX_ATTEMPTS + 1


def test_handler_and_pump_use_same_final_path_without_direct_send(db, monkeypatch):
    from pathlib import Path
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2] / "feishu"))
    import handler
    channel = Mock()
    monkeypatch.setattr(handler, "get_delivery", lambda: channel)
    with Session(db) as s:
        conv = s.get(Conversation, "c")
        conv.kind = "group"
        conv.group_rules = {"speak_policy": "mention_only"}
        s.commit()
        asyncio.run(handler._run_chat(s, conv, "own-chat", "核对本段"))
        asyncio.run(handler._run_chat(s, conv, "own-chat", "再次核对", dedupe_key="sdk-ingress"))
        assert len(parts(db)) == 1
        asyncio.run(chief_runner.pump_one(s, "c"))
    assert len(parts(db)) == 2
    assert all(not call.args[2].get("reply") for call in channel.progress.call_args_list)
    channel.text.assert_not_called()


def test_group_history_and_selection_share_one_canonical_final(db):
    with Session(db) as s:
        conv = s.get(Conversation, "c")
        turn = s.info["feishu_reply_turn"] = box.ReplyTurn.open(s, conv)
        first = pa._append_message(s, "c", "assistant", TEXT, bot_id="one", final_reply=True)
        assert pa._load_history(s, "c")[-1]["content"] == TEXT
        second = pa._append_message(s, "c", "assistant", TEXT, bot_id="two", final_reply=True)
        pa._append_message(s, "c", "assistant", "[NOOP]", bot_id="three", final_reply=True)
        s.commit()
        with Session(db) as observer:
            assert [m.id for m in observer.exec(select(Message))] == [first.id]
        assert [m["content"] for m in pa._load_history(s, "c")] == [TEXT, TEXT, "[NOOP]"]
        turn.finish(s, conv, TEXT, [])
        s.commit()
        assert parts(db)[0].message_id == second.id
        assert len(s.exec(select(Message)).all()) == 3


def test_pump_with_empty_inbox_offloads_transport(db, monkeypatch):
    from app import inbox_pump as pump, watchdog, task_daemon
    from threading import get_ident
    queued = queue(db)
    main_thread = get_ident()
    started, resume = Event(), Event()
    def transport(row):
        assert get_ident() != main_thread
        started.set()
        assert resume.wait(5)
        return "remote"
    send = box.deliver_one
    monkeypatch.setattr(box, "deliver_one", lambda engine: send(engine, transport=transport))
    monkeypatch.setattr(pump, "engine", db)
    monkeypatch.setattr(watchdog, "scan", lambda *args, **kwargs: None)
    monkeypatch.setattr(task_daemon, "tick", lambda *args: {})
    monkeypatch.setattr(chief_runner, "pump_one", Mock(side_effect=AssertionError("no inference")))
    async def run():
        await pump._tick()
        try:
            assert await asyncio.to_thread(started.wait, 3)
            await asyncio.wait_for(pump._tick(), 1)
        finally:
            resume.set()
            await pump.stop_inbox_pump()
    asyncio.run(run())
    assert parts(db)[0].message_id == queued
    assert parts(db)[0].remote_id == "remote"


def test_targeted_cutover_only_claims_requested_message(db):
    first = queue(db)
    second = queue(db)
    seen = []
    def accept(p):
        seen.append(p.message_id)
        return "remote"
    assert box.deliver_one(db, message_id=second, transport=accept)
    assert not box.deliver_one(db, message_id=second, transport=accept)
    assert seen == [second]
    assert [p.message_id for p in parts(db) if p.status == "pending"] == [first]


@pytest.mark.asyncio
async def test_stream_sees_late_committed_reply_with_original_identity(db, monkeypatch):
    import json
    from app import db as db_module
    monkeypatch.setattr(db_module, "engine", db)
    now = utcnow()
    with Session(db) as s:
        s.add(Message(id="handoff", conversation_id="c", role="assistant", created_at=now))
        s.commit()
        stream = await pa.conversation_stream("c", 0, s)
        async def next_message():
            async for chunk in stream.body_iterator:
                row = json.loads(chunk.removeprefix("data: "))
                if row["event"] == "message":
                    return row
        try:
            assert (await next_message())["id"] == "handoff"
            with Session(db) as writer:
                msg = Message(id="final", conversation_id="c", role="assistant", content=TEXT,
                              actions=[{"type":"feishu_reply"}], created_at=now - timedelta(seconds=2))
                writer.add(msg)
                box.enqueue(writer, msg, "origin")
                writer.commit()
            final = await asyncio.wait_for(next_message(), 4)
            assert final["id"] == "final" and final["actions"] == [{"type":"feishu_reply"}]
        finally:
            await stream.body_iterator.aclose()


@pytest.mark.parametrize("at_admission", ["original", None])
def test_admission_survives_rebind_before_claim(db, at_admission):
    with Session(db) as s:
        conv = s.get(Conversation, "c")
        conv.source, conv.external_chat_id = "assistant", None
        s.commit()
        if at_admission:
            feishu_notify.upsert_delivery_bind(s, conversation_id="c", chat_id=at_admission)
        agent_inbox.submit_event(s, conversation_id="c", source="web", payload={"message": "核对本段"},
                                 dedupe_key="once")
        feishu_notify.upsert_delivery_bind(s, conversation_id="c", chat_id="new")
        agent_inbox.submit_event(s, conversation_id="c", source="web", payload={"message": "核对本段"},
                                 dedupe_key="once")
        agent_inbox.submit_event(s, conversation_id="c", source="web", payload={"message": "另一个请求"})
    with Session(db) as s:
        conv = s.get(Conversation, "c")
        first = agent_inbox.claim_pending(s, "c")
        assert len(first) == 1 and first[0].dedupe_key == "once"
        assert not agent_inbox.claim_additional(s, "c")
        turn = box.ReplyTurn.open(s, conv, first)
        if at_admission:
            assert turn.target == at_admission
            turn.finish(s, conv, TEXT, first)
            s.flush()
        else:
            assert turn is None
        agent_inbox.mark_done(s, first)
        second = agent_inbox.claim_pending(s, "c")
        assert len(second) == 1 and box.ReplyTurn.open(s, conv, second).target == "new"
    assert [part.chat_id for part in parts(db)] == ([at_admission] if at_admission else [])


def test_legacy_route_only_from_recorded_ingress(db):
    with Session(db) as s:
        conv = s.get(Conversation, "c")
        local = AgentEvent(conversation_id="c", source="web")
        incoming = AgentEvent(conversation_id="c", source="feishu", payload={"chat_id": "old-envelope"})
        assert box.ReplyTurn.open(s, conv, [local]) is None
        assert box.ReplyTurn.open(s, conv, [incoming]).target == "old-envelope"
        mixed = box.ReplyTurn.open(s, conv, [local, incoming])
        mixed.finish(s, conv, TEXT, [local, incoming])
        s.commit()
    part, = parts(db)
    assert part.status == "blocked" and part.chat_id is None


def approval_fixture(s, *, knowledge=False):
    from app.models import Bot, KnowledgeDoc
    conv = s.get(Conversation, "c")
    project = Project(id="p", user_id=DEMO_USER, title="私有审批项目", format="manju", stage="S0")
    bot = Bot(id="owner-colleague", owner_user_id=DEMO_USER, name="资料同事")
    if knowledge:
        s.add(KnowledgeDoc(id="doc", user_id=DEMO_USER, title="资料", doc_type="text", storage_uri="inline:资料"))
        bot.execution = dict(enabled=True, formats=["manju"], projectId="p", documentIds=["doc"])
    conv.bot_id, conv.project_id = bot.id, project.id
    pending = Message(conversation_id=conv.id, role="assistant", bot_id=bot.id,
                      actions=[dict(type="confirm_required", tool="list_projects", args={})])
    s.add_all([project, bot, pending])
    s.commit()
    return conv, pending


def test_approved_knowledge_continuation_noop_retains_only_ui_tool_result(db):
    with Session(db) as s:
        conv, pending = approval_fixture(s, knowledge=True)
        result = asyncio.run(pa.respond_conversation_impl(s, conv, approve=True, message_id=pending.id))
        assert result["ok"] and result["feishuReplyHandled"] and "私有审批项目" in result["reply"]
        assert any(e["event"] == "done" and e["noop"] and e["reply"] == "" for e in result["events"])
        assert [m.id for m in s.exec(select(Message).where(Message.role == "assistant"))] == [pending.id]
        assert not parts(db)


def test_card_returns_ack_only_when_durable_reply_exists(db, monkeypatch):
    from pathlib import Path
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2] / "feishu"))
    from cards import result_card
    import handler
    monkeypatch.setattr(handler, "engine", db)
    channel = Mock()
    monkeypatch.setattr(handler, "get_delivery", lambda: channel)
    with Session(db) as s:
        conv, pending = approval_fixture(s)
        s.add(Message(conversation_id=conv.id, role="user", content=TEXT * 900))
        s.commit()
        item = {"chat_id": "callback-origin", "value": {"action":"confirm", "approve":True,
                "conversation_id":conv.id, "message_id":pending.id}}
    result = asyncio.run(handler.handle_card_async(item))
    part, = parts(db)
    assert part.chat_id == "own-chat" and "预算" in part.body
    assert result == {"toast":{"type":"success", "content":"已批准"},
                      "card":result_card(title="已批准", body="已批准")}
    channel.text.assert_not_called()
    assert all("预算" not in str(call) for call in channel.progress.call_args_list)
    assert not any(call.args[1] == "done" and call.args[2].get("reply") for call in channel.progress.call_args_list)


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["dm", "group"])
async def test_context_error_final_retains_bot_refs_in_step_message_and_stream(db, monkeypatch, kind):
    import json
    from app import db as db_module
    from app.models import Bot, RunStep
    monkeypatch.setattr(db_module, "engine", db)
    ref = dict(id="selection", kind="artifact", sourceId="draft", start=0, end=2,
               quote="周衡", title="选中段落", contentHash="capture")
    with Session(db) as s:
        conv = s.get(Conversation, "c")
        bot = Bot(id="error-owner", name="核对同事", owner_user_id=DEMO_USER)
        conv.kind = kind
        conv.bot_id = bot.id
        if kind == "group":
            peer = Bot(id="other-owner", name="其他同事", owner_user_id=DEMO_USER)
            s.add(peer)
            conv.member_bot_ids = [peer.id, bot.id]
            conv.group_rules = {"speak_policy": "mention_only"}
        s.add(bot)
        s.commit()
        agent_inbox.submit_event(s, conversation_id=conv.id, source="feishu",
                                 payload={"message":TEXT * 900, "contextRefs":[ref], "mention_bot_ids":[bot.id]})
        result = await chief_runner.pump_one(s, conv.id)
        assert "预算" in result["reply"]
        final = s.exec(select(Message).where(Message.role == "assistant")).one()
        step = s.exec(select(RunStep).where(RunStep.kind == "error")).one()
        assert step.actor == final.bot_id == bot.id
        assert step.payload["contextRefs"] == [ref] and final.evidence == [{"kind":"context_ref","ref":ref}]
        stream = await pa.conversation_stream(conv.id, 0, s)
        try:
            async for chunk in stream.body_iterator:
                event = json.loads(chunk.removeprefix("data: "))
                if event["event"] == "message" and event["id"] == final.id:
                    assert event["botId"] == bot.id and event["contextRefs"][0]["id"] == "selection"
                    break
        finally:
            await stream.body_iterator.aclose()
        assert parts(db)[0].message_id == final.id

def test_sqlite_upgrade_leaves_legacy_admission_and_delivery_untouched(db, monkeypatch):
    from app import db as db_module
    with Session(db) as s:
        s.add(AgentEvent(id="old", conversation_id="c", source="web", status="done"))
        s.commit()
    with db.begin() as conn:
        conn.exec_driver_sql("ALTER TABLE agentevent DROP COLUMN reply_delivery")
    monkeypatch.setattr(db_module, "engine", db)
    db_module._migrate_sqlite_columns()
    db_module._migrate_sqlite_columns()
    with Session(db) as s:
        event = s.get(AgentEvent, "old")
        assert event.status == "done" and event.reply_delivery is None
        assert not parts(db)


@pytest.mark.parametrize("origin", ["chat-A", None])
def test_web_approval_uses_original_delivery_after_rebinding(db, origin):
    with Session(db) as s:
        conv = s.get(Conversation, "c")
        conv.source, conv.external_chat_id = "assistant", None
        conv.kind = "group"
        conv.group_rules = {"speak_policy": "mention_only"}
        s.commit()
        if origin:
            feishu_notify.upsert_delivery_bind(s, conversation_id="c", chat_id=origin)
        agent_inbox.submit_event(s, conversation_id="c", source="web", payload={"message": "列出项目"})
        events = agent_inbox.claim_pending(s, "c")
        s.info["feishu_reply_turn"] = box.ReplyTurn.open(s, conv, events)
        pending = pa._append_message(s, "c", "assistant", "请确认列出项目", final_reply=True,
            actions=[{"type": "confirm_required", "tool": "list_projects", "args": {}}])
        s.add(pending)
        pending_id = pending.id
        s.flush()
        agent_inbox.mark_done(s, events)
        feishu_notify.upsert_delivery_bind(s, conversation_id="c", chat_id="chat-B")
    with Session(db) as s:
        result = asyncio.run(pa.respond_conversation_impl(s, s.get(Conversation, "c"),
                                                         approve=True, message_id=pending_id))
        assert result["ok"] and "mention_only" in result["reply"]
        assert result["feishuReplyHandled"]
    assert [p.chat_id for p in parts(db)] == ([origin] if origin else [])
