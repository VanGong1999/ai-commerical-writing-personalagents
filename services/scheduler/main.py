#!/usr/bin/env python3
"""Scheduler — only enqueues jobs / task proposals; never calls LLM directly."""

from __future__ import annotations

import logging
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

API_ROOT = Path(__file__).resolve().parents[1] / "api"
SCHED_ROOT = Path(__file__).resolve().parent
for p in (API_ROOT, SCHED_ROOT):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from sqlmodel import Session, select
from sqlalchemy import update

from app.db import engine, init_db
from app.models import Job, ScheduledTask, TaskProposal, utcnow
from app.queue import enqueue_job, publish_job_event
from app.settings import get_settings
from app.scheduling import (
    COLLEAGUE_SCAN,
    SCHEDULE_TIMEZONE,
    cron_field as _cron_field,
    next_cron as _next_cron,
    parse_interval as _parse_interval,
    parse_once as _parse_once,
    scheduled_job_type,
    validate_schedule,
)
from gap_scan import run_colleague_scan

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("scheduler")


def _announce_new_proposals(session: Session) -> None:
    """扫描后把近期 pending 提案推飞书。"""
    try:
        from app.feishu_notify import announce_proposals

        rows = list(
            session.exec(
                select(TaskProposal)
                .where(TaskProposal.status == "pending")
                .order_by(TaskProposal.created_at.desc())
            )
        )[:12]
        n = announce_proposals(session, rows, limit=5)
        if n:
            logger.info("announced %s proposals to feishu", n)
    except Exception:  # noqa: BLE001
        logger.exception("announce proposals failed")

def _ensure_aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _next_run_at(spec: str, after: datetime) -> datetime | None:
    try:
        if _parse_once(spec) is not None:
            return None
        delta = _parse_interval(spec)
        if delta is not None:
            return after + delta
        return _next_cron(spec, after)
    except ValueError:
        logger.warning("invalid schedule %r; refusing hourly fallback", spec)
        return None


def _claim_schedule(session: Session, task: ScheduledTask, now: datetime) -> str | None:
    """CAS the observed occurrence in the same transaction as durable dispatch.

    A stale second scheduler cannot dispatch a timestamp another scheduler advanced.
    Caller commits with the Job/inbox write; no external queue action occurs here.
    """
    due = _parse_once(task.cron_or_interval) or _ensure_aware(task.next_run_at) or now
    nxt = _next_run_at(task.cron_or_interval, now)
    statement = (
        update(ScheduledTask)
        .where(
            ScheduledTask.id == task.id,
            ScheduledTask.enabled == True,  # noqa: E712
            ScheduledTask.next_run_at == task.next_run_at,
            ScheduledTask.last_run_at == task.last_run_at,
        )
        .values(last_run_at=now, next_run_at=nxt, enabled=nxt is not None)
        .execution_options(synchronize_session=False)
    )
    result = session.execute(statement)
    if result.rowcount != 1:
        return None
    session.refresh(task)
    return due.astimezone(timezone.utc).isoformat()


def _is_due(task: ScheduledTask, now: datetime) -> bool:
    once = _parse_once(task.cron_or_interval)
    if once is not None:
        return now >= once
    nra = _ensure_aware(task.next_run_at)
    return nra is None or now >= nra


def _in_active_window(task: ScheduledTask, now: datetime) -> bool:
    """active_window: {start_hour, end_hour} 上海时间小时窗；无则始终可跑。"""
    win = getattr(task, "active_window", None)
    if not win or not isinstance(win, dict):
        return True
    start = win.get("start_hour")
    end = win.get("end_hour")
    if start is None or end is None:
        return True
    try:
        h = (_ensure_aware(now) or now).astimezone(SCHEDULE_TIMEZONE).hour
        s, e = int(start), int(end)
        if s <= e:
            return s <= h < e
        return h >= s or h < e
    except Exception:  # noqa: BLE001
        return True


def _enqueue_bot_routine(
    session: Session, task: ScheduledTask, now: datetime, event: Any = None,
    schedule_occurrence: str | None = None,
) -> None:
    """为 Bot 例程找到/创建干净 routine 会话，写入收件箱。

    event 非空表示事件触发：消息附带事件上下文，去重键按事件 id 去重。
    """
    from app.agent_inbox import PRIORITY_ROUTINE, submit_event
    from app.models import Conversation

    bot_id = getattr(task, "bot_id", None) or (task.payload_template or {}).get("bot_id")
    if not bot_id:
        return
    settings = get_settings()
    user_id = settings.demo_user_id
    from app.knowledge_colleague import colleague, owned_project
    tpl = task.payload_template or {}
    project_id = tpl.get("project_id") or tpl.get("projectId") or (task.event_filter or {}).get("project_id")
    if project_id:
        owned_project(session, project_id, user_id)
        if event is not None and (event.payload or {}).get("project_id") != project_id:
            return
    actor = colleague(session, str(bot_id), user_id, project_id)
    if tpl.get("knowledgeBotId"):
        from fastapi import HTTPException
        if tpl["knowledgeBotId"] != actor.id or not (actor.execution or {}).get("enabled"):
            raise HTTPException(409, "例程绑定的知识岗位不再可用")
    pinned = [actor.id] if (actor.execution or {}).get("enabled") else []
    conv = session.exec(
        select(Conversation).where(
            Conversation.project_id == project_id,
            Conversation.bot_id == str(bot_id),
            Conversation.kind == "routine",
            Conversation.user_id == user_id,
        )
    ).first()
    if not conv:
        conv = Conversation(
            source="assistant",
            user_id=user_id,
            project_id=project_id,
            title=f"例程·{task.name}",
            kind="routine",
            bot_id=str(bot_id),
        )
        session.add(conv)
        # Keep the schedule claim and newly created conversation uncommitted
        # until submit_event durably inserts the inbox entry in the same session.
        session.flush()
    prompt = getattr(task, "prompt", None) or (task.payload_template or {}).get("prompt") or task.name
    message = str(prompt)
    if event is not None:
        p = dict(getattr(event, "payload", None) or {})
        bits = [f"[事件触发] source={event.source}"]
        if p.get("agent_id"):
            bits.append(f"agent={p['agent_id']}")
        if p.get("status"):
            bits.append(f"status={p['status']}")
        if p.get("project_title"):
            bits.append(f"项目《{p['project_title']}》")
        if p.get("run_id"):
            bits.append(f"run={p['run_id']}")
        message = f"{message}\n\n{'；'.join(bits)}"
    submit_event(
        session,
        conversation_id=conv.id,
        source="routine",
        admitted_knowledge_ids=pinned,
        dedupe_key=(
            f"routine:{task.id}:event:{event.id}"
            if event is not None
            else f"routine:{task.id}:{schedule_occurrence or now.isoformat()}"
        ),
        payload={
            "message": message,
            "task_id": task.id,
            "project_id": project_id,
            "quiet_policy": getattr(task, "quiet_policy", None) or "silent_if_nothing",
            "bot_id": str(bot_id),
            "trigger_type": getattr(task, "trigger_type", "schedule") or "schedule",
        },
        priority=PRIORITY_ROUTINE,
        target_bot_id=str(bot_id),
    )
    task.run_count = int(getattr(task, "run_count", 0) or 0) + 1
    session.add(task)
    session.commit()


def _match_recent_events(session: Session, event_filter: dict, since: datetime) -> list[Any]:
    """按 event_filter 匹配 since 之后的新事件。

    支持字段：
    - sources: list[str]，事件来源（默认 ["job_done"]）
    - agent_id_prefix / agent_id：按 payload.agent_id 匹配
    - status：按 payload.status 匹配
    - project_id：按 payload.project_id 匹配
    - artifact_type：按 payload.artifact_types / artifact_type 匹配
    """
    from app.models import AgentEvent

    if not event_filter:
        return []
    sources = event_filter.get("sources") or ["job_done"]
    if isinstance(sources, str):
        sources = [sources]
    rows = list(
        session.exec(
            select(AgentEvent)
            .where(AgentEvent.source.in_(sources))
            .order_by(AgentEvent.created_at.desc())
            .limit(200)
        )
    )
    agent_prefix = event_filter.get("agent_id_prefix")
    agent_id = event_filter.get("agent_id")
    status_f = event_filter.get("status")
    project_id = event_filter.get("project_id")
    artifact_type = event_filter.get("artifact_type")

    out: list[Any] = []
    for ev in rows:
        # 事件是广播信号：除 dropped 外都应命中（含 processing/failed）
        if ev.status == "dropped":
            continue
        created = _ensure_aware(ev.created_at)
        if created is None or created < since:
            continue
        p = dict(ev.payload or {})
        if agent_prefix and not str(p.get("agent_id") or "").startswith(str(agent_prefix)):
            continue
        if agent_id and str(p.get("agent_id") or "") != str(agent_id):
            continue
        if status_f and str(p.get("status") or "") != str(status_f):
            continue
        if project_id and str(p.get("project_id") or "") != str(project_id):
            continue
        if artifact_type:
            types = p.get("artifact_types") or p.get("artifact_type") or []
            if isinstance(types, str):
                types = [types]
            if artifact_type not in types:
                continue
        out.append(ev)
    out.reverse()
    return out


def _dispatch_event_routine(session: Session, task: ScheduledTask, now: datetime) -> None:
    """事件触发例程：扫描 last_run_at 以来的命中事件，逐个唤醒该 Bot。"""
    ef = getattr(task, "event_filter", None) or {}
    if not ef:
        return
    since = _ensure_aware(getattr(task, "last_run_at", None)) or (now - timedelta(minutes=30))
    events = _match_recent_events(session, ef, since)
    if not events:
        return
    if not _in_active_window(task, now):
        session.add(task)
        session.commit()
        return
    for ev in events:
        try:
            _enqueue_bot_routine(session, task, now, event=ev)
        except Exception:  # noqa: BLE001
            logger.exception("event routine enqueue failed for %s", task.id)
    task.last_run_at = now
    session.add(task)
    session.commit()


def tick() -> None:
    settings = get_settings()
    now = utcnow()
    with Session(engine) as session:
        tasks = list(session.exec(select(ScheduledTask).where(ScheduledTask.enabled == True)))  # noqa: E712
        for task in tasks:
            trigger_type = getattr(task, "trigger_type", "schedule") or "schedule"
            if trigger_type == "event":
                try:
                    _dispatch_event_routine(session, task, now)
                except Exception:  # noqa: BLE001
                    logger.exception("event routine dispatch failed for %s", task.id)
                continue
            try:
                validate_schedule(task.cron_or_interval)
            except ValueError:
                logger.warning("disabling invalid schedule %s", task.id)
                task.enabled = False
                session.add(task)
                session.commit()
                continue
            if not _is_due(task, now):
                continue
            occurrence = _claim_schedule(session, task, now)
            if occurrence is None:
                continue
            logger.info("scheduler enqueue from %s occurrence %s", task.id, occurrence)
            tpl = dict(task.payload_template or {})
            job_type = scheduled_job_type(task.id, tpl.get("type"))
            if "type" not in tpl:
                tpl["type"] = job_type

            if task.id == "mem.dreams.nightly" or tpl.get("agentId") == "mem.dreams":
                from app.routers.memory_ext import propose_dream
                from app.schemas import DreamCreateIn

                options = tpl.get("input") or {}
                project_id = tpl.get("projectId") or tpl.get("project_id") or options.get("projectId") or options.get("project_id")
                if project_id:
                    try:
                        propose_dream(session, DreamCreateIn.model_validate({**options, "projectId": project_id}),
                                      created_by="scheduler")
                    except Exception:
                        session.rollback()
                        logger.exception("Dream proposal failed for %s", task.id)
                else:
                    logger.warning("Dream scan requires a project for %s", task.id)
                    session.commit()
                continue

            # Bot 例程：投到该 Bot 的干净 routine 会话
            bot_id = getattr(task, "bot_id", None) or tpl.get("bot_id")
            if bot_id or job_type == "bot.routine":
                if not _in_active_window(task, now):
                    session.add(task)
                    session.commit()
                    logger.info("bot routine %s skipped (outside active_window)", task.id)
                    continue
                try:
                    _enqueue_bot_routine(session, task, now, schedule_occurrence=occurrence)
                except Exception:  # noqa: BLE001
                    session.rollback()
                    logger.exception("bot routine enqueue failed for %s", task.id)
                    continue
                session.add(task)
                session.commit()
                continue

            if job_type == COLLEAGUE_SCAN:
                n = run_colleague_scan(session, limit=8)
                session.add(task)
                session.commit()
                logger.info("colleague scan wrote %s proposals", n)
                if n > 0:
                    # LLM 重排优先级交给 job-worker（scheduler 不直接调 LLM）
                    pjob = Job(
                        type="gap_scan.prioritize",
                        payload={},
                        user_id=settings.demo_user_id,
                        status="queued",
                    )
                    session.add(pjob)
                    session.commit()
                    session.refresh(pjob)
                    enqueue_job(pjob.id, {"type": pjob.type, "payload": pjob.payload})
                    publish_job_event(pjob.id, {"type": "status", "status": "queued", "jobId": pjob.id})
                    _announce_new_proposals(session)
                continue

            # follow_up：写入总编收件箱，不入通用 Job 队列
            if job_type == "assistant.follow_up":
                from app.agent_inbox import submit_event

                conv_id = tpl.get("conversation_id")
                delivery = tpl.get("delivery") if isinstance(tpl.get("delivery"), dict) else None
                if not conv_id and delivery:
                    conv_id = delivery.get("conversation_id")
                if conv_id:
                    submit_event(
                        session,
                        conversation_id=str(conv_id),
                        source="timer",
                        dedupe_key=f"timer:{task.id}:{occurrence}",
                        payload={"note": tpl.get("note") or task.name, "task_id": task.id},
                    )
                session.add(task)
                session.commit()
                if delivery and delivery.get("channel") == "feishu":
                    try:
                        from app.feishu_notify import announce_text

                        announce_text(
                            session,
                            f"⏰ 跟进闹钟到点：{tpl.get('note') or task.name}",
                            conversation_id=delivery.get("conversation_id"),
                            chat_id=delivery.get("chat_id"),
                        )
                    except Exception:  # noqa: BLE001
                        logger.exception("feishu announce follow_up failed")
                continue

            job = Job(
                type=job_type,
                payload=tpl,
                user_id=settings.demo_user_id,
                status="queued",
                conversation_id=(tpl.get("delivery") or {}).get("conversation_id")
                if isinstance(tpl.get("delivery"), dict)
                else None,
            )
            session.add(job)
            session.add(task)
            session.commit()
            session.refresh(job)
            enqueue_job(job.id, {"type": job.type, "payload": job.payload})
            publish_job_event(job.id, {"type": "status", "status": "queued", "jobId": job.id})
            # 定时提醒类：立即 announce 到飞书（任务已入队）
            delivery = tpl.get("delivery") if isinstance(tpl.get("delivery"), dict) else None
            if delivery and delivery.get("channel") == "feishu":
                try:
                    from app.feishu_notify import announce_text

                    announce_text(
                        session,
                        f"⏰ 定时任务「{task.name}」已触发（{job_type}）。",
                        conversation_id=delivery.get("conversation_id"),
                        chat_id=delivery.get("chat_id"),
                    )
                except Exception:  # noqa: BLE001
                    logger.exception("feishu announce scheduled task failed")


def main() -> None:
    init_db()
    interval = int((__import__("os").environ.get("SCHEDULER_INTERVAL_S") or "60"))
    logger.info("scheduler started interval=%ss", interval)
    while True:
        try:
            tick()
        except Exception:  # noqa: BLE001
            logger.exception("scheduler tick failed")
        time.sleep(interval)


if __name__ == "__main__":
    main()
