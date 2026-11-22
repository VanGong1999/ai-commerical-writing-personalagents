"""Agent Instance 生命周期：租约 / 心跳 / 回收 / pause-resume（Docker 容器式）。

设计要点（见 docs/agents/12-runtime-contract.md §6）：
- 心跳超时 ≠ worker 一定死亡 → 用 **租约 + lease_version fencing**，旧 worker 的写入会被拒绝。
- exec_checkpoint（执行态）与 checkpoint（审批门）是两回事。
- 向后兼容：没有租约的旧 worker 不受影响（reclaim 只处理有 lease_until 的 run）。
- 控制信号（pause/stop）随心跳下发，不依赖 Redis。
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import literal, update
from sqlmodel import Session, select

from .run_steps import next_step_seq
from .models import AgentRun, Job, RunStep, new_id, utcnow
from .queue import publish_task_event, request_cancel

logger = logging.getLogger(__name__)

LEASE_TTL_S = 90
CHECKPOINT_MAX_BYTES = 20_000
_TERMINAL = frozenset({"succeeded", "failed", "cancelled", "dead"})


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def lifecycle_state(run: AgentRun) -> str:
    """统一状态机：created | queued | running | paused | completed | failed | cancelled。"""
    return {
        "pending_deps": "created",
        "queued": "queued",
        "running": "running",
        "paused": "paused",
        "succeeded": "completed",
        "failed": "failed",
        "dead": "failed",
        "cancelled": "cancelled",
    }.get(run.status, run.status)


def _clear_lease(run: AgentRun) -> None:
    run.lease_owner = None
    run.lease_until = None


def _settle_run_jobs(
    session: Session, run_id: str, status: str, *, finished_at: datetime | None = None,
) -> list[str]:
    """Keep duplicate delivery records from remaining runnable after control changes."""
    jobs = list(session.exec(select(Job).where(Job.result_ref == run_id,
                                               Job.status.notin_(_TERMINAL))))
    for job in jobs:
        job.status = status
        if finished_at is not None:
            job.finished_at = finished_at
        session.add(job)
    return [job.id for job in jobs]


def _trim_checkpoint(base: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    merged = {**(base or {}), **(patch or {})}
    raw = json.dumps(merged, ensure_ascii=False, default=str)
    if len(raw) <= CHECKPOINT_MAX_BYTES:
        return merged
    # 过大：只保留标量与最近的 artifactIds
    slim = {k: v for k, v in merged.items() if isinstance(v, (str, int, float, bool)) or v is None}
    ids = merged.get("artifactIds")
    if isinstance(ids, list):
        slim["artifactIds"] = [str(x) for x in ids[-30:]]
    return slim


def acquire(
    session: Session,
    run_id: str,
    owner: str,
    *,
    ttl_s: int = LEASE_TTL_S,
    now: datetime | None = None,
) -> dict[str, Any]:
    now = now or utcnow()
    run = session.get(AgentRun, run_id)
    if not run:
        return {"ok": False, "reason": "not_found"}
    if run.status in _TERMINAL:
        _settle_run_jobs(session, run_id, run.status)
        session.commit()
        return {"ok": False, "reason": "terminal", "status": run.status}
    if run.status == "paused":
        _settle_run_jobs(session, run_id, "paused")
        session.commit()
        return {"ok": False, "reason": "paused"}
    if run.control_signal == "pause":
        return {"ok": False, "reason": "paused"}
    if run.control_signal == "stop":
        _settle_run_jobs(session, run_id, "cancelled")
        session.commit()
        return {"ok": False, "reason": "stopped"}
    until = _aware(run.lease_until)
    held_by_other = bool(run.lease_owner and run.lease_owner != owner and until and until > now)
    if held_by_other:
        return {"ok": False, "reason": "leased", "leaseOwner": run.lease_owner}

    same_owner_live = run.lease_owner == owner and until and until > now
    ckpt = dict(run.exec_checkpoint or {})
    # 操作员 pause→resume 不消耗 crash retry 额度（避免误触 dead）
    operator_resume = bool(ckpt.pop("_operatorResume", False))
    changes: dict[str, Any] = {
        "lease_owner": owner,
        "lease_until": now + timedelta(seconds=max(10, int(ttl_s))),
        "heartbeat_at": now,
        "status": "running",
    }
    if not same_owner_live:
        changes["lease_version"] = int(run.lease_version or 0) + 1
        if operator_resume:
            changes["exec_checkpoint"] = ckpt
        else:
            changes["attempt"] = int(run.attempt or 0) + 1
    # Claim the exact state we inspected. Two workers can both read an expired
    # lease before either commits; only one may replace it. Status/control
    # predicates also prevent an intervening pause/stop from being overwritten.
    result = session.execute(
        update(AgentRun).where(
            AgentRun.id == run_id,
            AgentRun.lease_version == run.lease_version,
            AgentRun.lease_owner == run.lease_owner,
            AgentRun.lease_until == run.lease_until,
            AgentRun.status == run.status,
            AgentRun.control_signal == run.control_signal,
        ).values(**changes).execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        session.rollback()
        return {"ok": False, "reason": "conflict"}
    session.commit()
    session.refresh(run)
    ckpt = dict(run.exec_checkpoint or {})
    return {
        "ok": True,
        "leaseVersion": run.lease_version,
        "leaseUntil": run.lease_until.isoformat() if run.lease_until else None,
        "attempt": run.attempt,
        "maxAttempts": run.max_attempts,
        "checkpoint": {k: v for k, v in ckpt.items() if not str(k).startswith("_")},
        "resume": bool(ckpt.get("turn")),
    }


def heartbeat(
    session: Session,
    run_id: str,
    owner: str,
    lease_version: int,
    *,
    ttl_s: int = LEASE_TTL_S,
    checkpoint: dict[str, Any] | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    now = now or utcnow()
    run = session.get(AgentRun, run_id)
    if not run:
        return {"ok": False, "reason": "not_found"}
    if run.status in _TERMINAL:
        return {"ok": False, "reason": "terminal", "status": run.status}
    if run.lease_owner != owner or int(run.lease_version or 0) != int(lease_version):
        return {"ok": False, "reason": "lease_lost"}
    run.lease_until = now + timedelta(seconds=max(10, int(ttl_s)))
    run.heartbeat_at = now
    if checkpoint:
        run.exec_checkpoint = _trim_checkpoint(run.exec_checkpoint or {}, checkpoint)
        pct = checkpoint.get("progressPct")
        if isinstance(pct, (int, float)):
            run.progress_pct = max(int(run.progress_pct or 0), min(99, int(pct)))
    session.add(run)
    session.commit()
    return {
        "ok": True,
        "action": run.control_signal or "continue",
        "leaseUntil": run.lease_until.isoformat(),
    }


def release(
    session: Session,
    run_id: str,
    owner: str,
    lease_version: int,
    *,
    state: str | None = None,
    checkpoint: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """worker 主动释放租约。state=paused → 进入 paused（保留 checkpoint，可 resume）。"""
    run = session.get(AgentRun, run_id)
    if not run:
        return {"ok": False, "reason": "not_found"}
    if run.lease_owner != owner or int(run.lease_version or 0) != int(lease_version):
        return {"ok": False, "reason": "lease_lost"}
    if checkpoint:
        run.exec_checkpoint = _trim_checkpoint(run.exec_checkpoint or {}, checkpoint)
    _clear_lease(run)
    if state == "paused" and run.status not in _TERMINAL:
        run.status = "paused"
        run.control_signal = None
        run.progress_stage = "已暂停"
        _settle_run_jobs(session, run.id, "paused")
    session.add(run)
    session.commit()
    if state == "paused":
        publish_task_event(
            {
                "type": "run_paused",
                "runId": run.id,
                "taskGroupId": run.task_group_id,
                "agentId": run.agent_id,
                "conversationId": run.conversation_id,
            }
        )
    return {"ok": True, "status": run.status}


def pause(session: Session, run_id: str) -> dict[str, Any]:
    run = session.get(AgentRun, run_id)
    if not run:
        return {"ok": False, "reason": "not_found"}
    if run.status in _TERMINAL:
        return {"ok": False, "reason": "terminal", "status": run.status}
    if run.status == "paused":
        _settle_run_jobs(session, run.id, "paused")
        session.commit()
        return {"ok": True, "mode": "noop", "status": "paused"}
    if run.status == "running" and run.lease_owner:
        # worker 在下一次心跳读到 pause → checkpoint → release(paused)
        run.control_signal = "pause"
        run.progress_stage = "暂停中…"
        session.add(run)
        session.commit()
        return {"ok": True, "mode": "signal", "status": run.status}
    run.status = "paused"
    run.control_signal = None
    run.progress_stage = "已暂停"
    session.add(run)
    _settle_run_jobs(session, run.id, "paused")
    session.commit()
    publish_task_event(
        {
            "type": "run_paused",
            "runId": run.id,
            "taskGroupId": run.task_group_id,
            "agentId": run.agent_id,
            "conversationId": run.conversation_id,
        }
    )
    return {"ok": True, "mode": "immediate", "status": "paused"}


def resume(session: Session, run_id: str) -> dict[str, Any]:
    run = session.get(AgentRun, run_id)
    if not run:
        return {"ok": False, "reason": "not_found"}
    from .knowledge_colleague import run_role, selected_job
    job = selected_job(session, run)
    if job:
        run_role(session, run.id, job.id, job.user_id, initialize=True)
    if run.control_signal == "pause" and run.status == "running":
        run.control_signal = None  # 暂停尚未生效 → 撤销信号
        session.add(run)
        session.commit()
        return {"ok": True, "mode": "cancel_pause", "status": run.status}
    if run.status != "paused":
        return {"ok": False, "reason": "not_paused", "status": run.status}
    from .task_daemon import _enqueue_run

    # Commit the paused claim, the retry-budget marker and the runnable job together.
    claimed = session.execute(
        update(AgentRun).where(
            AgentRun.id == run.id, AgentRun.status == "paused",
            AgentRun.lease_version == run.lease_version,
            AgentRun.operator_resumed_at_s.is_not_distinct_from(literal(run.operator_resumed_at_s)),
        ).values(
            control_signal=None, operator_resumed_at_s=utcnow().timestamp(),
            exec_checkpoint={**(run.exec_checkpoint or {}), "_operatorResume": True},
        ).execution_options(synchronize_session=False)
    )
    if claimed.rowcount != 1:
        session.rollback()
        return {"ok": False, "reason": "conflict"}
    try:
        if not _enqueue_run(session, run):
            session.rollback()
            return {"ok": False, "reason": "no_live_job", "status": run.status}
    except Exception:
        session.rollback()
        raise
    session.refresh(run)
    return {"ok": True, "mode": "requeued", "status": run.status}


def stop(session: Session, run_id: str) -> dict[str, Any]:
    """停止（≈ docker stop）：终态 cancelled；保留 checkpoint 供审计。"""
    run = session.get(AgentRun, run_id)
    if not run:
        return {"ok": False, "reason": "not_found"}
    if run.status in _TERMINAL:
        return {"ok": False, "reason": "terminal", "status": run.status}
    finished_at = utcnow()
    claimed = session.execute(
        update(AgentRun).where(
            AgentRun.id == run_id, AgentRun.status == run.status,
            AgentRun.lease_version == run.lease_version,
        ).values(
            status="cancelled", control_signal=None, finished_at=finished_at,
            progress_stage="已停止", lease_owner=None, lease_until=None,
        ).execution_options(synchronize_session=False)
    )
    if claimed.rowcount != 1:
        session.rollback()
        current = session.get(AgentRun, run_id)
        if current is None:
            return {"ok": False, "reason": "not_found"}
        reason = "terminal" if current.status in _TERMINAL else "conflict"
        return {"ok": False, "reason": reason, "status": current.status}
    try:
        session.refresh(run)
        job_ids = _settle_run_jobs(session, run_id, "cancelled", finished_at=finished_at)
        if run.conversation_id:
            from .thread_router import deliver_completion

            session.flush()
            deliver_completion(session, run, "cancelled")
        session.commit()
    except Exception:
        session.rollback()
        raise
    for job_id in job_ids:
        request_cancel(job_id)
    if run.task_group_id:
        from .models import AsyncTaskGroup
        from .task_daemon import refresh_group_status

        group = session.get(AsyncTaskGroup, run.task_group_id)
        if group:
            refresh_group_status(session, group)
    publish_task_event(
        {
            "type": "run_cancelled",
            "runId": run.id,
            "taskGroupId": run.task_group_id,
            "conversationId": run.conversation_id,
        }
    )
    return {"ok": True, "status": "cancelled"}


def _note(session: Session, run: AgentRun, payload: dict[str, Any]) -> None:
    if not run.conversation_id:
        return
    session.add(
        RunStep(
            id=new_id(),
            conversation_id=run.conversation_id,
            run_id=run.id,
            seq=next_step_seq(session, run.conversation_id),
            actor="system",
            kind="watchdog",
            payload=payload,
        )
    )


def reclaim_expired(session: Session, *, now: datetime | None = None, announce: bool = True) -> dict[str, Any]:
    """回收租约已过期的 running run：有重试额度 → 带 checkpoint 重新入队；否则 dead。"""
    now = now or utcnow()
    rows = [
        r
        for r in session.exec(select(AgentRun).where(AgentRun.status == "running"))
        if r.lease_until is not None and _aware(r.lease_until) < now
    ]
    requeued = 0
    dead = 0
    for run in rows:
        prev_owner = run.lease_owner
        _clear_lease(run)  # lease_version 保留：旧 worker 复活后写入会被 fencing 拒绝
        ckpt = dict(run.exec_checkpoint or {})
        if int(run.attempt or 0) >= int(run.max_attempts or 3):
            run.status = "dead"
            run.finished_at = now
            run.progress_stage = f"租约过期且重试耗尽（{run.attempt}/{run.max_attempts}）"
            session.add(run)
            _settle_run_jobs(session, run.id, "dead")
            _note(session, run, {"reason": "lease_dead", "runId": run.id, "owner": prev_owner})
            session.commit()
            dead += 1
            event_type = "run_dead"
        else:
            run.progress_stage = f"租约过期，已回收重试（{run.attempt}/{run.max_attempts}）"
            session.add(run)
            _note(
                session,
                run,
                {
                    "reason": "lease_reclaimed",
                    "runId": run.id,
                    "owner": prev_owner,
                    "resumeFromTurn": ckpt.get("turn"),
                },
            )
            session.commit()
            from .task_daemon import _enqueue_run

            _enqueue_run(session, run)
            requeued += 1
            event_type = "run_reclaimed"
        publish_task_event(
            {
                "type": event_type,
                "runId": run.id,
                "taskGroupId": run.task_group_id,
                "agentId": run.agent_id,
                "attempt": run.attempt,
                "conversationId": run.conversation_id,
            }
        )
        if announce and run.conversation_id:
            try:
                from .feishu_notify import announce_text

                verb = "已判定失败（重试耗尽）" if event_type == "run_dead" else "已自动回收并从检查点恢复"
                announce_text(
                    session,
                    f"⚠️ Agent 实例 {run.agent_id} 心跳丢失，{verb}（尝试 {run.attempt}/{run.max_attempts}）",
                    conversation_id=run.conversation_id,
                )
            except Exception:  # noqa: BLE001
                logger.exception("lease reclaim announce failed")
    return {"requeued": requeued, "dead": dead}


def _attention(run: AgentRun, expires_in_s: int | None) -> str | None:
    """需要运维关注的信号（eggbot / UI 巡检用）。"""
    if run.status == "running" and expires_in_s is not None and expires_in_s < 0:
        return "lease_expired"
    if run.status == "running" and expires_in_s is not None and expires_in_s < 20:
        return "lease_expiring"
    if (run.attempt or 0) > 1 and run.status in {"queued", "running"}:
        return "retrying"
    if run.status == "dead":
        return "dead"
    return None


def instance_metrics(session: Session) -> dict[str, Any]:
    """控制平面指标：各状态实例数、重试/死亡、token 概览（供 UI/巡检，≈ docker stats 的最小集）。"""
    rows = list(session.exec(select(AgentRun)))
    by_state: dict[str, int] = {}
    retried = dead = 0
    tok_p = tok_c = 0
    expiring = 0
    for r in rows:
        st = lifecycle_state(r)
        by_state[st] = by_state.get(st, 0) + 1
        if (r.attempt or 0) > 1:
            retried += 1
        if r.status == "dead":
            dead += 1
        tok_p += r.token_prompt or 0
        tok_c += r.token_completion or 0
        until = _aware(r.lease_until)
        if r.status == "running" and until and (until - utcnow()).total_seconds() < 20:
            expiring += 1
    return {
        "total": len(rows),
        "byState": by_state,
        "retried": retried,
        "dead": dead,
        "leaseExpiring": expiring,
        "tokenPrompt": tok_p,
        "tokenCompletion": tok_c,
    }


def instance_view(session: Session, run: AgentRun, *, now: datetime | None = None) -> dict[str, Any]:
    now = now or utcnow()
    until = _aware(run.lease_until)
    ckpt = dict(run.exec_checkpoint or {})
    job = session.exec(select(Job).where(Job.result_ref == run.id)).first()
    expires = int((until - now).total_seconds()) if until else None
    attention = _attention(run, expires)
    return {
        "attention": attention,
        "runId": run.id,
        "agentId": run.agent_id,
        "label": run.label or run.agent_id,
        "projectId": run.project_id,
        "taskGroupId": run.task_group_id,
        "conversationId": run.conversation_id,
        "state": lifecycle_state(run),
        "status": run.status,
        "progressPct": run.progress_pct or 0,
        "progressStage": run.progress_stage,
        "attempt": run.attempt or 0,
        "maxAttempts": run.max_attempts or 3,
        "controlSignal": run.control_signal,
        "lease": {
            "owner": run.lease_owner,
            "version": run.lease_version or 0,
            "expiresInS": expires,
            "heartbeatAt": run.heartbeat_at.isoformat() if run.heartbeat_at else None,
        },
        "checkpoint": {
            "turn": ckpt.get("turn"),
            "stage": ckpt.get("stage"),
            "lastTool": ckpt.get("lastTool"),
            "artifactCount": len(ckpt.get("artifactIds") or []) or ckpt.get("artifactCount"),
            "compactions": ckpt.get("compactions"),
            "handoffs": ckpt.get("handoffs"),
        },
        "tokenPrompt": run.token_prompt or 0,
        "tokenCompletion": run.token_completion or 0,
        "createdAt": run.created_at.isoformat() if run.created_at else None,
        "finishedAt": run.finished_at.isoformat() if run.finished_at else None,
        "jobId": job.id if job else None,
    }


def list_instances(
    session: Session,
    *,
    state: str | None = None,
    project_id: str | None = None,
    include_finished: bool = False,
    limit: int = 60,
) -> list[dict[str, Any]]:
    rows = list(session.exec(select(AgentRun).order_by(AgentRun.created_at.desc())))
    out = []
    for r in rows:
        if project_id and r.project_id != project_id:
            continue
        v = lifecycle_state(r)
        if state and v != state:
            continue
        if not state and not include_finished and v in {"completed", "failed", "cancelled"}:
            continue
        out.append(instance_view(session, r))
        if len(out) >= limit:
            break
    return out


def inspect_instance(session: Session, run_id: str, *, steps: int = 30) -> dict[str, Any] | None:
    run = session.get(AgentRun, run_id)
    if not run:
        return None
    from .run_steps import overview_payload
    view = instance_view(session, run)
    rows = list(
        session.exec(
            select(RunStep).where(RunStep.run_id == run_id, RunStep.kind != "thinking").order_by(RunStep.created_at.desc()).limit(steps)
        )
    )
    view["recentSteps"] = [
        {
            "kind": s.kind,
            "actor": s.actor,
            "payload": overview_payload(s),
            "createdAt": s.created_at.isoformat() if s.created_at else None,
        }
        for s in reversed(rows)
    ]
    view["checkpointFull"] = dict(run.exec_checkpoint or {})
    return view
