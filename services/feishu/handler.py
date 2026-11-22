"""飞书消息/卡片处理：异步队列 + Supervisor + 控制命令。"""

from __future__ import annotations

import asyncio
import logging
import threading
from collections import deque
from datetime import timedelta
from typing import Any

from sqlalchemy import update
from sqlmodel import Session, select

from app.db import engine
from app.models import AgentEvent, Conversation, Message, Project, TaskProposal, utcnow
from app.routers.personal_agent import _run_supervisor, respond_conversation_impl
from app.seed import DEMO_USER
from app.settings import get_settings

from cards import result_card
from delivery import Delivery
from ingress import decide_ingress, help_text, is_bot_sender, message_mentions_bot
from session import find_or_create_conversation, find_pending_confirm, reset_conversation

logger = logging.getLogger("feishu.handler")

# 群聊静默缓冲（仅本进程，供调试/漏斗观察）
_SILENT_BUFFER: deque[dict[str, Any]] = deque(maxlen=200)
# chat_id -> 进行中的 followup 文本队列
_FOLLOWUPS: dict[str, deque[str]] = {}
_BUSY: set[str] = set()

_delivery: Delivery | None = None
_queue: asyncio.PriorityQueue | None = None
_loop: asyncio.AbstractEventLoop | None = None
_seq = 0  # PriorityQueue 同优先级保序


def set_delivery(d: Delivery) -> None:
    global _delivery
    _delivery = d


def get_delivery() -> Delivery:
    global _delivery
    if _delivery is None:
        _delivery = Delivery()
    return _delivery


_MAX_APPROVAL_TASKS = 2
_approval_tasks: dict[str, asyncio.Task] = {}
_runtime_lock = threading.Lock()
_runtime_thread: threading.Thread | None = None
_APPROVAL_WORDS = {"批准", "同意", "approve", "拒绝", "reject", "deny"}


def _message_decision(item):
    return decide_ingress(
        chat_type=str(item.get("chat_type") or "p2p"), text=str(item.get("text") or ""),
        mentioned=bool(item.get("mentioned")), group_policy=get_settings().feishu_group_policy,
        is_bot=bool(item.get("is_bot")),
    )


def _is_approval(item, decision=None):
    if item.get("kind") == "card":
        return True
    # Normalize mentions/aliases exactly as the actual text approval handler.
    decision = decision or _message_decision(item)
    return decision.action == "process" and decision.text.strip().lower() in _APPROVAL_WORDS


def _persist_ingress(item, remote_id, priority):
    from app.agent_inbox import submit_event

    decision = _message_decision(item) if item.get("kind") == "message" else None
    approval = _is_approval(item, decision)
    bind_text = approval and decision is not None
    with Session(engine) as session:
        row = submit_event(session, conversation_id=f"feishu-ingress:{item['chat_id']}",
            source="feishu_approval" if approval else "feishu_ingress",
            dedupe_key=remote_id or None, payload=item, priority=priority,
            initial_status="ingress_accepting" if bind_text else "ingress_ready",
            commit=False)
        # This intermediate status is only visible to the inserting transaction.
        # A duplicate returns the committed canonical receipt with its original target.
        if row.status == "ingress_accepting":
            cid = session.exec(select(Conversation.id).where(
                Conversation.source == "feishu", Conversation.user_id == DEMO_USER,
                Conversation.external_chat_id == item["chat_id"],
            ).limit(1)).first()
            target = find_pending_confirm(session, cid) if cid else None
            row.payload = {**row.payload, "approval_conversation_id": cid,
                           "approval_approve": decision.text.strip().lower() in {"批准", "同意", "approve"},
                           "approval_message_id": target.id if target else None,
                           "approval_target_status": "bound" if target else "no_pending_confirmation"}
            row.status = "ingress_ready"
        event_id = row.id
        session.commit()
        return event_id



_MAX_BUSY_ATTEMPTS = 4


def _ingress_due():
    return ((AgentEvent.status == "ingress_ready") |
            ((AgentEvent.status == "ingress_busy") & (AgentEvent.claimed_at <= utcnow())))


def _busy_toast(exhausted=False):
    message = "会话忙，本次确认尚未执行。请重新提交。" if exhausted else "会话忙，本次确认尚未执行，稍后重试。"
    return {"toast": {"type": "info", "content": message}}


async def _dispatch_ingress(event_id, *, decision=None):
    with Session(engine) as session:
        claimed = session.execute(update(AgentEvent).where(
            AgentEvent.id == event_id, _ingress_due()
        ).values(status="ingress_processing", claimed_at=utcnow())).rowcount
        row = session.get(AgentEvent, event_id)
        if not claimed:
            if row.status in {"ingress_busy", "ingress_busy_exhausted"}:
                return _busy_toast(row.status == "ingress_busy_exhausted")
            if row.status == "done":
                return row.payload.get("result") or {"toast": {"type": "info", "content": "已处理"}}
            return {"toast": {"type": "info", "content": "处理结果尚未确认"}}
        item = dict(row.payload)
        attempts = int(item.get("busy_attempts") or 0) + 1
        item["ingress_id"] = row.dedupe_key or row.id
        if decision is not None:
            item["_decision"] = decision
        session.commit()
    try:
        if item.get("kind") == "card":
            result = await handle_card_async(item)
        else:
            result = await handle_message_async(item)
    except BaseException:
        with Session(engine) as session:
            session.execute(update(AgentEvent).where(AgentEvent.id == event_id)
                            .values(status="ingress_unknown", processed_at=utcnow()))
            session.commit()
        raise
    with Session(engine) as session:
        row = session.get(AgentEvent, event_id)
        if result and result.get("error") == "conversation_busy":
            exhausted = attempts >= _MAX_BUSY_ATTEMPTS
            row.status = "ingress_busy_exhausted" if exhausted else "ingress_busy"
            row.claimed_at = utcnow() + timedelta(seconds=2 ** attempts)
            row.payload = {**row.payload, "busy_attempts": attempts,
                           "approval_message_id": result["approval_message_id"]}
            outcome = _busy_toast(exhausted)
        else:
            row.status = "done"
            row.processed_at = utcnow()
            row.payload = {**row.payload, "result": result}
            outcome = result
        session.commit()
    if result and result.get("error") == "conversation_busy" and item.get("kind") == "message":
        if attempts in {1, _MAX_BUSY_ATTEMPTS}:
            get_delivery().text(item["chat_id"], outcome["toast"]["content"])
    return outcome


def _approval_finished(event_id, task):
    _approval_tasks.pop(event_id, None)
    if not task.cancelled():
        try:
            task.result()
        except Exception:
            logger.exception("approval dispatch failed for %s", event_id)


async def _route_ingress(event_id, *, wait_for_result=False):
    # Only the SDK callback may wait for a card result. Queue and recovery
    # scans always return to the control lane once an approval has been started.
    with Session(engine) as session:
        row = session.get(AgentEvent, event_id)
        if row is None:
            return {"toast": {"type": "error", "content": "请求不存在"}}
        decision = _message_decision(row.payload) if row.payload.get("kind") == "message" else None
        approval = row.source == "feishu_approval"
        if not approval and _is_approval(row.payload, decision):
            # Receipts written by earlier versions may still be waiting.
            approval = True
            row.source = "feishu_approval"
            session.commit()
        if approval and event_id not in _approval_tasks and len(_approval_tasks) >= _MAX_APPROVAL_TASKS:
            if row.status in {"ingress_busy", "ingress_busy_exhausted"}:
                return _busy_toast(row.status == "ingress_busy_exhausted")
            if row.status == "done":
                return row.payload.get("result") or {"toast": {"type":"info", "content":"已处理"}}
            message = "已排队，等待处理" if row.status == "ingress_ready" else "处理结果尚未确认"
            return {"toast": {"type": "info", "content": message}}
    if not approval:
        return await _dispatch_ingress(event_id, decision=decision)
    task = _approval_tasks.get(event_id)
    if task is None:
        task = asyncio.create_task(_dispatch_ingress(event_id, decision=decision), name=f"feishu-approval:{event_id}")
        _approval_tasks[event_id] = task
        task.add_done_callback(lambda done: _approval_finished(event_id, done))
    if wait_for_result:
        return await asyncio.shield(task)
    return None


def ensure_async_runtime() -> asyncio.AbstractEventLoop:
    with _runtime_lock:
        return _start_runtime()


def _start_runtime() -> asyncio.AbstractEventLoop:
    """在后台线程跑 asyncio loop，供同步 WS 回调投递任务。"""
    global _loop, _queue
    if _loop and _loop.is_running() and _queue is not None:
        return _loop

    global _runtime_thread
    ready = threading.Event()

    def _runner() -> None:
        global _loop, _queue
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        _loop = loop
        _queue = asyncio.PriorityQueue()
        loop.call_soon(ready.set)

        async def _worker() -> None:
            assert _queue is not None
            next_scan = loop.time()
            while True:
                if loop.time() >= next_scan:
                    next_scan = loop.time() + 2
                    try:
                        with Session(engine) as session:
                            query = select(AgentEvent.id).where(_ingress_due())
                            if len(_approval_tasks) >= _MAX_APPROVAL_TASKS:
                                query = query.where(AgentEvent.source != "feishu_approval")
                            due = session.exec(query.order_by(AgentEvent.priority, AgentEvent.created_at).limit(1)).first()
                        if due:
                            await _route_ingress(due)
                    except Exception:
                        logger.exception("durable ingress dispatch failed")
                try:
                    _prio, _seq_n, item = await asyncio.wait_for(_queue.get(), timeout=2)
                except asyncio.TimeoutError:
                    continue
                try:
                    kind = item.get("kind")
                    if kind == "ingress":
                        await _route_ingress(item["id"])
                    elif kind in {"message", "card"}:
                        event_id = _persist_ingress(item, item.get("ingress_id"), _prio)
                        await _route_ingress(event_id)
                except Exception:  # noqa: BLE001
                    logger.exception("async worker failed")
                finally:
                    _queue.task_done()

        loop.create_task(_worker())
        loop.create_task(_watchdog_loop())
        try:
            loop.run_forever()
        finally:
            tasks = asyncio.all_tasks(loop)
            for task in tasks:
                task.cancel()
            loop.run_until_complete(asyncio.gather(*tasks, return_exceptions=True))
            _approval_tasks.clear()
            loop.close()

    t = threading.Thread(target=_runner, name="feishu-async", daemon=True)
    _runtime_thread = t
    t.start()
    ready.wait(timeout=5)
    assert _loop is not None
    return _loop


def stop_async_runtime() -> None:
    global _loop, _queue, _runtime_thread
    with _runtime_lock:
        if _loop is not None and _loop.is_running():
            _loop.call_soon_threadsafe(_loop.stop)
        if _runtime_thread is not None:
            _runtime_thread.join()
        _runtime_thread = None
        _loop = None
        _queue = None


def enqueue_message(payload: dict[str, Any], *, priority: int = 0) -> None:
    """priority: 0=用户单聊（最高），1=卡片，2=其它。用户直连优先于 routine。"""
    global _seq
    loop = ensure_async_runtime()
    assert _queue is not None

    def _put() -> None:
        global _seq
        assert _queue is not None
        _seq += 1
        _queue.put_nowait((priority, _seq, payload))

    loop.call_soon_threadsafe(_put)


async def _emit_to_feishu(chat_id: str, conversation_id: str):
    delivery = get_delivery()

    async def emit(event: str, data: dict[str, Any]) -> None:
        # Terminal error text may itself be the final durable reply. Keep it
        # off the callback card's progress channel just like the done body.
        if event == "error":
            return
        payload = dict(data)
        payload.setdefault("conversationId", conversation_id)
        if event == "done":
            payload.pop("reply", None)
        await asyncio.to_thread(delivery.progress, chat_id, event, payload)

    return emit


async def handle_message_async(item: dict[str, Any]) -> dict[str, Any] | None:
    open_id = str(item.get("open_id") or "")
    chat_id = str(item.get("chat_id") or "")
    chat_type = str(item.get("chat_type") or "p2p")
    decision = item.get("_decision") or _message_decision(item)
    delivery = get_delivery()

    if decision.action == "ignore":
        return
    if decision.action == "silent_buffer":
        _SILENT_BUFFER.append(
            {"chat_id": chat_id, "open_id": open_id, "text": decision.text, "ts": utcnow().isoformat()}
        )
        logger.info("silent buffer chat=%s: %.60s", chat_id, decision.text)
        return

    with Session(engine) as session:
        low = decision.text.strip().lower()
        bound_vote = item.get("approval_approve")
        if isinstance(bound_vote, bool) or (decision.action == "process" and low in _APPROVAL_WORDS):
            message_id = item.get("approval_message_id")
            target = session.get(Message, message_id) if message_id else None
            # Older busy receipts already pinned the original message. Older
            # ready receipts without an ID cannot establish what was approved.
            cid = item.get("approval_conversation_id") or (target.conversation_id if target else None)
            conv = session.get(Conversation, cid) if cid else None
            if not (target and conv and target.conversation_id == cid and conv.user_id == DEMO_USER
                    and conv.source == "feishu" and conv.external_chat_id == chat_id
                    and any(action.get("type") == "confirm_required" for action in target.actions or [])):
                note = "收到请求时没有待确认操作。" if not message_id else "原确认请求已失效。"
                delivery.text(chat_id, note)
                return {"toast": {"type": "info", "content": note}}
            approve = bound_vote if isinstance(bound_vote, bool) else low in {"批准", "同意", "approve"}
            emit = await _emit_to_feishu(chat_id, cid) if approve else None
            result = await respond_conversation_impl(session, conv, approve=approve, message_id=message_id, emit=emit)
            if result.get("error") == "conversation_busy":
                return {"error": "conversation_busy", "approval_message_id": message_id}
            if not result.get("feishuReplyHandled") and not any(e.get("event") == "done" for e in result.get("events") or []):
                delivery.text(chat_id, str(result.get("reply") or result.get("error") or "已处理。"))
            return

        conv = find_or_create_conversation(
            session, open_id=open_id, chat_id=chat_id, chat_type=chat_type
        )

        if decision.action == "control":
            reply = await _handle_control(session, conv, decision.command or "", decision.command_arg or "", ingress_id=item.get("ingress_id"))
            if reply:
                delivery.text(chat_id, reply)
            return

        # 群聊候选：入收件箱由总编语义层判断（可能 NOOP）
        if decision.action == "candidate":
            from app.agent_inbox import submit_event

            submit_event(
                session,
                conversation_id=conv.id,
                source="feishu_candidate",
                dedupe_key=item.get("ingress_id"),
                payload={"message": decision.text, "chat_id": chat_id, "project_id":conv.project_id},
            )
            logger.info("candidate queued chat=%s: %.60s", chat_id, decision.text)
            return

        cleaned = decision.text
        # 忙时也写入收件箱；_run_chat 会合并或排队
        await _run_chat(
            session,
            conv,
            chat_id,
            cleaned,
            dedupe_key=item.get("ingress_id"),            target_bot_id=getattr(decision, "target_bot_id", None),
            mention_bot_ids=list(getattr(decision, "mention_bot_ids", None) or []),
        )


async def _run_chat(
    session: Session,
    conv: Conversation,
    chat_id: str,
    text: str,
    *,
    dedupe_key: str | None = None,
    target_bot_id: str | None = None,
    mention_bot_ids: list[str] | None = None,
) -> None:
    """写入收件箱 → chief_runner 全双工 drain。"""
    from app.agent_inbox import submit_event
    from app.chief_runner import run_conversation_turns
    from app.thread_router import route_user_message

    delivery = get_delivery()

    # @Bot名 → 绑定会话 bot / 升级群聊
    if target_bot_id or mention_bot_ids:
        if mention_bot_ids and len(mention_bot_ids) > 1:
            conv.kind = "group"
            conv.member_bot_ids = list(
                dict.fromkeys([*(conv.member_bot_ids or []), *mention_bot_ids])
            )
        elif target_bot_id:
            conv.bot_id = target_bot_id
            if getattr(conv, "kind", "dm") not in {"group", "routine"}:
                conv.kind = "dm"
        conv.updated_at = utcnow()
        session.add(conv)
        session.commit()

    # Thread 直通
    route = route_user_message(
        session,
        dedupe_key=dedupe_key,
        conversation_id=conv.id,
        message=text,
        project_id=conv.project_id,
    )
    if route.get("action") == "steer":
        delivery.text(
            chat_id,
            f"已直通运行中的「{route.get('agent_id') or 'Worker'}」，指令已追加。",
        )
        return

    submit_event(
        session,
        conversation_id=conv.id,
        source="feishu",
        dedupe_key=dedupe_key,
        payload={
            "message": text,
            "chat_id": chat_id,
            "project_id": conv.project_id,
            "mention_bot_ids": mention_bot_ids or [],
        },
        target_bot_id=target_bot_id or getattr(conv, "bot_id", None),
    )

    if dedupe_key:
        # SDK ingress already has a durable wake. The shared pump owns inference
        # and delivery, leaving the ingress worker available for controls.
        return

    _BUSY.add(chat_id)
    try:
        emit = await _emit_to_feishu(chat_id, conv.id)

        result = await run_conversation_turns(
            session,
            conv.id,
            emit=emit,
        )
        if result.get("idle"):
            delivery.text(chat_id, "当前任务进行中，已将你的指令加入队列。")
    finally:
        _BUSY.discard(chat_id)


async def _handle_control(
    session: Session,
    conv: Conversation,
    command: str,
    arg: str,
    *, ingress_id: str | None = None,
) -> str:
    if command == "help":
        return help_text()
    if command == "reset":
        new_conv = reset_conversation(session, conv)
        return f"已重置本 chat 会话（新 id={new_conv.id[:8]}…）。项目记忆未清除。"
    if command == "status":
        pending = find_pending_confirm(session, conv.id)
        project_title = "—"
        if conv.project_id:
            p = session.get(Project, conv.project_id)
            if p:
                project_title = p.title
        from app.models import InboxLease
        active = session.exec(select(InboxLease.token).where(
            InboxLease.conversation_id == conv.id, InboxLease.expires_at > utcnow()
        )).first()
        busy = "进行中" if active or (conv.external_chat_id or "") in _BUSY else "空闲"
        lines = [
            f"会话：{conv.id[:8]}…（{conv.title}）",
            f"绑定项目：{project_title}",
            f"状态：{busy}",
            f"待确认：{'有 — ' + (pending.content or '')[:80] if pending else '无'}",
            f"静默缓冲条数：{len(_SILENT_BUFFER)}",
        ]
        return "\n".join(lines)
    if command == "followup":
        if not arg:
            return "用法：/followup <追加指令>"
        chat_id = conv.external_chat_id or ""
        if ingress_id:
            await _run_chat(session, conv, chat_id, arg, dedupe_key=ingress_id)
            return "已加入 followup 队列。"
        if chat_id in _BUSY:
            _FOLLOWUPS.setdefault(chat_id, deque()).append(arg)
            return "已加入 followup 队列。"
        # 空闲则直接跑
        await _run_chat(session, conv, chat_id, arg)
        return ""
    if command == "project":
        return _bind_project(session, conv, arg)
    if command == "bots":
        try:
            from app.agent_colleagues import roster
            from app.bot_registry import seed_system_bots

            seed_system_bots(session)
            data = roster()
            lines = [
                f"AI 同事花名册：总编 + {data.get('stats', {}).get('domainAgents', 0)} 位专职",
                "• 幕僚长（总编）— 默认联系人",
                "• 蛋博士 — 高级：自定义同事 / 例程审计",
            ]
            for g in (data.get("teams") or [])[:12]:
                names = "、".join(m.get("name") for m in (g.get("members") or [])[:4])
                more = len(g.get("members") or []) - 4
                suffix = f"…等{more}位" if more > 0 else ""
                lines.append(f"• {g.get('team')}（{g.get('count')}）：{names}{suffix}")
            lines.append("用法：@灵感猎手 / @圣经守门人 或「同事名：」后跟任务")
            return "\n".join(lines)
        except Exception as exc:  # noqa: BLE001
            return f"列出同事失败：{exc}"
    if command == "team":
        try:
            from app.agent_colleagues import squads
            from app.models import BotTeam
            from sqlmodel import select as _select

            teams = list(session.exec(_select(BotTeam)))
            lines = ["已建群组："] if teams else ["还没有自定义群组。"]
            for t in teams[:15]:
                lines.append(
                    f"• {t.name} members={len(t.member_bot_ids or [])} "
                    f"policy={t.speak_policy} lead={t.lead_bot_id or '—'}"
                )
            presets = [s for s in squads() if s.get("kind") == "workflow"][:6]
            if presets:
                lines.append("编组预设（可在 Web 一键套用）：")
                for s in presets:
                    lines.append(f"• {s.get('name')}（{len(s.get('memberBotIds') or [])} 人）")
            lines.append("可在 Web「AI 同事」组队向导创建。")
            return "\n".join(lines)
        except Exception as exc:  # noqa: BLE001
            return f"列出团队失败：{exc}"
    return help_text()


def _bind_project(session: Session, conv: Conversation, arg: str) -> str:
    arg = (arg or "").strip()
    projects = list(
        session.exec(select(Project).where(Project.user_id == DEMO_USER).order_by(Project.last_opened_at.desc()))
    )
    if not arg or arg.lower() == "list":
        if not projects:
            return "还没有项目。可在 Web 或对我说「新建项目」。"
        lines = ["项目列表："]
        for p in projects[:20]:
            mark = " ← 当前" if p.id == conv.project_id else ""
            lines.append(f"• {p.title}（{p.format} / {p.stage}）id={p.id[:8]}…{mark}")
        lines.append("绑定：/project <id或标题关键词>")
        return "\n".join(lines)

    matched = None
    for p in projects:
        if p.id == arg or p.id.startswith(arg) or arg in p.title:
            matched = p
            break
    if not matched:
        return f"找不到项目「{arg}」。用 /project list 查看。"
    conv.project_id = matched.id
    conv.updated_at = utcnow()
    session.add(conv)
    session.commit()
    return f"已绑定项目《{matched.title}》。后续写作默认用它。"


async def handle_card_async(item: dict[str, Any]) -> dict[str, Any]:
    """处理卡片按钮；返回 toast/card 更新给飞书 SDK。"""
    value = item.get("value") or {}
    action = str(value.get("action") or "")
    chat_id = str(item.get("chat_id") or "")
    delivery = get_delivery()

    if action == "confirm":
        conversation_id = str(value.get("conversation_id") or "")
        message_id = str(item.get("approval_message_id") or value.get("message_id") or "") or None
        approve = bool(value.get("approve"))
        with Session(engine) as session:
            conv = session.get(Conversation, conversation_id)
            if not conv:
                return {"toast": {"type": "error", "content": "会话不存在"}}
            emit = await _emit_to_feishu(chat_id or conv.external_chat_id or "", conv.id)
            if not message_id:
                pending = find_pending_confirm(session, conv.id)
                if not pending:
                    return {"toast": {"type": "info", "content": "没有待确认操作。"}}
                message_id = pending.id
            result = await respond_conversation_impl(
                session, conv, approve=approve, message_id=message_id, emit=emit
            )
            if result.get("error") == "conversation_busy":
                return {"error": "conversation_busy", "approval_message_id": message_id}
            if not result.get("ok"):
                return {"toast": {"type": "error", "content": result.get("error") or "失败"}}
            content = "已批准" if approve else "已拒绝"
            card_body = content if result.get("feishuReplyHandled") else str(result.get("reply") or content)
            if approve and result.get("reply") and not result.get("feishuReplyHandled"):
                if not any(e.get("event") == "done" for e in result.get("events") or []):
                    delivery.text(chat_id or conv.external_chat_id or "", str(result["reply"]))
            return {
                "toast": {"type": "success", "content": content},
                "card": result_card(title=content, body=card_body),
            }

    if action == "proposal":
        proposal_id = str(value.get("proposal_id") or "")
        approve = bool(value.get("approve"))
        with Session(engine) as session:
            prop = session.get(TaskProposal, proposal_id)
            if not prop:
                return {"toast": {"type": "error", "content": "提案不存在"}}
            if not approve:
                prop.status = "dismissed"
                session.add(prop)
                session.commit()
                return {"toast": {"type": "info", "content": "已稍后处理"}, "card": result_card(title="已稍后", body=prop.message)}
            # 批准：走 personal_agent approve_proposal 逻辑
            from app.routers.personal_agent import _execute_supervisor_tool

            # 找最近飞书会话承接
            conv = None
            if chat_id:
                conv = session.exec(
                    select(Conversation).where(
                        Conversation.source == "feishu",
                        Conversation.external_chat_id == chat_id,
                    )
                ).first()
            if not conv:
                conv = find_or_create_conversation(
                    session,
                    open_id=str(item.get("open_id") or ""),
                    chat_id=chat_id or "unknown",
                    chat_type="p2p",
                )
            text, _detail = await _execute_supervisor_tool(
                "approve_proposal", {"proposal_id": proposal_id}, session, conv
            )
            delivery.text(chat_id or conv.external_chat_id or "", text)
            return {
                "toast": {"type": "success", "content": "已批准提案"},
                "card": result_card(title="提案已批准", body=text),
            }

    return {"toast": {"type": "info", "content": "未知操作"}}


def handle_message_event_sync(data, bot_open_id: str | None = None) -> None:
    """WS 同步回调入口：解析后入队。"""
    try:
        ev = data.event
        message = ev.message
        import json

        content = json.loads(message.content or "{}")
        text = content.get("text") or ""
        if not text.strip() and content.get("content"):
            # post 富文本简单抽取
            text = str(content.get("content"))
        open_id = ""
        if ev.sender and ev.sender.sender_id:
            open_id = ev.sender.sender_id.open_id or ""
        chat_id = message.chat_id
        chat_type = getattr(message, "chat_type", None) or "p2p"
        mentioned = message_mentions_bot(message, bot_open_id)
        # 单聊用户消息高优先级，可打断 routine 排队
        prio = 0 if str(chat_type).lower() in {"p2p", "private", "dm"} else 1
        event_id = _persist_ingress(
            {
                "kind": "message",
                "open_id": open_id,
                "chat_id": chat_id,
                "chat_type": chat_type,
                "text": text,
                "mentioned": mentioned,
                "is_bot": is_bot_sender(ev),
            },
            getattr(message, "message_id", None) or getattr(getattr(data, "header", None), "event_id", None),
            priority=prio,
        )
        enqueue_message({"kind": "ingress", "id": event_id}, priority=prio)
    except Exception:  # noqa: BLE001
        logger.exception("handle_message_event_sync failed")


def handle_card_event_sync(data) -> dict[str, Any]:
    """卡片回调：同步等待异步处理结果（按钮需立即 toast）。"""
    try:
        ev = data.event
        value = (ev.action.value if ev.action else None) or {}
        chat_id = ""
        if ev.context:
            chat_id = ev.context.open_chat_id or ""
        open_id = ""
        if ev.operator:
            open_id = ev.operator.open_id or ""
        item = {
            "kind": "card",
            "value": value,
            "chat_id": chat_id,
            "open_id": open_id,
        }
        loop = ensure_async_runtime()
        remote_id = getattr(getattr(data, "header", None), "event_id", None)
        event_id = _persist_ingress(item, remote_id, 1)
        fut = asyncio.run_coroutine_threadsafe(_route_ingress(event_id, wait_for_result=True), loop)
        result = fut.result(timeout=120)
        # 转成 SDK 响应结构（dict 即可，handler 里再包）
        return result if isinstance(result, dict) else {"toast": {"type": "info", "content": "ok"}}
    except Exception:  # noqa: BLE001
        logger.exception("handle_card_event_sync failed")
        return {"toast": {"type": "error", "content": "处理失败"}}


async def _watchdog_loop() -> None:
    """Control Loop：委托 app.watchdog.scan（卡住 / 无进展 / 超时 processing）。"""
    from app.watchdog import scan

    while True:
        try:
            await asyncio.sleep(60)
            settings = get_settings()
            minutes = max(5, int(settings.feishu_watchdog_stuck_minutes or 15))
            with Session(engine) as session:
                try:
                    scan(session, stuck_minutes=minutes, announce=True)
                except Exception:  # noqa: BLE001
                    # SQLite locked → PendingRollback；必须 rollback 否则后续 tick 连环失败
                    try:
                        session.rollback()
                    except Exception:  # noqa: BLE001
                        pass
                    raise
        except Exception:  # noqa: BLE001
            logger.exception("watchdog tick failed")
