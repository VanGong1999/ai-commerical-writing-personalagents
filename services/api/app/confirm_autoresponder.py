"""Personal Agent 确认超时自动应答。

用户长时间未点「批准/拒绝」时，按默认策略自动批准并续跑，
避免流程因无人操作而永久卡在待确认状态。

支持 Bot 否决窗口：confirm_required.actions 上的 veto_window / veto_window_min
优先于全局 personal_agent_confirm_timeout_min。
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlmodel import Session, select

from .db import engine
from .models import Conversation, Message
from .settings import get_settings

logger = logging.getLogger("confirm-autoresponder")

_tasks: list[asyncio.Task] = []


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


async def _loop() -> None:
    default_timeout_min = max(1, int(get_settings().personal_agent_confirm_timeout_min or 10))
    while True:
        try:
            await asyncio.sleep(20)
            if not get_settings().personal_agent_auto_respond:
                continue
            now = datetime.now(timezone.utc)
            to_respond: list[tuple[str, str]] = []
            with Session(engine) as session:
                # 只扫最近一段时间的消息，避免全表
                lookback = now - timedelta(days=2)
                rows = list(
                    session.exec(select(Message).where(Message.created_at > lookback))
                )
                pending = [
                    m
                    for m in rows
                    if any(
                        (a or {}).get("type") == "confirm_required"
                        for a in (m.actions or [])
                    )
                ]
                for m in pending:
                    conv = session.get(Conversation, m.conversation_id)
                    if not conv:
                        continue
                    act = next(
                        (a for a in (m.actions or []) if (a or {}).get("type") == "confirm_required"),
                        {},
                    )
                    if act.get("tool") == "pipeline_stage_ack":
                        continue
                    # 否决窗口：仅当标记了 veto_window 才自动放行；否则仍走全局超时
                    if act.get("veto_window"):
                        timeout_min = int(act.get("veto_window_min") or default_timeout_min)
                    else:
                        # 非 veto：仅在全局 auto_respond 下按默认超时放行
                        timeout_min = default_timeout_min
                    created = _aware(m.created_at)
                    if not created:
                        continue
                    if created > now - timedelta(minutes=timeout_min):
                        continue
                    logger.warning(
                        "auto-respond approve conversation=%s message=%s (timeout %smin veto=%s)",
                        m.conversation_id,
                        m.id,
                        timeout_min,
                        bool(act.get("veto_window")),
                    )
                    to_respond.append((m.conversation_id, m.id))
            for conv_id, message_id in to_respond:
                asyncio.create_task(_respond(conv_id, message_id))
        except Exception:  # noqa: BLE001
            logger.exception("confirm auto-respond loop error")


async def _respond(conv_id: str, message_id: str) -> None:
    """独立的自动应答：每次开自己的 Session，避免跨任务共享关闭的连接。"""
    from .models import Conversation
    from .routers.personal_agent import respond_conversation_impl

    try:
        with Session(engine) as session:
            conv = session.get(Conversation, conv_id)
            if not conv:
                return
            await respond_conversation_impl(
                session,
                conv,
                approve=True,
                message_id=message_id,
                emit=None,
            )
            session.commit()
    except Exception:  # noqa: BLE001
        logger.exception("auto-respond conversation=%s message=%s failed", conv_id, message_id)


def start_confirm_autoresponder() -> None:
    if _tasks:
        return
    _tasks.append(asyncio.create_task(_loop()))


async def stop_confirm_autoresponder() -> None:
    for t in _tasks:
        t.cancel()
    await asyncio.gather(*_tasks, return_exceptions=True)
    _tasks.clear()
