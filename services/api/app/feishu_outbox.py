"""Final conversation replies. Each immutable payload has one Feishu UUID."""
from __future__ import annotations

import json
from datetime import timedelta
from uuid import NAMESPACE_URL, uuid4, uuid5

from sqlalchemy import case, exists, func, or_, update
from sqlalchemy.orm import aliased
from sqlmodel import Session, select

from .feishu_markdown import looks_like_markdown, md_cards
from .models import Conversation, FeishuDeliveryBind, FeishuReplyPart as Part, Message, utcnow

MAX_ATTEMPTS = 5
# Reserve five minutes of Feishu's one-hour UUID window for clock/transport margin.
SAFE_WINDOW = timedelta(minutes=55)
LEASE = timedelta(seconds=90)


def origin_chat(session, conv):
    original = conv.external_chat_id if conv.source == "feishu" else None
    target = original or session.exec(select(FeishuDeliveryBind.chat_id).where(
        FeishuDeliveryBind.conversation_id == conv.id)).first()
    return target if target and not target.startswith("archived:") else None


def admission_delivery(session, conv, source, payload):
    """Resolve only an originally addressed chat or this conversation's explicit binding."""
    target = origin_chat(session, conv)
    incoming = source in {"feishu", "feishu_candidate"}
    addressed = (payload or {}).get("chat_id") if incoming else None
    if addressed and (not isinstance(addressed, str) or addressed.startswith("archived:")
                      or (target and addressed != target)):
        return {"channel": "blocked"}
    if incoming or target or conv.source == "feishu":
        return {"channel": "feishu", "chat": addressed or target}
    return {"channel": "local"}


def event_delivery(event):
    snapshot = getattr(event, "reply_delivery", None)
    if snapshot is not None:
        return snapshot["channel"], snapshot.get("chat")
    # A pre-upgrade Feishu ingress still carries its original envelope. Other
    # legacy events have no proof of an external destination.
    if event.source in {"feishu", "feishu_candidate"}:
        target = (event.payload or {}).get("chat_id")
        if target and (not isinstance(target, str) or target.startswith("archived:")):
            return "blocked", None
        return "feishu", target
    return "local", None


def enqueue(session, message, target, *, conflict=False):
    text = message.content
    if not text.strip() or text.strip().upper() in {"NOOP", "[NOOP]"}:
        return
    markdown = looks_like_markdown(text)
    payloads = md_cards(title="处理完成", markdown=text, template="blue") if markdown else [{"text": text}]
    for index, body in enumerate(payloads):
        session.add(Part(id=str(uuid5(NAMESPACE_URL, f"feishu-reply/{message.id}/{index}")),
                         message_id=message.id, conversation_id=message.conversation_id,
                         position=index, chat_id=target, msg_type="interactive" if markdown else "text",
                         body=json.dumps(body, ensure_ascii=False),
                         status="blocked" if conflict else ("pending" if target else "needs_target"),
                         detail="来源会话目标冲突，请人工核对" if conflict else ""))


def claim(session, now, *, message_id=None):
    prior = aliased(Part)
    earlier = exists().where(prior.message_id == Part.message_id, prior.position < Part.position,
                             prior.status != "delivered")
    due = select(Part.id).where(Part.status.in_(["pending", "sending"]), Part.due <= now, ~earlier)
    if message_id is not None:
        due = due.where(Part.message_id == message_id)
    candidate = due.order_by(Part.due, Part.id).limit(1).scalar_subquery()
    # One SQLite writer statement selects and claims; expired sends may have reached Feishu.
    token = str(uuid4())
    row = session.execute(update(Part).where(Part.id == candidate).values(
        lease=token, ambiguous=or_(Part.ambiguous, Part.status == "sending"),
        status="sending", due=now + LEASE,
        first_attempt=func.coalesce(Part.first_attempt, now)
    ).returning(Part.id).execution_options(synchronize_session=False)).scalar_one_or_none()
    if not row:
        session.commit()
        return None
    part = session.get(Part, row, populate_existing=True)
    if part.attempts >= MAX_ATTEMPTS or now.replace(tzinfo=None) - part.first_attempt.replace(tzinfo=None) >= SAFE_WINDOW:
        part.status = "uncertain" if part.ambiguous else "failed"
        part.detail = "已达到自动重试上限或 UUID 有效时限"
        part.lease = None
        session.commit()
        return None
    part.attempts += 1
    part.total_attempts += 1
    session.commit()
    return row, token


class SendRejected(Exception):
    """Definitive local failure before transmission, or explicit API rejection."""


def send_part(part):
    from .feishu_notify import _get_client, create_message
    client = _get_client()
    if client is None:
        raise SendRejected("飞书客户端未配置")
    response = create_message(client, part.chat_id, part.msg_type, part.body, request_uuid=part.id)
    if response is None or not getattr(response, "success", lambda: False)():
        # Some SDK/server failures do not establish rejection. Keep the UUID.
        raise RuntimeError("飞书未确认接收")
    return getattr(getattr(response, "data", None), "message_id", None)


def deliver_one(engine, *, message_id=None, transport=send_part, clock=utcnow):
    with Session(engine) as session:
        claimed = claim(session, clock(), message_id=message_id)
        if not claimed:
            return False
        part_id, token = claimed
        part = session.get(Part, part_id)
        session.expunge(part)
    now = clock().replace(tzinfo=None)
    if (part.lease != token or part.due.replace(tzinfo=None) <= now or
            part.first_attempt.replace(tzinfo=None) + SAFE_WINDOW <= now):
        return False
    # No database transaction spans network I/O.
    try:
        remote = transport(part)
        if not isinstance(remote, str) or not remote.strip():
            raise ValueError("缺少远端消息回执")
    except Exception as exc:
        ambiguous = part.ambiguous or not isinstance(exc, SendRejected)
        exhausted = part.attempts >= MAX_ATTEMPTS
        values = dict(status=("uncertain" if ambiguous else "failed") if exhausted else "pending",
                      ambiguous=ambiguous, detail=str(exc)[:200] if isinstance(exc, SendRejected)
                      else "未确认飞书是否已接收", due=clock() + timedelta(seconds=2 ** part.attempts))
    else:
        values = dict(status="delivered", remote_id=remote, detail="")
    with Session(engine) as session:
        result = session.execute(update(Part).where(Part.id == part_id, Part.status == "sending",
            Part.lease == token).values(**values, lease=None))
        session.commit()
        return result.rowcount == 1


def metadata(parts):
    return [dict(position=p.position + 1, status=p.status, attempts=p.total_attempts,
                 retries=p.manual_retries, receipt=p.remote_id, detail=p.detail) for p in parts]


def retry(session, conv: Conversation, message: Message):
    # Failed parts have no ambiguous acceptance; they may use the same UUID again.
    # A missing destination may only be filled from this conversation's own binding.
    target = origin_chat(session, conv)
    retryable = ["failed", "needs_target"] if target else ["failed"]
    result = session.execute(update(Part).where(Part.message_id == message.id,
        Part.conversation_id == conv.id, Part.status.in_(retryable), Part.ambiguous.is_(False)).values(
        chat_id=case((Part.status == "needs_target", target), else_=Part.chat_id),
        status="pending", due=utcnow(), attempts=0, first_attempt=None,
        manual_retries=Part.manual_retries + 1, detail="用户请求重试"))
    session.commit()
    return result.rowcount


class ReplyTurn:
    """Keep the currently selected assistant row outside unrelated ORM commits."""
    def __init__(self, conv, target=None, *, conflict=False):
        self.target = target
        self.conflict = conflict
        self.cid = conv.id
        self.row = None
        self.noops = []
        self.checkpoint = None
        self.refs = []
        self.fallback_actor = None
        self.confirm = False
        self.sealed = False

    @property
    def route(self):
        return ("blocked", None) if self.conflict else ("feishu", self.target)

    @classmethod
    def open(cls, session, conv, events=()):
        if events:
            routes = {event_delivery(e) for e in events}
            if routes == {("local", None)}:
                return None
            if len(routes) != 1:
                return cls(conv, conflict=True)
            channel, target = routes.pop()
            return cls(conv, target, conflict=channel == "blocked")
        target = origin_chat(session, conv)
        return cls(conv, target) if conv.source == "feishu" or target else None

    @classmethod
    def bind_confirmation(cls, session, message):
        if any(action.get("type") == "confirm_required" for action in message.actions):
            turn = cls.current(session, message.conversation_id)
            channel, chat = turn.route if turn else ("local", None)
            message.reply_delivery = {"channel": channel, "chat": chat}

    @classmethod
    def for_confirmation(cls, conv, message):
        route = message.reply_delivery
        if route is None:
            # Pre-snapshot web approvals have no evidence of external delivery.
            if conv.source == "feishu" and conv.external_chat_id and not conv.external_chat_id.startswith("archived:"):
                return cls(conv, conv.external_chat_id)
            return None
        if route.get("channel") == "local":
            return None
        return cls(conv, route.get("chat"), conflict=route.get("channel") != "feishu")

    @classmethod
    def current(cls, session, cid):
        turn = session.info.get("feishu_reply_turn")
        return turn if turn and turn.cid == cid else None

    def staged(self):
        return ([self.row] if self.row else []) + self.noops

    def stage(self, session, row):
        if row.content.strip().upper() in {"NOOP", "[NOOP]"}:
            self.noops.append(row)
            return
        if self.row:
            session.add(self.row)
            session.commit()
        self.row = row

    def finish(self, session, conv, reply, events):
        session.add_all(self.staged())
        if not reply or reply.strip().upper() in {"", "NOOP", "[NOOP]"} or self.confirm:
            return
        if events and all((e.payload or {}).get("quiet_policy") in {"digest", "silent", "defer"} for e in events):
            return
        message = self.row if self.row and self.row.content == reply else None
        if self.checkpoint:
            message = session.get(Message, self.checkpoint)
            if not message or message.conversation_id != conv.id or message.content != reply:
                raise RuntimeError("pipeline reply checkpoint mismatch")
        if not message:
            message = Message(conversation_id=conv.id, role="assistant", content=reply, bot_id=self.fallback_actor,
                              evidence=[{"kind": "context_ref", "ref": r} for r in self.refs])
            session.add(message)
        if any(a.get("type") == "feishu_reply" for a in message.actions):
            return
        message.actions = [*message.actions, {"type": "feishu_reply"}]
        routes = {event_delivery(e) for e in events}
        conflict = self.conflict or bool(routes - {("feishu", self.target)})
        enqueue(session, message, None if conflict else self.target, conflict=conflict)


def staged_reply(session, cid):
    turn = ReplyTurn.current(session, cid)
    return max(turn.staged(), key=lambda row: row.created_at, default=None) if turn else None


def seal_pipeline_notice(session, conv, state):
    """The dispatch/gate checkpoint already commits. Complete the same fenced
    inbox batch inside that transaction, retaining its lease until the runner exits.
    """
    from .agent_inbox import fence_turn_writes, processing_for_owner
    turn = ReplyTurn.current(session, conv.id)
    if turn is None or turn.sealed:
        return
    fence_turn_writes(session)
    rows = processing_for_owner(session, conv.id)
    # Only a notice created by this turn can become its final delivery.
    if turn.checkpoint and state.get("status") != "waiting_ack":
        turn.finish(session, conv, state.get("detail", ""), rows)
    for row in rows:
        row.status = "done"
        row.processed_at = utcnow()
    turn.sealed = True
