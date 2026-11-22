"""Always-on Event Inbox：写入 / 去重 / 抢占 / 批量合并 / Inline&Spill。"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from contextvars import ContextVar
from datetime import timedelta
from functools import wraps
from typing import Any

from fastapi import HTTPException
from sqlalchemy import delete, event, update
from sqlmodel import Session, select

from .run_steps import next_step_seq
from .models import AgentEvent, AgentRun, InboxKey, InboxLease, Conversation, RunStep, new_id, utcnow

# Worker steer 信箱：conversation_id = run:<run_id>
STEER_PREFIX = "run:"


def steer_mailbox(run_id: str) -> str:
    return f"{STEER_PREFIX}{run_id}"


# 优先级：元操作 -10 < 用户私聊 0 < 群聊 10 < Bot委派 20 < 例程 30
PRIORITY_META = -10
PRIORITY_USER_DM = 0
PRIORITY_GROUP = 10
PRIORITY_BOT_DELEGATE = 20
PRIORITY_ROUTINE = 30

KNOWLEDGE_REQUEST_SOURCES = frozenset({"web", "user", "user_message", "feishu", "routine", "bot_delegate"})


def submit_event(
    session: Session,
    *,
    conversation_id: str,
    source: str,
    payload: dict[str, Any],
    dedupe_key: str | None = None,
    priority: int | None = None,
    target_bot_id: str | None = None,
    commit: bool = True,
    initial_status: str = "pending",
    admitted_knowledge_ids: list[str] | None = None,
) -> AgentEvent:
    """写入收件箱；同 conversation + dedupe_key 已存在则返回旧事件。"""
    if priority is None:
        if source in {"web", "feishu"}:
            priority = PRIORITY_USER_DM
        elif source in {"bot_delegate", "bot_reply"}:
            priority = PRIORITY_BOT_DELEGATE
        elif source in {"timer", "routine"}:
            priority = PRIORITY_ROUTINE
        else:
            priority = PRIORITY_GROUP

    row = AgentEvent(
        id=new_id(),
        conversation_id=conversation_id,
        source=source,
        dedupe_key=dedupe_key,
        payload=payload or {},
        status=initial_status,
        priority=priority,
        target_bot_id=target_bot_id,
    )
    if dedupe_key:
        reserved = session.execute(_insert(session)(InboxKey).values(
            conversation_id=conversation_id, dedupe_key=dedupe_key, event_id=row.id
        ).on_conflict_do_nothing(index_elements=["conversation_id", "dedupe_key"]))
        if reserved.rowcount == 0:
            key = session.get(InboxKey, (conversation_id, dedupe_key))
            existing = session.get(AgentEvent, key.event_id)
            if existing is None:
                raise RuntimeError("Inbox key references missing event")
            if commit:
                session.commit()
            return existing
    # A sender cannot supply or erase a knowledge admission through its payload.
    data = dict(row.payload)
    data.pop("knowledgeAdmission", None)
    convo = session.get(Conversation, conversation_id)
    from .feishu_outbox import admission_delivery
    row.reply_delivery = admission_delivery(session, convo, source, data) if convo else {"channel": "local"}
    # A Feishu group candidate can supply the initial goal of a preset pipeline.
    # Completion receipts must persist even if the original role has lost access.
    if convo and (
        source in KNOWLEDGE_REQUEST_SOURCES or (source == "feishu_candidate" and convo.kind == "group")
    ):
        from .knowledge_colleague import knowledge_admission
        try:
            data["knowledgeAdmission"] = knowledge_admission(session, convo, target_bot_id, data, admitted_knowledge_ids)
        except HTTPException:
            if dedupe_key:
                session.execute(delete(InboxKey).where(InboxKey.event_id == row.id))
            raise
    row.payload = data
    if source == "steer" and conversation_id.startswith(STEER_PREFIX):
        run_id = conversation_id[len(STEER_PREFIX):]
        # Serialize admission against terminal delivery, including callers with a stale ORM row.
        locked = session.execute(update(AgentRun).where(AgentRun.id == run_id,
            AgentRun.status.in_(["running", "queued", "pending_deps"])).values(id=run_id)
            .execution_options(synchronize_session=False))
        if locked.rowcount != 1:
            session.rollback()
            raise HTTPException(409, "run no longer accepts instructions")
        run = session.get(AgentRun, run_id, populate_existing=True)
        inputs = run.input_json or {}
        direction = str(row.payload.get("message") or "").strip()
        if direction:
            # The run lock orders concurrent appends; client timestamps do not.
            row.payload = {**row.payload, "previousSteerRevision": inputs.get("steerRevision")}
            prompt = (inputs.get("assistantPrompt") or "") + "\n\n【追加指令】" + direction
            run.input_json = {**inputs, "assistantPrompt": prompt.strip(), "steerRevision": row.id}
            session.add(run)
    session.add(row)
    if commit:
        session.commit()
        session.refresh(row)
    else:
        session.flush()
    return row


LEASE_SECONDS = 90


class LostInboxLease(RuntimeError):
    pass


def _insert(session):
    if session.get_bind().dialect.name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert
    return insert


def _owners(session):
    return session.info.setdefault("inbox_owners", {})


def renew_owner(session, cid, token):
    now = utcnow()
    updated = session.execute(update(InboxLease).where(
        InboxLease.conversation_id == cid, InboxLease.token == token,
        InboxLease.expires_at > now,
    ).values(expires_at=now + timedelta(seconds=LEASE_SECONDS))
      .execution_options(synchronize_session=False))
    if updated.rowcount != 1:
        raise LostInboxLease(cid)


dispatch_guard = ContextVar("inbox_dispatch_guard", default=None)


def check_owner(session, cid):
    owners = _owners(session)
    if cid not in owners:
        raise LostInboxLease(cid)
    _check_tokens(session, owners)


def _check_tokens(session, owners):
    for mailbox, token in owners.items():
        if not session.exec(select(InboxLease.token).where(
            InboxLease.conversation_id == mailbox, InboxLease.token == token,
            InboxLease.expires_at > utcnow(),
        )).first():
            raise LostInboxLease(mailbox)


def fence_turn_writes(session):
    for cid, token in sorted(_owners(session).items()):
        renew_owner(session, cid, token)


@event.listens_for(Session, "before_flush")
def _fence_turn_writes(session, flush_context, instances):
    fence_turn_writes(session)


@asynccontextmanager
async def maintain_owner(session, cid):
    token = _owners(session)[cid]
    owner = asyncio.current_task()
    bind = session.get_bind()

    async def heartbeat():
        while True:
            await asyncio.sleep(LEASE_SECONDS / 3)
            try:
                with Session(bind) as heartbeat_session:
                    renew_owner(heartbeat_session, cid, token)
                    heartbeat_session.commit()
            except Exception:
                owner.cancel()
                raise

    tokens = dict(_owners(session))
    ancestor_guard = dispatch_guard.get()

    def check_dispatch():
        if ancestor_guard:
            ancestor_guard()
        with Session(bind) as observer:
            _check_tokens(observer, tokens)

    pulse = asyncio.create_task(heartbeat())
    guard_context = dispatch_guard.set(check_dispatch)
    try:
        check_owner(session, cid)
        yield
        check_owner(session, cid)
    finally:
        dispatch_guard.reset(guard_context)
        pulse.cancel()
        await asyncio.gather(pulse, return_exceptions=True)


def _claim_batch(session, cid, token, limit, *, admitted_route=None):
    query = select(AgentEvent).where(AgentEvent.conversation_id == cid, AgentEvent.status == "pending")
    if not cid.startswith(STEER_PREFIX) and has_pending_confirm(session, cid):
        query = query.where(AgentEvent.source.in_(["web", "feishu", "confirm"]))
    rows = list(session.exec(query.order_by(AgentEvent.priority, AgentEvent.created_at, AgentEvent.id).limit(limit)))
    if rows and not cid.startswith(STEER_PREFIX):
        from .feishu_outbox import event_delivery
        route = admitted_route if admitted_route is not None else event_delivery(rows[0])
        rows = [row for row in rows if event_delivery(row) == route]
    for row in rows:
        row.status = "processing"
        row.owner_token = token
        row.claimed_at = utcnow()
        row.execution_started = bool(session.info.get("inbox_execution_started"))
    return rows


def _reserve_owner(session, conversation_id):
    token = new_id()
    now = utcnow()
    result = session.execute(_insert(session)(InboxLease).values(
        conversation_id=conversation_id, token=token,
        expires_at=now + timedelta(seconds=LEASE_SECONDS),
    ).on_conflict_do_nothing(index_elements=["conversation_id"]))
    if not result.rowcount:
        session.commit()
        return None
    busy = session.exec(select(AgentEvent.id).where(
        AgentEvent.conversation_id == conversation_id, AgentEvent.status == "processing"
    ).limit(1)).first()
    if busy:
        session.execute(delete(InboxLease).where(InboxLease.token == token))
        session.commit()
        return None
    return token


@asynccontextmanager
async def conversation_owner(session, cid):
    """Join this session's fenced turn, or own a standalone approval/bot turn."""
    inherited_guard = dispatch_guard.get()
    if inherited_guard:
        inherited_guard()
    if cid in _owners(session):
        check_owner(session, cid)
        if inherited_guard:
            yield
        else:
            async with maintain_owner(session, cid):
                yield
        return
    token = _reserve_owner(session, cid)
    if token is None:
        raise InboxBusy(cid)
    _owners(session)[cid] = token
    session.commit()
    prior_execution = session.info.get("inbox_execution_started")
    session.info["inbox_execution_started"] = True
    failed = True
    try:
        async with maintain_owner(session, cid):
            yield
        failed = False
    finally:
        if failed:
            session.rollback()
        try:
            _finish_owner(session, cid, token, failed)
        finally:
            _owners(session).pop(cid, None)
            session.info["inbox_execution_started"] = prior_execution


def owned_turn(run):
    @wraps(run)
    async def wrapped(session, conv, *args, **kwargs):
        async with conversation_owner(session, conv.id):
            return await run(session, conv, *args, **kwargs)
    return wrapped


class InboxBusy(RuntimeError):
    pass


def claim_pending(session: Session, conversation_id: str, *, limit: int = 20) -> list[AgentEvent]:
    token = _reserve_owner(session, conversation_id)
    if token is None:
        return []
    rows = _claim_batch(session, conversation_id, token, limit)
    if rows:
        _owners(session)[conversation_id] = token
    else:
        session.execute(delete(InboxLease).where(InboxLease.token == token))
    session.commit()
    return rows


def claim_additional(session: Session, conversation_id: str, *, limit: int = 20) -> list[AgentEvent]:
    token = _owners(session).get(conversation_id)
    if token is None:
        return []
    renew_owner(session, conversation_id, token)
    from .feishu_outbox import ReplyTurn, event_delivery
    initial = session.exec(select(AgentEvent).where(AgentEvent.conversation_id == conversation_id,
        AgentEvent.owner_token == token, AgentEvent.status == "processing").limit(1)).first()
    active = ReplyTurn.current(session, conversation_id)
    route = event_delivery(initial) if initial else (active.route if active else ("local", None))
    rows = _claim_batch(session, conversation_id, token, limit, admitted_route=route)
    session.commit()
    return rows


def processing_for_owner(session: Session, cid: str) -> list[AgentEvent]:
    check_owner(session, cid)
    return list(session.exec(select(AgentEvent).where(AgentEvent.conversation_id == cid,
        AgentEvent.owner_token == _owners(session)[cid], AgentEvent.status == "processing")))


def mark_done(session: Session, events: list[AgentEvent], *, failed: bool = False, sealed: bool = False) -> None:
    if not events:
        return
    cid = events[0].conversation_id
    token = _owners(session).get(cid)
    if not token or any(row.owner_token != token or row.status not in ({"processing", "done"} if sealed else {"processing"}) for row in events):
        raise LostInboxLease(cid)
    _finish_owner(session, cid, token, failed)
    _owners(session).pop(cid, None)


def _finish_owner(session, cid, token, failed):
    renew_owner(session, cid, token)
    session.execute(update(AgentEvent).where(
        AgentEvent.conversation_id == cid, AgentEvent.owner_token == token,
        AgentEvent.status == "processing",
    ).values(status="failed" if failed else "done", processed_at=utcnow()))
    session.execute(delete(InboxLease).where(InboxLease.conversation_id == cid, InboxLease.token == token))
    session.commit()


def render_event(ev: AgentEvent) -> str:
    """Inline & Spill：摘要 + 对象指针，长内容留路径供 read 续读。"""
    payload = ev.payload or {}
    run_id = payload.get("run_id") or payload.get("runId")
    project_id = payload.get("project_id") or payload.get("projectId")
    artifact_ids = payload.get("artifact_ids") or payload.get("artifactIds") or []
    thread_key = payload.get("thread_key") or payload.get("threadKey")
    pointers: list[str] = []
    if run_id:
        pointers.append(f"run={run_id} → /runs/{run_id}")
    if project_id:
        pointers.append(f"project={project_id}")
    if thread_key:
        pointers.append(f"thread={thread_key} → /threads/{thread_key}")
    if artifact_ids:
        arts = artifact_ids if isinstance(artifact_ids, list) else [artifact_ids]
        for aid in arts[:5]:
            if project_id:
                pointers.append(f"artifact={aid} → /projects/{project_id}/artifacts/{aid}")
            else:
                pointers.append(f"artifact={aid}")
    ptr = (" | " + "; ".join(pointers)) if pointers else ""

    if ev.source in {"web", "feishu", "feishu_candidate", "confirm"}:
        text = str(payload.get("message") or payload.get("text") or "").strip()
        preview = text[:60] + ("…" if len(text) > 60 else "")
        spill = f" （全文续读：本会话 Message；{ptr.lstrip(' | ')}）" if (len(text) > 60 or ptr) else ""
        return f"[{ev.source}] {preview}{spill}" if preview else f"[{ev.source}]（空消息）{ptr}"

    if ev.source == "job_done":
        agent_id = payload.get("agent_id") or payload.get("agentId") or "?"
        status = payload.get("status") or "done"
        arts = payload.get("artifact_count") or len(artifact_ids or [])
        title = payload.get("project_title") or ""
        head = f"[子任务完成] {agent_id} → {status}"
        if title:
            head += f"（《{title}》，产物 {arts}）"
        return head + ptr

    if ev.source == "timer":
        note = payload.get("note") or payload.get("name") or "定时唤醒"
        return f"[定时] {str(note)[:60]}{ptr}"

    if ev.source == "observe":
        note = payload.get("note") or payload.get("message") or "观察通知"
        return f"[观察] {str(note)[:80]}{ptr}"

    if ev.source == "steer_ack":
        return f"[直通已投递] {str(payload.get('note') or '')[:60]}{ptr}"

    # fallback
    preview = str(payload.get("message") or payload.get("note") or payload.get("text") or ev.source)[:60]
    return f"[{ev.source}] {preview}{ptr}"


def merge_user_messages(events: list[AgentEvent]) -> str:
    """把一批事件合并成一次 Run 的输入（Inline & Spill）。"""
    parts = [render_event(ev) for ev in events]
    parts = [p for p in parts if p]
    if not parts:
        return ""
    if len(parts) == 1:
        return parts[0]
    return "以下是连续收到的多条消息，请合并处理一次回复：\n" + "\n".join(f"- {p}" for p in parts)


def inbox_event_actions(events: list[AgentEvent]) -> list[dict[str, Any]]:
    """写入 Message.actions，供前端区分用户气泡 vs 系统事件条。"""
    return [
        {
            "type": "inbox_event",
            "eventIds": [e.id for e in events],
            "sources": [e.source for e in events],
            "payloads": [
                {
                    "id": e.id,
                    "source": e.source,
                    **({"knowledgeBotIds":e.payload["knowledgeAdmission"]["botIds"]}
                       if (e.payload or {}).get("knowledgeAdmission") else {}),
                    "clientMessageId": (e.payload or {}).get("clientMessageId"),
                    "runId": (e.payload or {}).get("run_id") or (e.payload or {}).get("runId"),
                    "projectId": (e.payload or {}).get("project_id") or (e.payload or {}).get("projectId"),
                }
                for e in events
            ],
        }
    ]


def drain_and_prepare(
    session: Session,
    conversation_id: str,
) -> tuple[Conversation | None, list[AgentEvent], str]:
    """抢占 + 合并，返回 (conv, events, merged_message)。events 为空表示无需运行。"""
    conv = session.get(Conversation, conversation_id)
    if not conv:
        return None, [], ""
    events = claim_pending(session, conversation_id)
    if not events:
        return conv, [], ""
    return conv, events, merge_user_messages(events)


def has_pending_confirm(session: Session, conversation_id: str) -> bool:
    """主对话是否停留在 confirm_required（Paused on approval）。

    为 True 时 inbox_pump 不应消费该会话的 job_done / timer，以免冲掉审批现场。
    """
    from .models import Message

    recent = list(
        session.exec(
            select(Message)
            .where(Message.conversation_id == conversation_id)
            .order_by(Message.created_at.desc())
            .limit(12)
        )
    )
    for msg in recent:
        for act in msg.actions or []:
            if act.get("type") == "confirm_required":
                return True
            # 已响应则不算挂起
            if act.get("type") in {"confirm_approved", "confirm_rejected", "confirm_resolved"}:
                return False
    return False


def list_pending_conversation_ids(session: Session, *, limit: int = 50) -> list[str]:
    """有 pending 且无 processing 的会话 id（供 inbox_pump）。排除 steer 信箱。

    若会话正等待人工确认（Paused on approval），跳过仅含后台事件的唤醒，
    但仍允许纯用户消息（web/feishu）直通，避免用户被锁死。
    """
    busy = select(AgentEvent.conversation_id).where(AgentEvent.status == "processing")
    pending = session.exec(
        select(AgentEvent.conversation_id).where(
            AgentEvent.status == "pending",
            ~AgentEvent.conversation_id.startswith(STEER_PREFIX),
            AgentEvent.conversation_id.not_in(busy),
        ).distinct().order_by(AgentEvent.conversation_id)
    )
    out: list[str] = []
    for cid in pending:
        # 审批挂起保护：仅有 job_done/timer/task_group_done 时不唤醒
        if has_pending_confirm(session, cid):
            pending_rows = list(
                session.exec(
                    select(AgentEvent).where(
                        AgentEvent.conversation_id == cid,
                        AgentEvent.status == "pending",
                    )
                )
            )
            userish = any(e.source in {"web", "feishu", "confirm"} for e in pending_rows)
            if not userish:
                continue
        out.append(cid)
        if len(out) >= limit:
            break
    return out


def preempt_stale_processing(
    session: Session,
    conversation_id: str,
    *,
    max_age_seconds: int = 60,
) -> list[AgentEvent]:
    """Always-on 元操作抢占：会话内过久的 processing 直接 failed，避免饿死 schedule/fleet/ps。

    对齐 OpenClaw personal-agent：控制面消息不得被卡住的慢回合永久阻塞。
    """
    return _recover(session, max(15, max_age_seconds), conversation_id)


def reap_stale(session: Session, *, timeout_minutes: int = 5) -> list[AgentEvent]:
    return _recover(session, max(1, timeout_minutes) * 60)


def _recover(session, grace_seconds, cid=None):
    now = utcnow()
    expired = select(InboxLease.conversation_id, InboxLease.token).where(InboxLease.expires_at <= now)
    if cid is not None:
        expired = expired.where(InboxLease.conversation_id == cid)
    stale = []
    notices = []
    for mailbox, token in session.exec(expired.order_by(InboxLease.conversation_id)).all():
        fenced = session.execute(delete(InboxLease).where(
            InboxLease.conversation_id == mailbox, InboxLease.token == token,
            InboxLease.expires_at <= now,
        ).execution_options(synchronize_session=False))
        if fenced.rowcount:
            rows = session.exec(select(AgentEvent).where(
                AgentEvent.conversation_id == mailbox, AgentEvent.owner_token == token,
                AgentEvent.status == "processing",
            )).all()
            for row in rows:
                if row.execution_started:
                    row.status = "failed"
                    row.processed_at = now
                else:
                    row.status = "pending"
                    row.owner_token = None
                    row.claimed_at = None
            stale.extend(rows)
            if not mailbox.startswith(STEER_PREFIX):
                notices.append(RunStep(conversation_id=mailbox, actor="system", kind="watchdog",
                                    payload={"reason": "stale_processing", "eventIds": [r.id for r in rows],
                                             "unknownEventIds": [r.id for r in rows if r.execution_started], "owner": token}))
    legacy = [AgentEvent.status == "processing", AgentEvent.owner_token.is_(None)]
    if cid is not None:
        legacy.append(AgentEvent.conversation_id == cid)
    session.execute(update(AgentEvent).where(*legacy, AgentEvent.claimed_at.is_(None)).values(claimed_at=now))
    ids = session.execute(update(AgentEvent).where(*legacy,
        AgentEvent.claimed_at <= now - timedelta(seconds=grace_seconds)
    ).values(status="failed", processed_at=now).returning(AgentEvent.id)
      .execution_options(synchronize_session=False)).scalars().all()
    for event_id in ids:
        row = session.get(AgentEvent, event_id)
        stale.append(row)
        if not row.conversation_id.startswith(STEER_PREFIX):
            notices.append(RunStep(conversation_id=row.conversation_id, actor="system", kind="watchdog",
                                payload={"reason": "stale_processing", "eventId": row.id, "outcome": "unknown"}))
    # One recovery transaction can cover several mailboxes. Acquire their
    # counter locks in key order, after fencing all affected leases and events.
    for notice in sorted(notices, key=lambda step: step.conversation_id):
        notice.seq = next_step_seq(session, notice.conversation_id)
        session.add(notice)
    session.commit()
    return stale
