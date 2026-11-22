"""用户级守护任务 API：任务组、审批、进度流。"""

from __future__ import annotations

import asyncio
import hashlib
import json
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import or_, update
from sqlmodel import Session, select

from ..db import get_session
from ..models import (ActivityLog, AgentEvent, AgentRun, Artifact, ArtifactVersion, AsyncTaskGroup, Conversation,
                      Job, MemoryFile, MemoryVersion, Message, OntoActionRun, Project, RunDigest,
                      RunStep, ThreadSubscription, UsageEvent, utcnow)
from ..queue import (
    iter_memory_task_events_since,
    publish_task_event,
    request_cancel,
    request_interrupt,
)
from ..seed import DEMO_USER
from ..thread_router import project_thread_key, upsert_subscription
from .. import run_lease as lease
from .. import task_daemon as daemon
from ..agent_inbox import steer_mailbox, submit_event

router = APIRouter(prefix="/tasks", tags=["tasks"])


class CreateGroupIn(BaseModel):
    title: str | None = None
    goal: str = ""
    kind: Literal["multi_book", "multi_chapter", "multi_agent"] = "multi_agent"
    approval_mode: Literal["auto_pilot", "checkpoint_gate"] = Field(
        default="auto_pilot", alias="approvalMode"
    )
    max_concurrency: int = Field(default=4, alias="maxConcurrency")
    conversation_id: str | None = Field(default=None, alias="conversationId")
    tasks: list[dict[str, Any]] = Field(default_factory=list)

    model_config = {"populate_by_name": True}


class PatchGroupIn(BaseModel):
    approval_mode: Literal["auto_pilot", "checkpoint_gate"] | None = Field(
        default=None, alias="approvalMode"
    )
    status: Literal["paused", "running"] | None = None
    max_concurrency: int | None = Field(default=None, alias="maxConcurrency")

    model_config = {"populate_by_name": True}


class ApproveRunIn(BaseModel):
    approve: bool = True
    note: str | None = None


class UpdateRunIn(BaseModel):
    message: str
    update_strategy: Literal["interrupt", "enqueue"] = Field(
        default="enqueue", alias="updateStrategy"
    )

    model_config = {"populate_by_name": True}


class ProgressIn(BaseModel):
    progress_pct: int | None = Field(default=None, alias="progressPct")
    progress_stage: str | None = Field(default=None, alias="progressStage")
    status: str | None = None

    model_config = {"populate_by_name": True}


@router.get("/groups")
def list_groups(
    conversation_id: str | None = Query(None, alias="conversationId"),
    limit: int = Query(40),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    groups = daemon.list_task_groups(
        session, user_id=DEMO_USER, conversation_id=conversation_id, limit=limit
    )
    active_runs = sum(1 for g in groups for r in g.get("runs") or [] if r.get("status") in {"queued", "running"})
    waiting = sum(1 for g in groups for r in g.get("runs") or [] if r.get("approvalState") == "waiting")
    return {
        "groups": groups,
        "summary": {
            "groups": len(groups),
            "running": active_runs,
            "waitingApproval": waiting,
            "slots": 4,
        },
    }


@router.post("/groups")
def create_group(
    body: CreateGroupIn,
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    if not body.tasks:
        raise HTTPException(400, "tasks required")
    result = daemon.create_task_group(
        session,
        user_id=DEMO_USER,
        conversation_id=body.conversation_id,
        title=body.title or (body.goal[:40] if body.goal else "后台任务组"),
        goal=body.goal,
        kind=body.kind,
        approval_mode=body.approval_mode,
        max_concurrency=body.max_concurrency,
        tasks=body.tasks,
    )
    group = session.get(AsyncTaskGroup, result["task_group_id"])
    return {
        **result,
        "group": daemon.serialize_group(session, group) if group else None,
    }


@router.get("/groups/{group_id}")
def get_group(group_id: str, session: Session = Depends(get_session)) -> dict[str, Any]:
    group = session.get(AsyncTaskGroup, group_id)
    if not group or group.user_id != DEMO_USER:
        raise HTTPException(404, "task group not found")
    return daemon.serialize_group(session, group)


def _check_batch_delivery(session, project, group, run):
    from ..pipeline_checkpoint import PipelinePause, _read_receipt

    jobs = session.exec(select(Job).where(Job.result_ref == run.id)).all()
    if len(jobs) != 1:
        raise HTTPException(409, "批次缺少唯一的交付作业")
    job = jobs[0]
    if (job.type != "agent.run" or job.user_id != group.user_id or job.conversation_id != run.conversation_id
            or job.task_group_id != run.task_group_id or job.payload.get("runId") != run.id
            or job.payload.get("agentId") != run.agent_id):
        raise HTTPException(409, "交付作业不属于原派单")
    try:
        delivery, wait = _read_receipt(session, project, run, job)
    except PipelinePause as exc:
        raise HTTPException(409, str(exc)) from exc
    if wait or not delivery:
        raise HTTPException(409, "批次交付收据待核查")
    if run.task_group_id == group.id:
        current = {a.id: a.version for a in session.exec(select(Artifact).where(
            Artifact.created_by_run_id == run.id, Artifact.project_id == project.id,
            Artifact.type == daemon._body_type_for(project.format)))}
        delivered = {ref["id"]: ref["version"] for ref in delivery["artifacts"]}
        if not current or current != delivered:
            raise HTTPException(409, "已完成正文与交付版本不符")
    return job.id


def _earliest_qa_notification(run, key, steps, subs):
    steps = sorted(steps, key=lambda row: row.seq)
    subs = sorted(subs, key=lambda row: row.created_at)
    if len(steps) != len(subs):
        raise HTTPException(409, "QA 唤醒订阅与关闭回执不完整")
    for previous, sub, closure in zip(subs, subs[1:], steps[1:]):
        if (previous.updated_at > sub.created_at or sub.status != "completed"
                or sub.created_at > closure.created_at or closure.kind != "subscription_closed"
                or closure.actor != "system" or closure.turn_id is not None
                or closure.conversation_id != run.conversation_id or closure.payload != {
                    "completionReceipt": f"{key}:lease:0", "closedSubscriptionIds": [sub.id]}):
            raise HTTPException(409, "QA 唤醒订阅的关闭记录不符")
    return steps[:1], subs[:1]


def _check_recovery_notifications(session, run, qa_only=False):
    # A pre-enqueue rejection can still have delivered its terminal notification.
    # Admit only the settled lease-zero receipt and its matching closed wake route.
    key = f"job_done:{run.id}:{run.status}"
    steps = session.exec(select(RunStep).where(RunStep.run_id == run.id)).all()
    events = session.exec(select(AgentEvent).where(or_(
        AgentEvent.payload["run_id"].as_string() == run.id, AgentEvent.payload["runId"].as_string() == run.id,
        AgentEvent.dedupe_key.startswith(f"job_done:{run.id}:"),
    ))).all()
    subs = session.exec(select(ThreadSubscription).where(ThreadSubscription.run_id == run.id)).all()
    if (not qa_only and len(subs) > 1) or any(
        sub.conversation_id != run.conversation_id or sub.project_id != run.project_id or sub.agent_id != run.agent_id
        or sub.thread_key != project_thread_key(run.project_id) or sub.mode != "wake" for sub in subs
    ):
        raise HTTPException(409, "原任务的会话订阅已变化")
    if not steps and not events and len(subs) <= 1 and all(sub.status == "active" for sub in subs):
        return
    if qa_only and len(subs) > 1:
        steps, subs = _earliest_qa_notification(run, key, steps, subs)
    if len(steps) != 1 or len(events) != 1 or len(subs) != 1 or subs[0].status != "completed":
        raise HTTPException(409, "原任务有未核实的执行或通知记录")
    step, event = steps[0], events[0]
    if (step.id != f"{key}:lease:0" or step.kind != "agent_status" or step.actor != f"agent:{run.agent_id}"
            or step.conversation_id != run.conversation_id or step.turn_id is not None or step.payload != {
                "status": run.status, "summary": f"{run.agent_id}（产物 0 个）", "passiveRepair": False,
                "missingCompletion": False, "intendedRoute": "wake_chief", "closedSubscriptionIds": [subs[0].id],
                "artifactCount": 0, "artifactIds": [], "projectId": run.project_id}):
        raise HTTPException(409, "原任务已有执行步骤或非标准的终态回执")
    payload = dict(event.payload or {})
    title = payload.pop("project_title", None)  # Display text can outlive a project rename.
    if (event.source != "job_done" or event.dedupe_key != key or event.status != "done" or not event.processed_at
            or event.target_bot_id is not None
            or event.conversation_id != run.conversation_id or not isinstance(title, str) or payload != {
                "run_id": run.id, "agent_id": run.agent_id, "status": run.status, "project_id": run.project_id,
                "artifact_count": 0, "artifact_ids": []}):
        raise HTTPException(409, "终态通知仍在处理或不属于原任务")


def _check_unstarted_suffix(session, suffix, qa_only=False):
    ids = [run.id for run in suffix]
    for index, run in enumerate(suffix):
        expected = (("failed", daemon._BATCH_RELEASE_FAILED) if index == 0 and not qa_only else
                    ("cancelled", daemon._BATCH_DEPENDENCY_CANCELLED))
        if ((run.status, run.progress_stage) != expected or not run.finished_at or run.approval_state != "none"
                or (qa_only and run.checkpoint)
                or any((run.attempt, run.lease_version, run.lease_owner, run.lease_until, run.heartbeat_at,
                        run.operator_resumed_at_s, run.control_signal, run.exec_checkpoint, run.progress_pct,
                        run.token_prompt, run.token_completion, run.output_artifact_ids, run.gate_results, run.receipt_id))):
            raise HTTPException(409, "仅可恢复入队前被版本校验或其依赖阻断的任务")
        _check_recovery_notifications(session, run, qa_only)
    # Job delivery, child writes and steering are separate from terminal notifications.
    checks = (
        Job.result_ref, Job.payload["runId"].as_string(), UsageEvent.run_id,
        Artifact.created_by_run_id, AgentRun.parent_run_id, Message.run_id, RunDigest.run_id,
        MemoryFile.source_run_id, MemoryVersion.source_run_id, OntoActionRun.parameters["createdByRunId"].as_string(),
    )
    if any(session.exec(select(field).where(field.in_(ids)).limit(1)).first() is not None for field in checks):
        raise HTTPException(409, "未完成的任务已有执行或写入记录")
    actors = [f"agent:{rid}" for rid in ids]
    if session.exec(select(ArtifactVersion.id).where(ArtifactVersion.actor.in_(actors)).limit(1)).first():
        raise HTTPException(409, "未完成的任务已有产物修订记录")
    if session.exec(select(AgentEvent.id).where(AgentEvent.conversation_id.in_(
            [steer_mailbox(rid) for rid in ids])).limit(1)).first():
        raise HTTPException(409, "未完成的任务已有收件箱事件")


def _ordinary_steer_input(original, run_id, revision, events, *, allowed_statuses=("done",)):
    remaining = {event.id: event for event in events}
    messages = []
    while revision is not None:
        if not isinstance(revision, str):
            return None
        event = remaining.pop(revision, None)
        if (not event or event.status not in allowed_statuses or event.source != "steer"
                or event.conversation_id != steer_mailbox(run_id)):
            return None
        message = str(event.payload.get("message") or "").strip()
        if not message:
            return None
        messages.append(message)
        # A legacy first append has no parent metadata. Other unlinked rows fail closed.
        revision = event.payload.get("previousSteerRevision")
    if not messages or remaining:
        return None
    return original["assistantPrompt"] + "".join("\n\n【追加指令】" + text for text in reversed(messages))


def _delivered_input_matches(session, run, job_id, expected, *, ordinary_steer=False):
    """Match the immutable dispatch and every subsequent authored append to its delivery."""
    job = session.get(Job, job_id)
    original = dict(job.payload.get("input", {}))
    if not ordinary_steer:
        original["label"] = run.agent_id
    if any(original.get(k) != v for k, v in expected.items()):
        return False
    if not run.input_json.get("steerRevision"):
        return original == run.input_json
    admitted = original.copy()
    if ordinary_steer:
        # A normal steer is admitted by submit_event under the active run lock.
        # The successful worker receipt below binds the exact resulting input.
        events = session.exec(select(AgentEvent).where(AgentEvent.conversation_id == steer_mailbox(run.id),
            AgentEvent.source == "steer")).all()
        revision = run.input_json.get("steerRevision")
        prompt = _ordinary_steer_input(original, run.id, revision, events)
        if prompt is None:
            return False
        admitted.update(assistantPrompt=prompt, steerRevision=revision)
        last_dispatch_seq = 0
    else:
        rows = session.exec(select(RunStep).where(RunStep.run_id == run.id,
            RunStep.kind == "editorial_revision").order_by(RunStep.seq)).all()
        if not rows:
            return False
        for row in rows:
            ev = session.get(AgentEvent, row.payload.get("steerRevision"))
            dispatch = session.get(RunStep, "dispatch:" + row.id)
            if (row.actor != "user" or row.conversation_id != run.conversation_id or row.payload.get("jobId") != job_id
                    or not ev or ev.source != "steer" or ev.conversation_id != steer_mailbox(run.id)
                    or not dispatch or dispatch.run_id != run.id or dispatch.kind != "model_call"
                    or dispatch.payload.get("editorialAdmissionId") != row.id or dispatch.seq <= row.seq):
                return False
            admitted["assistantPrompt"] += "\n\n【追加指令】" + ev.payload["message"]
            admitted["steerRevision"] = ev.id
        last_dispatch_seq = dispatch.seq
    if admitted != run.input_json:
        return False
    receipt = session.exec(select(RunStep).where(RunStep.run_id == run.id, RunStep.kind == "receipt")
                           .order_by(RunStep.seq.desc())).all()
    current_receipt = next((g.get("receipt", {}) for g in run.gate_results if g.get("type") == "receipt"), {})
    input_hash = hashlib.sha256(json.dumps(run.input_json, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()[:24]
    # A later lease may deliver the exact result persisted before a worker stopped.
    return any(r.payload.get("jobId") == job_id and type(origin := r.payload.get("leaseVersion")) is int
               and last_dispatch_seq < r.seq and 0 < origin <= run.lease_version
               and (terminal := r.payload.get("terminalResult", {})).get("steerRevision") == admitted["steerRevision"]
               and terminal.get("status") == "succeeded" and terminal.get("receiptId") == run.receipt_id
               and terminal.get("receipt", {}).get("inputHash") == input_hash
               and terminal.get("receipt", {}).get("attestation") == current_receipt.get("attestation")
               and terminal.get("outputVersions") == current_receipt.get("outputVersions")
               and terminal.get("runId") == run.id for r in receipt)


def _resume_partial_batch(session, group):
    from .autopilot import _START_LOCK, _batch_receipt, _batch_tasks, _has_active_autopilot

    with _START_LOCK:
        # The guarded write fences concurrent resumes and acquires SQLite's writer
        # lock before reading the approval map, delivery evidence or side-effect tables.
        claimed = session.execute(update(AsyncTaskGroup).where(
            AsyncTaskGroup.id == group.id, AsyncTaskGroup.user_id == DEMO_USER,
            AsyncTaskGroup.status == "partial_failed", AsyncTaskGroup.updated_at == group.updated_at,
        ).values(updated_at=utcnow()).execution_options(synchronize_session=False))
        if claimed.rowcount != 1:
            raise HTTPException(409, "批次状态已变化，请刷新")
        session.refresh(group)
        plan = group.plan_json or {}
        dispatcher = session.get(AgentRun, plan["dispatcherRunId"]) if plan.get("dispatcherRunId") else None
        project = session.get(Project, plan["projectId"]) if plan.get("projectId") else None
        if (plan.get("pipeline") != "autopilot" or not project or project.user_id != group.user_id
                or not dispatcher
                or _has_active_autopilot(session, project.id)):
            raise HTTPException(409, "缺少原批次派单或已有其他补全任务")
        siblings = session.exec(select(AsyncTaskGroup.id).where(
            AsyncTaskGroup.plan_json["dispatcherRunId"].as_string() == dispatcher.id)).all()
        if siblings != [group.id]:
            raise HTTPException(409, "原派单未绑定唯一任务组")
        tasks = _batch_tasks(session, project.id, dispatcher)
        if tasks != plan.get("tasks"):
            raise HTTPException(409, "派单与原批次清单不符")
        dispatcher_job_id = _check_batch_delivery(session, project, group, dispatcher)
        source = dispatcher.input_json or {}
        if source.get("pipelineExecutionId"):
            conv = session.get(Conversation, group.conversation_id) if group.conversation_id else None
            state = ((conv.group_rules or {}).get("pipeline_execution") or {}) if conv else {}
            if (not conv or conv.id != dispatcher.conversation_id or conv.user_id != group.user_id or conv.project_id != project.id
                    or state.get("executionId") != source["pipelineExecutionId"] or state.get("projectId") != project.id
                    or state.get("stageId") != source.get("pipelineStageId") or not any(
                        child.get("runId") == dispatcher.id and child.get("jobId") == dispatcher_job_id
                        and child.get("memberId") == dispatcher.agent_id and child.get("stageId") == state.get("stageId")
                        for child in state.get("inflight", []))):
                raise HTTPException(409, "批次不属于当前执行中的派单")
        ids = _batch_receipt(session, group, tasks)["runIds"]
        members = {r.id: r for r in session.exec(select(AgentRun).where(AgentRun.task_group_id == group.id))}
        if set(members) != set(ids):
            raise HTTPException(409, "批次成员与原清单不符")
        ordered = [members[rid] for rid in ids]
        start = next((i for i, run in enumerate(ordered) if run.status != "succeeded"), len(ordered))
        qa_only = (start == len(ordered) - 1 and start > 0 and
                   ordered[start].agent_id in {"qc.human_checklist", "qc.human_qc_duanju"})
        if start >= len(ordered):
            raise HTTPException(409, "没有可恢复的正文任务")
        for index, (run, task) in enumerate(zip(ordered, tasks)):
            expected_input = dict(assistantPrompt=task["instruction"], format=project.format,
                                  label=task["agent_id"], taskGroupId=group.id, **task.get("input_extra", {}))
            if (run.parent_run_id or run.project_id != project.id or run.conversation_id != group.conversation_id
                    or not daemon._batch_release_valid(session, group, run)
                    or (index >= start and run.input_json.keys() != expected_input.keys())):
                raise HTTPException(409, "正文任务与原派单输入不符")
            job_id = _check_batch_delivery(session, project, group, run) if index < start else None
            if job_id and (qa_only or run.input_json.get("steerRevision")):
                matches = _delivered_input_matches(session, run, job_id, expected_input)
            else:
                matches = all(run.input_json.get(k) == v for k, v in expected_input.items())
            if not matches:
                raise HTTPException(409, "正文任务或作者修订与原派单不符")
        suffix = ordered[start:]
        _check_unstarted_suffix(session, suffix, qa_only)
        session.add(ActivityLog(actor="user", action="batch_resume", project_id=project.id,
            conversation_id=group.conversation_id, summary="恢复入队前被阻断的正文批次",
            detail={"taskGroupId": group.id, "dispatcherRunId": dispatcher.id, "status": group.status,
                    "finishedAt": group.finished_at.isoformat() if group.finished_at else None,
                    "runs": [{"runId": r.id, "status": r.status, "reason": r.progress_stage,
                              "finishedAt": r.finished_at.isoformat()} for r in suffix]}))
        for run in suffix:
            if run.conversation_id:
                upsert_subscription(session, thread_key=project_thread_key(project.id),
                                    conversation_id=run.conversation_id, run_id=run.id,
                                    project_id=project.id, agent_id=run.agent_id, commit=False)
            run.status = "pending_deps"
            run.finished_at = None
            run.progress_stage = "等待依赖"
            session.add(run)
        group.status = "running"
        group.finished_at = None
        session.add(group)
        session.commit()
    daemon.tick(session, group_id=group.id)


@router.patch("/groups/{group_id}")
def patch_group(
    group_id: str,
    body: PatchGroupIn,
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    group = session.get(AsyncTaskGroup, group_id)
    if not group or group.user_id != DEMO_USER:
        raise HTTPException(404, "task group not found")
    if body.status == "running" and group.status == "partial_failed":
        if body.approval_mode is not None or body.max_concurrency is not None:
            raise HTTPException(409, "请单独恢复原批次")
        _resume_partial_batch(session, group)
        return daemon.serialize_group(session, group)
    if body.approval_mode:
        group = daemon.set_group_approval_mode(session, group_id, body.approval_mode) or group
    if body.max_concurrency is not None:
        group.max_concurrency = max(1, min(16, body.max_concurrency))
        session.add(group)
        session.commit()
    if body.status == "paused":
        group.status = "paused"
        session.add(group)
        session.commit()
        # 组暂停要真正冻结：已排队/运行中的实例也 pause（带 checkpoint，可 resume）
        for r in session.exec(select(AgentRun).where(AgentRun.task_group_id == group_id)).all():
            if r.status in {"queued", "running"}:
                lease.pause(session, r.id)
    elif body.status == "running" and group.status == "paused":
        group.status = "running"
        session.add(group)
        session.commit()
        for r in session.exec(select(AgentRun).where(AgentRun.task_group_id == group_id)).all():
            if r.status == "paused" or (r.status == "running" and r.control_signal == "pause"):
                lease.resume(session, r.id)
        daemon.tick(session)
    session.refresh(group)
    return daemon.serialize_group(session, group)


@router.post("/groups/{group_id}/cancel")
def cancel_group(group_id: str, session: Session = Depends(get_session)) -> dict[str, Any]:
    group = daemon.cancel_group(session, group_id)
    if not group or group.user_id != DEMO_USER:
        raise HTTPException(404, "task group not found")
    return daemon.serialize_group(session, group)


@router.post("/runs/{run_id}/approve")
def approve_run(
    run_id: str,
    body: ApproveRunIn,
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    run = daemon.approve_run(session, run_id, approve=body.approve, note=body.note)
    if not run:
        raise HTTPException(404, "run not found")
    return {"ok": True, "run": daemon._serialize_run(session, run)}


@router.post("/runs/{run_id}/update")
def update_run(
    run_id: str,
    body: UpdateRunIn,
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    run = session.get(AgentRun, run_id)
    if not run:
        raise HTTPException(404, "run not found")
    if run.status not in {"queued", "running", "pending_deps"}:
        raise HTTPException(400, f"run already finished ({run.status})")
    submit_event(
        session,
        conversation_id=steer_mailbox(run_id),
        source="steer",
        payload={"message": body.message, "strategy": body.update_strategy},
    )
    if body.update_strategy == "interrupt":
        request_interrupt(run_id)
    publish_task_event(
        {
            "type": "run_updated",
            "runId": run_id,
            "strategy": body.update_strategy,
            "taskGroupId": run.task_group_id,
            "conversationId": run.conversation_id,
        }
    )
    return {"ok": True, "runId": run_id, "strategy": body.update_strategy}


@router.post("/runs/{run_id}/cancel")
def cancel_run(run_id: str, session: Session = Depends(get_session)) -> dict[str, Any]:
    run = session.get(AgentRun, run_id)
    if not run:
        raise HTTPException(404, "run not found")
    from ..models import utcnow

    if run.status not in {"succeeded", "failed", "cancelled", "dead"}:
        run.status = "cancelled"
        run.finished_at = utcnow()
        run.progress_stage = "已取消"
        session.add(run)
        job = session.exec(select(Job).where(Job.result_ref == run_id)).first()
        if job:
            request_cancel(job.id)
            job.status = "cancelled"
            session.add(job)
        session.commit()
    if run.task_group_id:
        group = session.get(AsyncTaskGroup, run.task_group_id)
        if group:
            daemon.refresh_group_status(session, group)
    publish_task_event(
        {
            "type": "run_cancelled",
            "runId": run_id,
            "taskGroupId": run.task_group_id,
            "conversationId": run.conversation_id,
        }
    )
    return {"ok": True, "runId": run_id}


@router.patch("/runs/{run_id}/progress")
def patch_progress(
    run_id: str,
    body: ProgressIn,
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """供 agent-worker 上报进度。"""
    daemon.patch_run_progress(
        session,
        run_id,
        progress_pct=body.progress_pct,
        progress_stage=body.progress_stage,
    )
    if body.status:
        run = session.get(AgentRun, run_id)
        if run and body.status in {"running", "queued"}:
            run.status = body.status
            session.add(run)
            session.commit()
    run = session.get(AgentRun, run_id)
    return {"ok": True, "runId": run_id, "progressPct": run.progress_pct if run else None}


class LeaseIn(BaseModel):
    owner: str
    ttl_s: int = Field(default=lease.LEASE_TTL_S, alias="ttlS")

    model_config = {"populate_by_name": True}


class HeartbeatIn(BaseModel):
    owner: str
    lease_version: int = Field(alias="leaseVersion")
    ttl_s: int = Field(default=lease.LEASE_TTL_S, alias="ttlS")
    checkpoint: dict[str, Any] | None = None

    model_config = {"populate_by_name": True}


class ReleaseIn(BaseModel):
    owner: str
    lease_version: int = Field(alias="leaseVersion")
    state: Literal["paused", "done"] | None = None
    checkpoint: dict[str, Any] | None = None

    model_config = {"populate_by_name": True}


@router.post("/runs/{run_id}/lease")
def acquire_lease(run_id: str, body: LeaseIn, session: Session = Depends(get_session)) -> dict[str, Any]:
    """worker 领取执行租约（返回 lease_version + 上次执行 checkpoint，用于崩溃续跑）。"""
    return lease.acquire(session, run_id, body.owner, ttl_s=body.ttl_s)


@router.patch("/runs/{run_id}/heartbeat")
def run_heartbeat(run_id: str, body: HeartbeatIn, session: Session = Depends(get_session)) -> dict[str, Any]:
    return lease.heartbeat(
        session,
        run_id,
        body.owner,
        body.lease_version,
        ttl_s=body.ttl_s,
        checkpoint=body.checkpoint,
    )


@router.post("/runs/{run_id}/release")
def release_lease(run_id: str, body: ReleaseIn, session: Session = Depends(get_session)) -> dict[str, Any]:
    return lease.release(
        session,
        run_id,
        body.owner,
        body.lease_version,
        state=body.state,
        checkpoint=body.checkpoint,
    )


def _must_ok(result: dict[str, Any]) -> dict[str, Any]:
    if not result.get("ok"):
        code = 404 if result.get("reason") == "not_found" else 409
        raise HTTPException(code, result)
    return result


@router.post("/runs/{run_id}/pause")
def pause_run(run_id: str, session: Session = Depends(get_session)) -> dict[str, Any]:
    from ..action_audit import record_action

    out = _must_ok(lease.pause(session, run_id))
    record_action(session, actor="user", action="agent_pause", target=f"run:{run_id}", summary="暂停 Agent 实例", detail=out, notify=False)
    return out


@router.post("/runs/{run_id}/resume")
def resume_run(run_id: str, session: Session = Depends(get_session)) -> dict[str, Any]:
    from ..action_audit import record_action

    out = _must_ok(lease.resume(session, run_id))
    record_action(session, actor="user", action="agent_resume", target=f"run:{run_id}", summary="恢复 Agent 实例", detail=out, notify=False)
    return out


@router.post("/runs/{run_id}/stop")
def stop_run(run_id: str, session: Session = Depends(get_session)) -> dict[str, Any]:
    from ..action_audit import record_action

    out = _must_ok(lease.stop(session, run_id))
    record_action(session, actor="user", action="agent_stop", target=f"run:{run_id}", summary="停止 Agent 实例", detail=out, notify=False)
    return out


@router.get("/instances")
def list_instances(
    state: str | None = Query(None),
    project_id: str | None = Query(None, alias="projectId"),
    include_finished: bool = Query(False, alias="includeFinished"),
    limit: int = Query(60),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """≈ docker ps：Agent 实例列表（状态 / 租约 / 心跳 / checkpoint 摘要）。"""
    items = lease.list_instances(
        session, state=state, project_id=project_id, include_finished=include_finished, limit=limit
    )
    return {"instances": items, "count": len(items)}


@router.get("/metrics")
def instance_metrics(session: Session = Depends(get_session)) -> dict[str, Any]:
    return lease.instance_metrics(session)


@router.get("/instances/{run_id}")
def inspect_instance(run_id: str, session: Session = Depends(get_session)) -> dict[str, Any]:
    """≈ docker inspect + logs（含最近步骤）。"""
    view = lease.inspect_instance(session, run_id)
    if not view:
        raise HTTPException(404, "run not found")
    return view


@router.get("/audit")
def list_audit_actions(
    project_id: str | None = Query(None, alias="projectId"),
    actor: str | None = Query(None),
    on_behalf_only: bool = Query(False, alias="onBehalfOnly"),
    limit: int = Query(50),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """统一操作审计（代理人代用户的操作默认通知过用户）。"""
    from ..action_audit import list_audit

    items = list_audit(session, project_id=project_id, actor=actor, on_behalf_only=on_behalf_only, limit=limit)
    return {"actions": items, "count": len(items)}


@router.get("/summary")
def tasks_summary(session: Session = Depends(get_session)) -> dict[str, Any]:
    groups = daemon.list_task_groups(session, user_id=DEMO_USER, limit=50)
    running = 0
    waiting = 0
    queued = 0
    for g in groups:
        if g.get("status") in {"completed", "cancelled", "partial_failed"}:
            continue
        for r in g.get("runs") or []:
            st = r.get("status")
            if st == "running":
                running += 1
            elif st == "queued":
                queued += 1
            if r.get("approvalState") == "waiting":
                waiting += 1
    # 也统计无 group 的活跃 run
    orphan = list(
        session.exec(
            select(AgentRun).where(AgentRun.conversation_id.is_not(None))  # type: ignore[union-attr]
        )
    )
    for r in orphan:
        if r.task_group_id:
            continue
        if r.status == "running":
            running += 1
        elif r.status == "queued":
            queued += 1
    return {
        "running": running,
        "queued": queued,
        "waitingApproval": waiting,
        "slots": 4,
        "activeGroups": sum(
            1 for g in groups if g.get("status") in {"running", "waiting_approval", "paused"}
        ),
    }


@router.get("/stream")
async def tasks_stream(
    after_seq: int = Query(0, alias="afterSeq"),
) -> StreamingResponse:
    """用户级任务 SSE：进度 / 审批 / 完成。"""

    async def gen():
        seq = after_seq
        idle = 0
        while idle < 600:  # ~10min
            batch, latest = iter_memory_task_events_since(seq)
            if batch:
                for ev in batch:
                    seq = int(ev.get("seq") or seq)
                    yield f"data: {json.dumps(ev, ensure_ascii=False, default=str)}\n\n"
                idle = 0
            else:
                yield f"data: {json.dumps({'type': 'ping', 'seq': seq})}\n\n"
                idle += 1
                await asyncio.sleep(1.0)

    return StreamingResponse(gen(), media_type="text/event-stream")
