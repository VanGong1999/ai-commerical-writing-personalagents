"""总编全双工 Runner：收件箱 drain → Supervisor → 直到空。

Web /chat 与飞书 _run_chat 共用，避免重复 drain 逻辑。
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Awaitable, Callable

from sqlmodel import Session

from .agent_inbox import (
    drain_and_prepare,
    inbox_event_actions,
    mark_done,
    processing_for_owner,
    maintain_owner,
    check_owner,
)
from .models import Conversation, utcnow
from .feishu_outbox import ReplyTurn

logger = logging.getLogger(__name__)

EmitFn = Callable[[str, dict[str, Any]], Awaitable[None]]


async def run_conversation_turns(
    session: Session,
    conversation_id: str,
    *,
    emit: EmitFn | None = None,
    max_batches: int = 8,
) -> dict[str, Any]:
    """循环处理收件箱直到空或达 max_batches。

    emit: SSE/飞书进度回调 (event, data)
    """
    from .routers.personal_agent import (
        _append_message,
        _maybe_title_conversation,
        _run_supervisor,
    )

    async def _emit(event: str, data: dict[str, Any]) -> None:
        check_owner(session, conversation_id)
        active = ReplyTurn.current(session, conversation_id)
        if active and event in {"done", "confirm", "error"}:
            active.refs = data.get("contextRefs", active.refs)
            if event == "confirm":
                active.confirm = True
        if emit:
            await emit(event, data)

    batches = 0
    last_reply: str | None = None
    total_events = 0

    while batches < max_batches:
        conv, events, merged = drain_and_prepare(session, conversation_id)
        if not conv or not events:
            break
        batches += 1
        total_events += len(events)

        # 写入 Message：带 inbox_event 标记
        is_pure_user = all(e.source in {"web", "feishu"} for e in events) and len(events) == 1
        role = "user"
        actions = inbox_event_actions(events)
        if is_pure_user and events[0].source in {"web", "feishu"}:
            # 单条用户消息：仍标 inbox_event，但 UI 可当气泡渲染
            text = str((events[0].payload or {}).get("message") or merged)
            _append_message(session, conv.id, role, text, actions=actions)
            _maybe_title_conversation(session, conv, text)
        else:
            _append_message(session, conv.id, role, merged, actions=actions)
            _maybe_title_conversation(session, conv, merged)

        conv.updated_at = utcnow()
        session.add(conv)
        session.commit()

        turn = None
        try:
            for row in events:
                row.execution_started = True
            session.commit()
            session.info["inbox_execution_started"] = True
            turn = ReplyTurn.open(session, conv, events)
            if turn:
                session.info["feishu_reply_turn"] = turn
            async with maintain_owner(session, conversation_id):
                reply = await _run_supervisor(session, conv, _emit, claimed_events=events)
                if turn and not turn.sealed:
                    turn.finish(session, conv, reply, processing_for_owner(session, conv.id))
                    session.flush()
            mark_done(session, events, failed=False, sealed=bool(turn and turn.sealed))
            if reply:
                last_reply = reply
        except Exception:
            session.rollback()
            mark_done(session, events, failed=True, sealed=bool(turn and turn.sealed))
            raise
        finally:
            session.info.pop("feishu_reply_turn", None)
            session.info.pop("inbox_execution_started", None)

    return {
        "batches": batches,
        "events": total_events,
        "reply": last_reply,
        "idle": batches == 0,
    }


async def pump_one(session: Session, conversation_id: str) -> dict[str, Any]:
    """处理指定会话的收件箱，最终飞书回复由独立投递任务发送。"""
    conv = session.get(Conversation, conversation_id)
    if not conv:
        return {"ok": False, "error": "not_found"}

    # 飞书进度：安静模式，不逐条 tool_call
    async def _quiet_emit(event: str, data: dict[str, Any]) -> None:
        if conv.source != "feishu":
            return
        if event == "confirm":
            try:
                from .feishu_notify import send_text

                msg = str(data.get("message") or "需要确认")
                active = ReplyTurn.current(session, conv.id)
                target = active.target if active and not active.conflict else None
                if target:
                    await asyncio.to_thread(send_text, target, f"⏳ {msg}")
            except Exception:  # noqa: BLE001
                pass

    return await run_conversation_turns(
        session,
        conversation_id,
        emit=_quiet_emit if conv.source == "feishu" else None,
    )
