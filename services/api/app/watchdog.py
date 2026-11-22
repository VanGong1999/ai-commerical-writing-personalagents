"""Control Loop：卡住 run / 无进展 / 超时 processing / 订阅未释放。"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, literal, update
from sqlmodel import Session, select

from .agent_inbox import reap_stale
from .run_steps import next_step_seq
from .models import AgentRun, Job, RunStep, ThreadSubscription, new_id, utcnow

logger = logging.getLogger(__name__)


def _aware(dt):
    if dt is None:
        return None
    if dt.tzinfo is None:
        from datetime import timezone as _tz

        return dt.replace(tzinfo=_tz.utc)
    return dt


def _append_watchdog_step(
    session: Session,
    conversation_id: str | None,
    payload: dict[str, Any],
    *,
    run_id: str | None = None,
) -> None:
    if not conversation_id:
        return
    session.add(
        RunStep(
            id=new_id(),
            conversation_id=conversation_id,
            run_id=run_id,
            seq=next_step_seq(session, conversation_id),
            actor="system",
            kind="watchdog",
            payload=payload,
        )
    )


def scan(
    session: Session,
    *,
    stuck_minutes: int = 15,
    processing_timeout_minutes: int = 5,
    no_progress_minutes: int = 10,
    zombie_minutes: int = 30,
    announce: bool = True,
) -> dict[str, Any]:
    """扫描异常并写 RunStep；可选飞书告警。返回计数。"""
    alerts: list[dict[str, Any]] = []
    minutes = max(5, int(stuck_minutes or 15))
    stuck_age = timedelta(minutes=minutes)
    zombie_age = timedelta(minutes=max(5, int(zombie_minutes or 30)))
    progress_age = timedelta(minutes=max(3, no_progress_minutes))
    zombie_failed = 0

    # 1) 超时 processing
    stale = reap_stale(session, timeout_minutes=processing_timeout_minutes)
    for ev in stale:
        alerts.append(
            {
                "type": "stale_processing",
                "eventId": ev.id,
                "conversationId": ev.conversation_id,
            }
        )

    # 2) 卡住的 AgentRun
    rows = list(session.exec(select(AgentRun).order_by(AgentRun.conversation_id, AgentRun.id)).all())
    active = [r for r in rows if r.status in {"queued", "running"}]
    for run in active:
        now = utcnow()
        lease_until = _aware(run.lease_until)
        if lease_until and lease_until > now:
            continue
        started = _aware(run.created_at)
        # After a clock rollback, only observations at or before the current
        # clock can establish recent activity. With no such evidence, inspect
        # the run immediately, including its persisted execution steps below.
        activity = started if started and started <= now else datetime.min.replace(tzinfo=now.tzinfo)
        resumed = run.operator_resumed_at_s
        if isinstance(resumed, (int, float)) and activity.timestamp() < resumed <= now.timestamp():
            activity = datetime.fromtimestamp(resumed, tz=now.tzinfo)
        heartbeat = _aware(run.heartbeat_at)
        if heartbeat and activity < heartbeat <= now:
            activity = heartbeat
        if now - activity < stuck_age:
            continue
        # Fence a stale scan against an operator transition or worker claim before
        # inspecting progress and publishing a warning or changing a zombie's state.
        guard = session.execute(update(AgentRun).where(
            AgentRun.id == run.id, AgentRun.status == run.status,
            AgentRun.lease_version == run.lease_version, AgentRun.lease_until == run.lease_until,
            AgentRun.heartbeat_at == run.heartbeat_at,
            AgentRun.operator_resumed_at_s.is_not_distinct_from(literal(resumed)),
        ).values(status=run.status).execution_options(synchronize_session=False))
        if guard.rowcount != 1:
            continue
        now = utcnow()
        last_step_at = session.exec(select(func.max(RunStep.created_at)).where(
            RunStep.run_id == run.id, RunStep.actor != "system", RunStep.kind != "watchdog",
            RunStep.created_at <= now,
        )).one()
        if last_step_at:
            activity = max(activity, _aware(last_step_at))
        if now - activity < stuck_age:
            continue
        # 僵尸清理：从未建立租约（worker 崩溃窗口）且超 zombie 阈值的 running。
        # 有 exec_checkpoint 且未耗尽重试 → 对齐 reclaim_expired：带检查点重入队；
        # 否则判 failed，避免永久占用并阻塞同项目正文互斥（_project_prose_busy）。
        if lease_until is None and run.status == "running" and now - activity > zombie_age:
            ckpt = dict(run.exec_checkpoint or {})
            has_ckpt = bool(ckpt.get("turn") or ckpt.get("artifactIds") or ckpt.get("lastTool"))
            attempts = int(run.attempt or 0)
            max_attempts = int(run.max_attempts or 3)
            job = session.exec(select(Job).where(Job.result_ref == run.id)).first()
            if has_ckpt and attempts < max_attempts:
                run.status = "queued"
                run.progress_stage = (
                    f"看门狗：无租约僵尸，已按检查点重入队（{attempts}/{max_attempts}）"
                )
                run.finished_at = None
                session.add(run)
                if job and job.status not in {"succeeded", "failed", "cancelled", "dead"}:
                    job.status = "queued"
                    job.error = "watchdog: zombie requeued with checkpoint"
                    session.add(job)
                try:
                    from .task_daemon import _enqueue_run

                    _enqueue_run(session, run)
                except Exception:  # noqa: BLE001
                    logger.exception("watchdog requeue failed for %s", run.id)
                zombie_failed += 1
                alerts.append(
                    {
                        "type": "zombie_run_requeued",
                        "runId": run.id,
                        "agentId": run.agent_id,
                        "summary": (
                            f"AgentRun {run.agent_id} 无租约心跳超 {zombie_minutes} 分钟，"
                            f"已按检查点重入队（turn={ckpt.get('turn')}）"
                        ),
                    }
                )
            else:
                run.status = "failed"
                run.finished_at = utcnow()
                run.progress_stage = "看门狗判定：无租约心跳的僵尸运行，已判失败（可重试）"
                session.add(run)
                if job and job.status not in {"succeeded", "failed", "cancelled", "dead"}:
                    job.status = "failed"
                    job.error = "watchdog: zombie run without lease heartbeat"
                    session.add(job)
                zombie_failed += 1
                alerts.append(
                    {
                        "type": "zombie_run_failed",
                        "runId": run.id,
                        "agentId": run.agent_id,
                        "summary": f"AgentRun {run.agent_id} 无租约心跳超 {zombie_minutes} 分钟，已判失败",
                    }
                )
            continue
        gates = list(run.gate_results or [])
        if any(g.get("type") == "feishu_watchdog" for g in gates if isinstance(g, dict)):
            continue
        # API 内 inbox_pump 与飞书 handler 各自跑 scan，靠已有 RunStep 防重复告警
        already = session.exec(
            select(RunStep.id).where(RunStep.run_id == run.id, RunStep.kind == "watchdog",
                                     RunStep.payload["reason"].as_string() == "stuck_run").limit(1)
        ).first()
        if already:
            continue
        no_progress = now - activity > progress_age
        summary = f"AgentRun {run.agent_id} 已卡住超过 {minutes} 分钟（status={run.status}）"
        if no_progress:
            summary += "，且长时间无新步骤"
        payload = {
            "reason": "stuck_run",
            "runId": run.id,
            "agentId": run.agent_id,
            "status": run.status,
            "noProgress": no_progress,
            "minutes": minutes,
        }
        gates.append({"type": "feishu_watchdog", "at": utcnow().isoformat(), "summary": summary})
        run.gate_results = gates
        session.add(run)
        _append_watchdog_step(session, run.conversation_id, payload, run_id=run.id)
        alerts.append({"type": "stuck_run", "runId": run.id, "summary": summary, "conversationId": run.conversation_id})
        if announce and run.conversation_id:
            try:
                from .feishu_notify import announce_text

                announce_text(session, f"⚠️ Watchdog：{summary}", conversation_id=run.conversation_id)
            except Exception:  # noqa: BLE001
                logger.exception("watchdog announce failed")

    alerts.extend(reconcile_subscriptions(session, route_fresh_since=utcnow() - timedelta(minutes=5)))

    session.commit()
    return {
        "staleEvents": len(stale),
        "alerts": alerts,
        "alertCount": len(alerts),
        "zombieFailed": zombie_failed,
    }

def reconcile_subscriptions(session: Session, *, route_fresh_since: datetime | None = None) -> list[dict[str, Any]]:
    """Repair terminal subscriptions without touching leases or sending external notifications."""
    from .thread_router import deliver_completion

    alerts = []
    candidates = session.exec(select(ThreadSubscription, AgentRun).join(
        AgentRun, AgentRun.id == ThreadSubscription.run_id
    ).where(ThreadSubscription.status == "active",
            AgentRun.status.in_(["succeeded", "failed", "cancelled", "dead"]))
        .order_by(ThreadSubscription.conversation_id, AgentRun.id, ThreadSubscription.id)).all()
    for sub, run in candidates:
        if sub.conversation_id == run.conversation_id:
            finished = _aware(run.finished_at)
            fresh = bool(finished and route_fresh_since and finished >= route_fresh_since)
            deliver_completion(session, run, run.status, legacy_sub_id=sub.id,
                               observed_sub_update=sub.updated_at, passive=not fresh)
            continue
        # Different conversation bindings require operator review before routing.
        guard = update(ThreadSubscription).where(
            ThreadSubscription.id == sub.id, ThreadSubscription.run_id == run.id,
            ThreadSubscription.status == "active", ThreadSubscription.updated_at == sub.updated_at,
            select(AgentRun.id).where(AgentRun.id == run.id, AgentRun.status == run.status,
                                      AgentRun.conversation_id == run.conversation_id).exists(),
        ).values(status="active").execution_options(synchronize_session=False)
        if not session.execute(guard).rowcount:
            continue
        previous = session.exec(select(RunStep.id).where(
            RunStep.conversation_id == sub.conversation_id, RunStep.run_id == run.id,
            RunStep.kind == "watchdog", RunStep.payload["reason"].as_string() == "subscription_unreleased",
            RunStep.payload["subId"].as_string() == sub.id,
        ).limit(1)).first()
        if not previous:
            payload = dict(reason="subscription_unreleased", runId=run.id, subId=sub.id,
                           threadKey=sub.thread_key, runStatus=run.status, cause="conversation_mismatch")
            _append_watchdog_step(session, sub.conversation_id, payload, run_id=run.id)
            alerts.append(payload)
    return alerts
