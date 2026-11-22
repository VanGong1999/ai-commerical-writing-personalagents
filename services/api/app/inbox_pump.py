"""Always-on 唤醒泵：轮询 pending 收件箱，驱动总编 / Watchdog。"""

from __future__ import annotations

import asyncio
import logging

from sqlmodel import Session

from .agent_inbox import list_pending_conversation_ids
from .db import engine
from .settings import get_settings

logger = logging.getLogger(__name__)

_task: asyncio.Task | None = None
_stop = asyncio.Event()
_delivery: asyncio.Task | None = None
_active: dict[str, asyncio.Task] = {}


async def _drain(cid: str) -> None:
    from .chief_runner import pump_one

    try:
        with Session(engine) as session:
            result = await pump_one(session, cid)
            if result.get("batches"):
                logger.info("inbox_pump drained %s → %s", cid[:8], result)
    except Exception:
        logger.exception("inbox_pump failed for %s", cid)
    finally:
        _active.pop(cid, None)


async def _tick() -> None:
    from .watchdog import scan
    from . import task_daemon as task_daemon_mod

    settings = get_settings()
    with Session(engine) as session:
        try:
            scan(
                session,
                stuck_minutes=int(settings.feishu_watchdog_stuck_minutes or 15),
                announce=True,
            )
        except Exception:  # noqa: BLE001
            logger.exception("watchdog scan failed")
            try:
                session.rollback()
            except Exception:  # noqa: BLE001
                pass

        try:
            td = task_daemon_mod.tick(session)
            if td.get("unlocked") or td.get("waitingSet"):
                logger.info("task_daemon tick → %s", td)
        except Exception:  # noqa: BLE001
            logger.exception("task_daemon tick failed")
            try:
                session.rollback()
            except Exception:  # noqa: BLE001
                pass

        from .llm_governor import load_config
        capacity = load_config(session).worker_concurrency_cap
        ids = list_pending_conversation_ids(session, limit=20)
    for cid in ids:
        if len(_active) >= capacity:
            break
        if cid not in _active:
            _active[cid] = asyncio.create_task(_drain(cid), name=f"inbox:{cid}")

    from .feishu_outbox import deliver_one
    global _delivery
    if _delivery is None or _delivery.done():
        if _delivery and not _delivery.cancelled() and _delivery.exception():
            logger.error("Feishu outbox tick failed: %s", _delivery.exception())
        _delivery = asyncio.create_task(asyncio.to_thread(deliver_one, engine), name="feishu-outbox")



async def _loop() -> None:
    while not _stop.is_set():
        try:
            await _tick()
        except Exception:  # noqa: BLE001
            logger.exception("inbox_pump tick error")
        try:
            await asyncio.wait_for(_stop.wait(), timeout=2.0)
        except asyncio.TimeoutError:
            pass


def start_inbox_pump() -> None:
    global _task
    if _task and not _task.done():
        return
    _stop.clear()
    _task = asyncio.create_task(_loop(), name="inbox_pump")
    logger.info("inbox_pump started")


async def stop_inbox_pump() -> None:
    global _task, _delivery
    _stop.set()
    if _task:
        try:
            await asyncio.wait_for(_task, timeout=5)
        except Exception:  # noqa: BLE001
            _task.cancel()
        _task = None
    tasks = list(_active.values())
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    _active.clear()
    if _delivery:
        await asyncio.gather(_delivery, return_exceptions=True)
        _delivery = None
    logger.info("inbox_pump stopped")
