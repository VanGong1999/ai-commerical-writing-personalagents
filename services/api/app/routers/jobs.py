from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from uuid import NAMESPACE_URL, UUID, uuid5

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select
from sqlalchemy import bindparam, update
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.exc import IntegrityError

from fastapi import Query
from ..knowledge_colleague import owned_project, resolve_agent, run_role, validate_knowledge_input
from ..db import get_session
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from ..llm_service import resolve_default_model
from ..usage_attribution import DIGEST_EVENT_PREFIX, increment_project_tokens
from ..run_steps import next_step_seq
from ..models import ActivityLog, AgentRun, Job, Project, RunDigest, RunStep, UsageEvent, new_id, utcnow
from ..queue import (
    create_security_ask,
    clear_cancel,
    clear_interrupt,
    enqueue_job,
    get_security_ask,
    is_cancelled,
    poll_job_events,
    publish_job_event,
    request_cancel,
    resolve_security_ask,
)
from ..schemas import ArtifactOut, PatchArtifactIn, AgentRunOut, CreateJobIn, CreateRunIn, JobOut, RunDigestOut
from ..settings import get_settings
from ..vfs import _norm as _vfs_path

router = APIRouter(tags=["jobs"])

logger = logging.getLogger(__name__)


class RunStepIn(BaseModel):
    job_id: str
    kind: str = "tool_call"
    actor: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    conversation_id: str | None = None
    turn_id: str | None = None

_TERMINAL = frozenset({"succeeded", "failed", "cancelled", "dead"})


def _demo_user() -> str:
    return get_settings().demo_user_id


def _maybe_announce_job(session: Session, job: Job, status: str) -> None:
    """任务结束时推飞书（仅当有 conversation / delivery / 默认 chat）。"""
    try:
        from ..feishu_notify import announce_text
        from ..models import Project

        conv_id = job.conversation_id
        chat_id = None
        delivery = (job.payload or {}).get("delivery") if isinstance(job.payload, dict) else None
        if isinstance(delivery, dict) and delivery.get("channel") == "feishu":
            chat_id = delivery.get("chat_id")
            conv_id = delivery.get("conversation_id") or conv_id
        if not conv_id and not chat_id:
            # 无会话绑定则不打扰
            return
        title = None
        if job.project_id:
            p = session.get(Project, job.project_id)
            title = p.title if p else None
        summary = f"{job.type} → {status}"
        if job.error:
            summary += f"（{job.error[:120]}）"
        announce_text(
            session,
            (f"《{title}》" if title else "") + f"任务完成通知：{summary}",
            conversation_id=conv_id,
            chat_id=chat_id,
        )
    except Exception:  # noqa: BLE001
        pass


def _maybe_announce_run(session: Session, run: AgentRun, status: str) -> None:
    try:
        from ..feishu_notify import announce_run_finished
        from ..thread_router import deliver_completion

        claimed = deliver_completion(session, run, status, claim_worker_notification=True)
        session.commit()
        if not claimed:
            return
        project = session.get(Project, run.project_id) if run.project_id else None
        title = project.title if project else None
        summary = f"{run.agent_id}（产物 {len(run.output_artifact_ids or [])} 个）"
        # 飞书短通知；详细总结留给总编（若唤醒）
        announce_run_finished(
            session,
            conversation_id=run.conversation_id,
            status=status,
            summary=summary,
            project_title=title,
        )
    except Exception:  # noqa: BLE001
        session.rollback()
        logger.exception("completion routing failed for %s", run.id)


def _ensure_budget(session: Session, project_id: str | None) -> None:
    """Token 硬预算熔断：达到预算即拒绝入队，不做假按钮。"""
    if not project_id:
        return
    project = session.get(Project, project_id)
    if not project or not project.budget_tokens:
        return
    if project.token_used >= project.budget_tokens:
        raise HTTPException(
            429,
            detail={
                "message": "token budget exceeded",
                "budget": project.budget_tokens,
                "used": project.token_used,
            },
        )


def _enqueue_run_digest(session: Session, run: AgentRun, user_id: str) -> None:
    # Old queued jobs have random IDs and can lack a project_id.
    existing = session.exec(select(Job.id).where(
        Job.type == "run.digest", Job.payload["run_id"].as_string() == run.id,
    ).limit(1)).first()
    if existing is not None:
        return
    job = Job(id=str(uuid5(NAMESPACE_URL, f"run.digest:{run.id}")),
              type="run.digest", payload={"run_id": run.id},
              project_id=run.project_id, user_id=user_id)
    inserted = session.execute(insert(Job).values(**job.model_dump())
                               .on_conflict_do_nothing(index_elements=["id"]))
    session.commit()
    if inserted.rowcount:
        enqueue_job(job.id, {"type": job.type, "payload": job.payload})


@router.post("/jobs", response_model=JobOut)
def create_job(
    body: CreateJobIn,
    session: Session = Depends(get_session),
) -> Job:
    if body.type in {"agent.run", "agent.batch"} and body.payload.get("agentId"):
        role = resolve_agent(session, body.payload["agentId"], body.project_id, _demo_user())
        if role.get("custom"):
            raise HTTPException(422, "请通过 /runs 创建已绑定项目和岗位的知识任务")
    _ensure_budget(session, body.project_id)
    if body.idempotency_key:
        existing = session.exec(
            select(Job).where(Job.idempotency_key == body.idempotency_key)
        ).first()
        if existing:
            return existing
    job = Job(
        type=body.type,
        payload=body.payload,
        project_id=body.project_id,
        user_id=_demo_user(),
        priority=body.priority,
        idempotency_key=body.idempotency_key,
        status="queued",
    )
    session.add(job)
    session.commit()
    session.refresh(job)
    enqueue_job(job.id, {"type": job.type, "payload": job.payload})
    publish_job_event(job.id, {"type": "status", "status": "queued", "jobId": job.id})
    return job


@router.get("/jobs", response_model=list[JobOut])
def list_jobs(
    project_id: str | None = None,
    session: Session = Depends(get_session),
) -> list[Job]:
    rows = list(session.exec(select(Job).order_by(Job.created_at.desc())))
    if project_id:
        rows = [j for j in rows if j.project_id == project_id]
    return rows


@router.post("/jobs/claim")
def claim_agent_job(
    types: str = "agent.run,agent.batch",
    session: Session = Depends(get_session),
) -> dict:
    """原子领取一条 queued agent job（按 priority 升序、再 created_at）。

    多 worker 竞态安全：仅当 status 仍为 queued 时改为 running。
    """
    wanted = {t.strip() for t in (types or "").split(",") if t.strip()}
    if not wanted:
        wanted = {"agent.run", "agent.batch"}
    # 先按 priority / created_at 取候选，再 CAS 更新
    candidates = list(
        session.exec(
            select(Job)
            .where(Job.status == "queued", Job.type.in_(wanted))
            .order_by(Job.priority, Job.created_at)
            .limit(20)
        )
    )
    for job in candidates:
        if job.type not in wanted:
            continue
        result = session.execute(
            update(Job).where(Job.id == job.id, Job.status == "queued")
            .values(status="running", started_at=utcnow(), attempts=Job.attempts + 1)
            .execution_options(synchronize_session=False)
        )
        session.commit()
        if result.rowcount != 1:
            continue
        session.refresh(job)
        fresh = job
        return {
            "jobId": fresh.id,
            "type": fresh.type,
            "payload": fresh.payload,
            "runId": fresh.result_ref,
            "priority": fresh.priority,
            "attempts": fresh.attempts,
            "maxAttempts": fresh.max_attempts,
        }
    return {"jobId": None}


class SecurityAskIn(BaseModel):
    tool: str
    args: dict[str, Any] = Field(default_factory=dict)
    reason: str = ""
    timeout_s: int = 90


@router.post("/runs/{run_id}/security-ask")
def security_ask_create(
    run_id: str,
    body: SecurityAskIn,
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    run = session.get(AgentRun, run_id)
    if not run:
        raise HTTPException(404, "run not found")
    ask_id = new_id()
    row = create_security_ask(
        ask_id,
        {
            "run_id": run_id,
            "tool": body.tool,
            "args": body.args,
            "reason": body.reason,
            "conversation_id": run.conversation_id,
        },
        ttl_s=max(15, min(300, int(body.timeout_s or 90))),
    )
    # 若有会话，落一条待确认消息（Web 可点批准）
    if run.conversation_id:
        from ..models import Message

        session.add(
            Message(
                conversation_id=run.conversation_id,
                role="assistant",
                content=f"Worker 请求批准危险操作「{body.tool}」：{body.reason or ''}",
                actions=[
                    {
                        "type": "security_ask",
                        "ask_id": ask_id,
                        "run_id": run_id,
                        "tool": body.tool,
                        "args": body.args,
                    }
                ],
                run_id=run_id,
            )
        )
        session.commit()
    return {"askId": ask_id, "status": row.get("status"), "runId": run_id}


@router.get("/runs/{run_id}/security-ask/{ask_id}")
def security_ask_get(run_id: str, ask_id: str) -> dict[str, Any]:
    row = get_security_ask(ask_id)
    if not row or (row.get("payload") or {}).get("run_id") not in {run_id, None}:
        # 允许 payload 无 run_id 时仍返回
        if not row:
            raise HTTPException(404, "ask not found")
    return {
        "askId": ask_id,
        "status": row.get("status"),
        "reason": row.get("reason"),
        "payload": row.get("payload"),
    }


@router.post("/runs/{run_id}/security-ask/{ask_id}/respond")
def security_ask_respond(
    run_id: str,
    ask_id: str,
    approve: bool = True,
    reason: str = "",
) -> dict[str, Any]:
    row = resolve_security_ask(ask_id, approve=approve, reason=reason)
    if not row:
        raise HTTPException(404, "ask not found")
    return {"askId": ask_id, "status": row.get("status"), "runId": run_id}


@router.get("/jobs/{job_id}", response_model=JobOut)
def get_job(job_id: str, session: Session = Depends(get_session)) -> Job:
    job = session.get(Job, job_id)
    if not job:
        raise HTTPException(404, "job not found")
    return job


@router.post("/jobs/{job_id}/cancel", response_model=JobOut)
def cancel_job(job_id: str, session: Session = Depends(get_session)) -> Job:
    job = session.get(Job, job_id)
    if not job:
        raise HTTPException(404, "job not found")
    job.status = "cancelled"
    job.finished_at = utcnow()
    session.add(job)
    session.commit()
    session.refresh(job)
    request_cancel(job_id)
    return job


class EditorialRevision(BaseModel):
    revisionId: UUID
    expectedLeaseVersion: int = Field(ge=0)
    sourceCallId: str
    sourceTextHash: str
    selectedQuote: str
    operation: Literal["shorten", "rewrite"]
    instructions: str


class RetryRequest(BaseModel):
    editorialRevision: EditorialRevision


# ECMAScript String.trim whitespace for scan input and Number(string) coercion.
_JS_WHITESPACE = "\u0009\u000a\u000b\u000c\u000d \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"


def _scan_args(args):
    # Match the scan schema's JS Number coercion without changing the source text.
    normalized = dict(args)
    for key in ("minChars", "maxChars"):
        value = normalized[key]
        if isinstance(value, str):
            number = value.strip(_JS_WHITESPACE)
            if not number.isascii() or "_" in number:
                raise ValueError("invalid scan bound")
            normalized[key] = int(number, 0) if number.lower().startswith(("0x", "0o", "0b")) else float(number)
    return normalized


def _draft_probe(steps):
    """Resolve the last native scan response, executed call and confirmed measurement."""
    native = [s for s in steps if not s.payload.get("child_run_id") and s.kind in
              {"tool_result", "tool_call", "bash", "reply", "model_response"}]
    if len(native) < 3 or native[-1].kind != "tool_result":
        return None
    result = native[-1]
    response_index = next((i for i in range(len(native) - 2, -1, -1) if native[i].kind == "model_response"), None)
    if response_index is None:
        return None
    response = native[response_index]
    executed = native[response_index + 1:-1]
    if (not executed or not result.turn_id or any(s.turn_id != result.turn_id or s.actor != "agent:prose.episode_body"
                                                 for s in native[response_index:])):
        return None
    r = result.payload
    calls = response.payload.get("tool_calls") or []
    if (len(calls) != 1 or not r.get("id") or calls[0].get("id") != r["id"]
            or r.get("name") != "scan_length" or r.get("status") != "done"):
        return None
    fn = calls[0].get("function") or {}
    try:
        raw = fn["arguments"]
        args = _scan_args(json.loads(raw) if isinstance(raw, str) else raw)
        measured = json.loads(r["result"])
        text = args["text"]
        # JS String.trim whitespace, followed by the same Unicode codepoint count.
        n = len(text.strip(_JS_WHITESPACE))
        # A pending read can record its call again on recovery. Verify every copy against the native request.
        if any(s.kind != "tool_call" or s.payload.get("id") != r["id"] or s.payload.get("name") != r["name"]
               or _scan_args(s.payload["args"]) != args for s in executed):
            return None
        if (fn["name"] != r["name"] or (args["minChars"], args["maxChars"]) != (800, 1200)
                or measured["check"]["id"] != "length_band" or measured["n"] != n
                or measured["passed"] is not (775 <= n <= 1225)
                or measured["check"]["result"] != ("pass" if measured["passed"] else "fail")):
            return None
    except (AttributeError, KeyError, TypeError, ValueError):
        return None
    return dict(sourceCallId=r["id"], sourceText=text, sourceTextHash=hashlib.sha256(text.encode()).hexdigest(), count=n, passed=measured["passed"])


def _commission_outcome(steps, job_id):
    """A durable dispatch spends the rewrite even when the reply never became a native tool round."""
    admission = next((s for s in reversed(steps) if s.kind == "editorial_revision" and s.actor == "user"
                      and s.payload.get("jobId") == job_id), None)
    if admission is None:
        return None
    dispatch = next((s for s in steps if s.id == "dispatch:" + admission.id and s.kind == "model_call"
                     and s.payload.get("editorialAdmissionId") == admission.id and s.seq > admission.seq), None)
    if not dispatch:
        return None
    turn = [s for s in steps if s.seq > dispatch.seq and s.turn_id == dispatch.turn_id and not s.payload.get("child_run_id")]
    response = next((s for s in turn if s.kind == "model_response"), None)
    calls = response.payload.get("tool_calls", []) if response else []
    if len(calls) != 1 or calls[0].get("function", {}).get("name") != "scan_length" or not calls[0].get("id"):
        return "spent"
    if not any(s.kind == "tool_result" and s.payload.get("id") == calls[0]["id"] for s in turn):
        # Receipt recovery can execute the outstanding read without repeating its model call.
        return "pending_read"
    measurement = _draft_probe(turn)
    if not measurement:
        return "spent"
    return "passed" if measurement["passed"] else "failed_scan"


def _editorial_context(session, job):
    from ..models import Artifact
    from ..task_daemon import outline_version_approved

    ordinary = {"eligible": False, "requiresRevision": False}
    length_failure = (job.error or "").startswith("正文测长修复轮次已耗尽。")
    if not length_failure and (job.type != "agent.run" or job.payload.get("agentId") != "prose.episode_body"
                               or job.status not in {"failed", "dead", "cancelled"} or job.user_id != _demo_user()):
        return ordinary
    steps = session.exec(select(RunStep).where(RunStep.run_id == job.result_ref).order_by(RunStep.seq)).all()
    outcome = _commission_outcome(steps, job.id)
    if outcome == "spent":
        return {"eligible": False, "requiresRevision": True, "reason": "本次作者修订已经发出，缺少可继续处理的测量结果。请核对运行记录。"}
    if outcome == "pending_read" or (not length_failure and outcome != "failed_scan"):
        return ordinary
    denied = {"eligible": False, "requiresRevision": True, "reason": "草稿或大纲的当前版本无法核实，请查看运行记录。"}
    run = session.get(AgentRun, job.result_ref)
    if (not run or job.user_id != _demo_user() or run.agent_id != "prose.episode_body" or run.status != "failed"
            or job.status != "failed" or job.type != "agent.run" or job.project_id != run.project_id
            or job.conversation_id != run.conversation_id or not run.conversation_id or run.output_artifact_ids
            or job.task_group_id != run.task_group_id or job.payload.get("runId") != run.id
            or job.payload.get("agentId") != run.agent_id or job.payload.get("nested")):
        return denied
    project = owned_project(session, run.project_id, job.user_id)
    ref = run.input_json.get("outline_ref") or {}
    outline = session.get(Artifact, ref.get("id")) if ref.get("id") else None
    if (not outline or outline.project_id != project.id or outline.type != "episode_outline"
            or ref != job.payload.get("input", {}).get("outline_ref") or outline.version != ref.get("version")
            or not outline_version_approved(project.progress or {}, outline.id, outline.version)):
        return denied
    if session.exec(select(Artifact.id).where(Artifact.created_by_run_id == run.id, Artifact.type == "manuscript")).first():
        return denied
    probe = _draft_probe(steps)
    repairs = {s.payload.get("event_id") or s.id for s in steps if s.kind == "repair" and not s.payload.get("child_run_id")}
    if not probe or probe["passed"] or len(repairs) < int(job.payload.get("maxRepairRounds") or 3):
        return denied
    if ((outcome != "failed_scan" and job.error != f"正文测长修复轮次已耗尽。最近草稿见 scan_length 调用 {probe['sourceCallId']}（{probe['count']} 字）。")
            or any(s.actor == "user" and s.kind == "editorial_revision" and
                   s.payload.get("sourceCallId") == probe["sourceCallId"] for s in steps)):
        return denied
    del probe["passed"]
    return dict(eligible=True, requiresRevision=True, runId=run.id, jobId=job.id,
                expectedLeaseVersion=run.lease_version, outline=ref, **probe)


@router.get("/jobs/{job_id}/retry-context")
def retry_context(job_id: str, session: Session = Depends(get_session)):
    job = session.get(Job, job_id)
    if not job or job.user_id != _demo_user():
        raise HTTPException(404, "job not found")
    return _editorial_context(session, job)


@router.post("/jobs/{job_id}/retry", response_model=JobOut)
def retry_job(job_id: str, session: Session = Depends(get_session), body: RetryRequest | None = None) -> Job:
    revision = body.editorialRevision if body else None
    if revision and session.get_bind().dialect.name == "sqlite":
        connection = session.connection()
        if not connection.connection.driver_connection.in_transaction:
            connection.exec_driver_sql("BEGIN IMMEDIATE")
    job = session.get(Job, job_id)
    if not job:
        raise HTTPException(404, "job not found")
    if revision:
        if job.user_id != _demo_user():
            raise HTTPException(404, "job not found")
        request_data = revision.model_dump(mode="json")
        admission_id = f"editorial:{job.id}:{revision.revisionId}"
        prior = session.get(RunStep, admission_id)
        if prior:
            if (prior.kind == "editorial_revision" and prior.actor == "user" and prior.run_id == job.result_ref
                    and prior.payload.get("request") == request_data):
                return job
            raise HTTPException(409, "此修订请求已用于其他内容")
    context = _editorial_context(session, job)
    if revision:
        if (not context["eligible"] or any(context[k] != request_data[k] for k in
                ("expectedLeaseVersion", "sourceCallId", "sourceTextHash"))):
            raise HTTPException(409, "草稿状态已变化，请重新读取修订原文")
        if (not revision.selectedQuote.strip() or revision.selectedQuote not in context["sourceText"]
                or not revision.instructions.strip()):
            raise HTTPException(422, "请选中草稿中的原文并填写修改意见")
    elif context["requiresRevision"]:
        if not context["eligible"]:
            raise HTTPException(409, context["reason"])
        raise HTTPException(409, "字数修复已停止。请在运行任务页 /runs 打开原任务，选中草稿并提交修改意见。")
    if job.status not in {"failed", "dead", "cancelled"}:
        raise HTTPException(409, "仅失败或取消的任务可重试；暂停任务请使用恢复")
    run_id = None
    payload = dict(job.payload or {})
    # Do not dirty ORM rows before these guarded updates: autoflush could erase
    # a newer worker's lease before the compare-and-swap has checked it.
    with session.no_autoflush:
        if job.type in {"agent.run", "agent.batch"}:
            run_id = job.result_ref or payload.get("runId")
            run = session.get(AgentRun, run_id) if run_id else None
            if not run:
                raise HTTPException(404, "run not found")
            from ..models import Bot
            bot = session.get(Bot, run.agent_id)
            if bot and not bot.is_system:
                run_role(session, run.id, job.id, _demo_user(), initialize=True)
            if run.status not in {"failed", "dead", "cancelled"}:
                raise HTTPException(409, "运行尚未失败或已完成，不能重复启动")
            # Explicit retry authorizes recovery, never replay of uncertain
            # writes. Keep checkpoint/tool evidence and invalidate old writers.
            claimed = session.execute(
                update(AgentRun).where(
                    AgentRun.id == run.id,
                    AgentRun.status == run.status,
                    AgentRun.lease_version == run.lease_version,
                ).values(
                    status="queued", finished_at=None, control_signal=None,
                    lease_owner=None, lease_until=None, heartbeat_at=None,
                    lease_version=int(run.lease_version or 0) + 1,
                    attempt=0, progress_stage="等待恢复",
                    exec_checkpoint={**(run.exec_checkpoint or {}), "_operatorResume": True},
                ).execution_options(synchronize_session=False)
            )
            if claimed.rowcount != 1:
                session.rollback()
                raise HTTPException(409, "运行状态已变化，请刷新后重试")
            payload["operatorDecision"] = "resume"
        claimed_job = session.execute(
            update(Job).where(
                Job.id == job.id,
                Job.status == job.status,
                Job.attempts == job.attempts,
            ).values(
                status="queued", attempts=0, error=None,
                started_at=None, finished_at=None, payload=payload,
            ).execution_options(synchronize_session=False)
        )
        if claimed_job.rowcount != 1:
            # The run transition above belongs to this same transaction.
            session.rollback()
            raise HTTPException(409, "任务状态已变化，请刷新后重试")
    if revision:
        from ..agent_inbox import steer_mailbox, submit_event
        operation = "精简" if revision.operation == "shorten" else "改写"
        note = f"请{operation}下列选段，并按作者意见修订本集全文。\n【选段】\n{revision.selectedQuote}\n【作者意见】\n{revision.instructions.strip()}"
        ev = submit_event(session, conversation_id=steer_mailbox(run_id), source="steer",
                          payload={"message": note}, commit=False)
        session.add(RunStep(id=admission_id, conversation_id=run.conversation_id, run_id=run_id,
                            seq=next_step_seq(session, run.conversation_id), actor="user", kind="editorial_revision",
                            payload={"jobId": job_id, "sourceCallId": revision.sourceCallId, "steerRevision": ev.id,
                                     "request": request_data}))
    session.add(
        ActivityLog(
            actor="user",
            action="job_retry",
            summary=f"重试任务 {job.type}",
            project_id=job.project_id,
            detail={"job_id": job.id, **({"editorialRevision": admission_id} if revision else {})},
        )
    )
    session.commit()
    session.refresh(job)
    clear_cancel(job.id)
    if run_id:
        clear_interrupt(run_id)
    enqueue_job(job.id, {"type": job.type, "payload": job.payload})
    publish_job_event(job.id, {"type": "status", "status": "queued", "jobId": job.id})
    return job


@router.get("/jobs/{job_id}/events")
async def job_events(job_id: str, session: Session = Depends(get_session)) -> StreamingResponse:
    job = session.get(Job, job_id)
    if not job:
        raise HTTPException(404, "job not found")

    async def gen():
        yield f"data: {json.dumps({'type': 'status', 'status': job.status, 'jobId': job_id}, ensure_ascii=False)}\n\n"
        if job.status in _TERMINAL:
            yield f"data: {json.dumps({'type': 'done', 'status': job.status}, ensure_ascii=False)}\n\n"
            return

        loop = asyncio.get_running_loop()
        poller = poll_job_events(job_id)
        idle = 0
        while True:
            if is_cancelled(job_id):
                yield f"data: {json.dumps({'type': 'status', 'status': 'cancelled'}, ensure_ascii=False)}\n\n"
                yield 'data: {"type":"done","status":"cancelled"}\n\n'
                return

            _sid, event = await loop.run_in_executor(None, lambda: next(poller))
            if event.get("type") == "ping":
                idle += 1
                session.expire_all()
                fresh = session.get(Job, job_id)
                if fresh and fresh.status in _TERMINAL:
                    yield f"data: {json.dumps({'type': 'status', 'status': fresh.status}, ensure_ascii=False)}\n\n"
                    if fresh.error:
                        yield f"data: {json.dumps({'type': 'error', 'message': fresh.error}, ensure_ascii=False)}\n\n"
                    yield f"data: {json.dumps({'type': 'done', 'status': fresh.status}, ensure_ascii=False)}\n\n"
                    return
                if idle % 8 == 0:
                    yield f"data: {json.dumps({'type': 'ping'}, ensure_ascii=False)}\n\n"
                continue

            idle = 0
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
            if event.get("type") == "done" or event.get("status") in _TERMINAL:
                if event.get("type") != "done":
                    yield f"data: {json.dumps({'type': 'done', 'status': event.get('status')}, ensure_ascii=False)}\n\n"
                return

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/runs/{run_id}/knowledge-role")
def knowledge_role(run_id: str, job_id: str, session: Session = Depends(get_session), owner: str = Depends(_demo_user)):
    return run_role(session, run_id, job_id, owner, initialize=True)


@router.get("/runs/{run_id}/knowledge-outputs")
def knowledge_outputs(run_id: str, job_id: str, version: str, session: Session = Depends(get_session),
                      owner: str = Depends(_demo_user), evidence: bool = False):
    from ..models import Artifact, ArtifactVersion
    role = run_role(session, run_id, job_id, owner)
    if version != role["version"]:
        raise HTTPException(409, "本次知识岗位授权版本已变更")
    scope = (Artifact.project_id == role["runProjectId"], Artifact.created_by_run_id == run_id,
             Artifact.type == "qc_report")
    if evidence:
        rows = session.exec(select(Artifact, ArtifactVersion).outerjoin(ArtifactVersion,
            (ArtifactVersion.artifact_id == Artifact.id) & (ArtifactVersion.version == Artifact.version))
            .where(*scope).order_by(Artifact.created_at, Artifact.id))
        reports = {}
        for row, snapshot in rows:
            if row.id in reports:
                reports[row.id]["versionActor"] = None
                continue
            matches = snapshot is not None and all(getattr(row, field) == getattr(snapshot, field)
                for field in ("title", "status", "body_markdown", "body_json"))
            reports[row.id] = dict(id=row.id, version=row.version, status=row.status, type=row.type,
                                   title=row.title, createdByRunId=run_id, projectId=row.project_id,
                                   bodyMarkdown=row.body_markdown, bodyJson=row.body_json,
                                   versionActor=snapshot.actor if matches else None)
        return {"artifacts": list(reports.values())}
    rows = session.exec(select(Artifact.id, Artifact.version, Artifact.status).where(*scope)
                        .order_by(Artifact.created_at, Artifact.id)).all()
    return {"artifacts": [dict(id=identity, version=revision, status=status) for identity, revision, status in rows]}


class KnowledgeCitationIn(BaseModel):
    docId: str = Field(min_length=1, max_length=128)
    refId: str | None = Field(default=None, min_length=1, max_length=128)
    quote: str = Field(min_length=1, max_length=2400)
    offset: int = Field(strict=True, ge=0, le=9007199254740991)


class KnowledgeCitationsIn(BaseModel):
    citations: list[KnowledgeCitationIn] = Field(min_length=1, max_length=24)
    roleVersion: str = Field(min_length=1, max_length=128)


def resolve_quote_offset(text: str, quote: str, offset: int) -> int:
    """Use the code-point offsets of the uploaded-document paging API."""
    if not quote.strip():
        raise HTTPException(422, "引用不能为空")
    if text.startswith(quote, offset):
        return offset
    first = text.find(quote)
    if first < 0:
        raise HTTPException(422, "授权文档没有此逐字引文")
    if text.find(quote, first + 1) >= 0:
        raise HTTPException(422, "引文多处出现，请提供准确位置或更长的原文")
    return first


@router.post("/runs/{run_id}/knowledge-citations")
def knowledge_citations(run_id: str, job_id: str, body: KnowledgeCitationsIn,
                        session: Session = Depends(get_session), owner: str = Depends(_demo_user)):
    from .kb import _doc_text
    from ..models import KnowledgeDoc
    sources = {}
    role = run_role(session, run_id, job_id, owner, selected_sources=sources)
    if role["version"] != body.roleVersion:
        raise HTTPException(409, "本次知识岗位授权版本已变更")
    docs = {cite.docId for cite in body.citations}
    if not docs.issubset(role["documentIds"]):
        raise HTTPException(403, "引文文档不在本次授权范围")

    from ..context_refs import content_hash
    selected = {r["id"]: r for r in role.get("selectedReferences", [])}
    anchors = [None] * len(body.citations)
    for doc_id in docs:
        if doc_id in sources:
            source, digest = sources[doc_id]
        else:
            source = _doc_text(session.get(KnowledgeDoc, doc_id))
            digest = content_hash(source)
        for index, cite in enumerate(body.citations):
            if cite.docId == doc_id:
                attribution = {}
                ref_id = cite.refId
                if ref_id is None:
                    matches = [r["id"] for r in selected.values() if r["sourceId"] == doc_id
                               and r["offset"] <= cite.offset < r["offset"] + r["limit"] and cite.quote in r["quote"]]
                    if len(matches) == 1:
                        ref_id = matches[0]
                if ref_id:
                    ref = selected.get(ref_id)
                    if not ref or ref["sourceId"] != doc_id or ref["contentHash"] != digest:
                        raise HTTPException(409, "引文与绑定的选区不匹配，请重新选择原文")
                    start = ref["offset"]
                    relative = cite.offset - start
                    # An outside offset cannot disambiguate repetitions inside the selection.
                    hint = relative if 0 <= relative < ref["limit"] else ref["limit"]
                    offset = start + resolve_quote_offset(ref["quote"], cite.quote, hint)
                    attribution = {"refId": ref_id, "snapshotId": ref["snapshotId"]}
                else:
                    offset = resolve_quote_offset(source, cite.quote, cite.offset)
                anchors[index] = dict(docId=doc_id, quote=cite.quote, offset=offset,
                                      providedOffset=cite.offset, sourceHash=digest, **attribution)
    return {"citations": anchors}


def verify_selected_report(session, run, job, art):
    report = art.body_json
    if (art.type != "qc_report" or art.status != "candidate" or report.get("agentId") != run.agent_id
            or report.get("roleVersion") != run.knowledge_role_version):
        raise HTTPException(409, "知识岗位只能保存本次运行的候选报告")
    try:
        batch = KnowledgeCitationsIn(roleVersion=run.knowledge_role_version, citations=[
            {**c, "offset": c["providedOffset"]} for c in report["citations"]
        ])
    except (KeyError, TypeError, ValidationError) as exc:
        raise HTTPException(422, "报告需要已核验的原文引用") from exc
    anchors = knowledge_citations(run.id, job.id, batch, session, job.user_id)["citations"]
    for citation, anchor in zip(report["citations"], anchors):
        if any(citation.get(key) != value for key, value in anchor.items()):
            raise HTTPException(409, "引文与当前原文或选区不符，请重新选择原文")


class KnowledgeRevisionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    roleVersion: str = Field(min_length=1, max_length=128)
    leaseVersion: int = Field(strict=True, ge=0)
    expectedVersion: int = Field(strict=True, ge=1)
    title: str | None = None
    bodyMarkdown: str | None = None
    bodyJson: dict | None = None


@router.patch("/runs/{run_id}/knowledge-outputs/{artifact_id}", response_model=ArtifactOut)
def revise_knowledge_report(run_id: str, artifact_id: str, job_id: str, body: KnowledgeRevisionIn,
                            session: Session = Depends(get_session), owner: str = Depends(_demo_user)):
    from ..models import Artifact
    from .projects import _patch_artifact

    # Source bytes, current role/allowlist and the candidate CAS belong to one
    # transaction. SQLite's legacy SELECT otherwise does not begin a transaction.
    if session.get_bind().dialect.name == "sqlite":
        connection = session.connection()
        if not connection.connection.driver_connection.in_transaction:
            connection.exec_driver_sql("BEGIN IMMEDIATE")
    elif session.get_bind().dialect.name == "postgresql":
        session.connection(execution_options={"isolation_level": "SERIALIZABLE"})
    role = run_role(session, run_id, job_id, owner)
    if role["version"] != body.roleVersion or not role["canReviseOwnReport"]:
        raise HTTPException(403, "本次知识报告写入授权无效")
    run = session.get(AgentRun, run_id)
    job = session.get(Job, job_id)
    if (run.status != "running" or job.status != "running" or run.control_signal is not None
            or run.lease_version != body.leaseVersion):
        raise HTTPException(409, "仅当前执行中的知识任务可修订报告")
    scope = (Artifact.project_id == role["runProjectId"], Artifact.type == "qc_report",
             Artifact.created_by_run_id == run_id, Artifact.status == "candidate", Artifact.adopted_at.is_(None))
    row = session.exec(select(Artifact).where(Artifact.id == artifact_id, *scope)).first()
    if (not row or not isinstance(row.body_json, dict) or row.body_json.get("agentId") != role["id"]
            or row.body_json.get("roleVersion") != role["version"]):
        raise HTTPException(403, "只能修订本岗位本次运行的候选报告")
    if row.version != body.expectedVersion:
        raise HTTPException(409, "候选报告版本已变化，请用 artifact_list 核对内容和版本")
    edits = body.model_dump(include={"title", "bodyMarkdown", "bodyJson"}, exclude_unset=True)
    if not edits or any(value is None for value in edits.values()):
        raise HTTPException(422, "需要提交实际修订的标题、正文或证据")
    report = edits.get("bodyJson", row.body_json)
    if not all(isinstance(value, str) and value.strip() for value in (
            edits.get("title", row.title), edits.get("bodyMarkdown", row.body_markdown),
            report.get("verified"), report.get("unknowns"))):
        raise HTTPException(422, "标题、正文、已证实内容和未知项须为非空文本")
    if "unknownItems" in report:
        items = report["unknownItems"]
        if (not isinstance(items, list) or not items or not all(isinstance(x, str) and x.strip() for x in items)
                or "\n".join(items) != report["unknowns"]):
            raise HTTPException(422, "未知项与逐项记录不一致")
    citations = report.get("citations")
    if not isinstance(citations, list) or not 1 <= len(citations) <= 24 or not all(isinstance(c, dict) for c in citations):
        raise HTTPException(422, "报告需要 1 至 24 条授权原文引用")
    try:
        batch = KnowledgeCitationsIn(roleVersion=body.roleVersion, citations=[
            {**c, "offset": c.get("providedOffset", c.get("offset"))} for c in citations])
    except ValidationError as exc:
        raise HTTPException(422, "引文需要有效的文档 ID、逐字原文和整数位置") from exc
    anchors = knowledge_citations(run_id, job_id, batch, session, owner)["citations"]
    for citation, anchor in zip(citations, anchors):
        # Historical exact-offset records can acquire a digest after verification.
        historical = "bodyJson" not in edits and "providedOffset" not in citation and "sourceHash" not in citation
        if (type(citation.get("offset")) is not int or citation["offset"] != anchor["offset"]
                or (not historical and (citation.get("sourceHash") != anchor["sourceHash"] or "providedOffset" not in citation))):
            raise HTTPException(409, "引文位置或原文版本已变化，请重新核查授权原文")
    edits["bodyJson"] = {**report, "agentId": role["id"], "roleVersion": role["version"],
                         "citations": [{**c, **a} for c, a in zip(citations, anchors)]}
    # Evaluate the clock when the final CAS executes, after the baseline lock.
    write_time = bindparam("knowledge_write_time", callable_=utcnow, type_=AgentRun.lease_until.type)
    active = select(AgentRun.id).where(
        AgentRun.id == run_id, AgentRun.status == "running", AgentRun.control_signal.is_(None),
        AgentRun.lease_version == body.leaseVersion, AgentRun.lease_until > write_time).exists()
    active_job = select(Job.id).where(Job.id == job_id, Job.status == "running").exists()
    patch = PatchArtifactIn(expectedVersion=body.expectedVersion, **edits)
    return _patch_artifact(role["runProjectId"], artifact_id, patch, session, actor=f"agent:{run_id}",
                           candidate_conditions=(*scope, active, active_job))


@router.get("/runs/{run_id}/knowledge-search")
def knowledge_search(run_id: str, job_id: str, q: str = Query(min_length=1, max_length=256),
                     limit: int = Query(8, ge=1, le=40), session: Session = Depends(get_session), owner: str = Depends(_demo_user),
                   version: str = Query(..., min_length=1, max_length=128)):
    from .kb import _doc_text
    from ..models import KnowledgeDoc
    sources = {}
    role = run_role(session, run_id, job_id, owner, selected_sources=sources)
    if version != role["version"]:
        raise HTTPException(409, "本次知识岗位授权版本已变更")
    hits = []
    for identity in role["documentIds"]:
        doc = session.get(KnowledgeDoc, identity)
        text = sources[identity][0] if identity in sources else _doc_text(doc)
        pos = text.find(q)
        if pos >= 0:
            start = max(0, pos - 80)
            hits.append(dict(docId=identity, title=doc.title, offset=start, snippet=text[start:pos+len(q)+120]))
        if len(hits) >= limit:
            break
    return {"hits": hits}


@router.get("/runs/{run_id}/knowledge-doc/{doc_id}")
def knowledge_page(run_id: str, doc_id: str, job_id: str, offset: int = Query(0, ge=0),
                   limit: int = Query(2400, ge=1, le=12000), session: Session = Depends(get_session), owner: str = Depends(_demo_user),
                   version: str = Query(..., min_length=1, max_length=128)):
    from .kb import get_doc_text, doc_text_page
    from ..models import KnowledgeDoc
    sources = {}
    role = run_role(session, run_id, job_id, owner, selected_sources=sources)
    if version != role["version"]:
        raise HTTPException(409, "本次知识岗位授权版本已变更")
    if doc_id not in role["documentIds"]:
        raise HTTPException(403, "文档不在本次授权范围")
    if doc_id in sources:
        return doc_text_page(session.get(KnowledgeDoc, doc_id), sources[doc_id][0], offset, limit)
    return get_doc_text(doc_id, offset, limit, session)


@router.post("/runs", response_model=AgentRunOut)
def create_run(
    body: CreateRunIn,
    session: Session = Depends(get_session),
) -> AgentRunOut:
    role = resolve_agent(session, body.agent_id, body.project_id, _demo_user())
    validate_knowledge_input(role, body.input_json)
    body.agent_id = role["id"]
    _ensure_budget(session, body.project_id)
    run = AgentRun(
        project_id=body.project_id,
        agent_id=body.agent_id,
        status="queued",
        input_json=body.input_json,
        model=resolve_default_model(),
    )
    payload: dict = {"runId": run.id, "agentId": body.agent_id, "input": body.input_json}
    if body.operator_decision:
        payload["operatorDecision"] = body.operator_decision
    job = Job(
        type="agent.run",
        payload=payload,
        project_id=body.project_id,
        user_id=_demo_user(),
        result_ref=run.id,
    )
    session.add(run)
    session.add(job)
    session.commit()
    session.refresh(run)
    session.refresh(job)
    enqueue_job(job.id, {"type": job.type, "payload": job.payload, "runId": run.id})
    publish_job_event(
        job.id,
        {"type": "status", "status": "queued", "jobId": job.id, "runId": run.id},
    )
    out = AgentRunOut.model_validate(run)
    out.job_id = job.id
    return out


@router.get("/runs/{run_id}", response_model=AgentRunOut)
def get_run(run_id: str, session: Session = Depends(get_session)) -> AgentRun:
    run = session.get(AgentRun, run_id)
    if not run:
        raise HTTPException(404, "run not found")
    return run


@router.get("/runs/{run_id}/digest", response_model=RunDigestOut)
def get_run_digest(run_id: str, session: Session = Depends(get_session)) -> RunDigest:
    """run 决策摘要（narrator）。"""
    row = session.exec(
        select(RunDigest)
        .where(RunDigest.run_id == run_id)
        .order_by(RunDigest.created_at.desc())
    ).first()
    if not row:
        raise HTTPException(404, "digest not found")
    return row


class SteerIn(BaseModel):
    message: str = ""


@router.post("/runs/{run_id}/steer")
def post_steer(
    run_id: str,
    body: SteerIn,
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """向运行中的 Worker 追加指令（写入 steer 信箱）。"""
    from ..agent_inbox import steer_mailbox, submit_event

    run = session.get(AgentRun, run_id)
    if not run:
        raise HTTPException(404, "run not found")
    msg = (body.message or "").strip()
    if not msg:
        raise HTTPException(400, "message required")
    if run.status not in {"queued", "running"}:
        raise HTTPException(409, f"run not active ({run.status})")
    ev = submit_event(
        session,
        conversation_id=steer_mailbox(run_id),
        source="steer",
        payload={"message": msg},
    )
    return {"ok": True, "eventId": ev.id, "runId": run_id}


@router.get("/runs/{run_id}/steer")
def get_steer(
    run_id: str,
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Worker 轮询：抢占本 run 的 steer 消息。"""
    from ..agent_inbox import claim_pending, mark_done, steer_mailbox

    mailbox = steer_mailbox(run_id)
    events = claim_pending(session, mailbox, limit=10)
    messages = []
    for ev in events:
        text = str((ev.payload or {}).get("message") or "").strip()
        if text:
            messages.append(text)
    if events:
        mark_done(session, events, failed=False)
    run = session.get(AgentRun, run_id, populate_existing=True)
    inputs = run.input_json if run else {}
    return {"runId": run_id, "messages": messages, "count": len(messages),
            **({"inputJson": inputs} if inputs and inputs.get("steerRevision") else {})}


def project_replay_conversation_id(project_id: str | None, run_id: str) -> str:
    """创作台 Run 无 PA conversation 时，用项目级伪会话承接步骤账本，供全链路回放。"""
    if project_id:
        return f"project:{project_id}"
    return f"run:{run_id}"


def _child_admission_id(root_id, child_id):
    return str(uuid5(NAMESPACE_URL, json.dumps(["child_admission", root_id, child_id])))


def _child_terminal_id(root_id, child_id):
    return str(uuid5(NAMESPACE_URL, json.dumps(["child_run_end", root_id, child_id])))


def _child_actor(session, root_id, parent_id, child_id):
    if (not isinstance(parent_id, str) or not isinstance(child_id, str) or
            not child_id.startswith(f"nested_{parent_id}_") or not child_id.endswith("_run")):
        raise HTTPException(403, "子运行未绑定到本任务")
    admission = session.get(RunStep, _child_admission_id(root_id, child_id))
    if admission and admission.payload.get("spawning_run_id") == parent_id:
        return admission.payload["agent_id"]
    # An older in-flight nested job has no admission row. Its original,
    # already-persisted run_start binds the same parent, child and actor.
    start = session.exec(select(RunStep).where(RunStep.run_id == root_id, RunStep.kind == "run_start",
        RunStep.payload["child_run_id"].as_string() == child_id,
        RunStep.payload["parent_run_id"].as_string() == parent_id)).first()
    from ..agent_colleagues import is_agent_colleague_id
    actor_id = (start.actor or "").removeprefix("agent:") if start else None
    if actor_id and is_agent_colleague_id(actor_id):
        return actor_id
    raise HTTPException(403, "缺少已派发的子运行记录")



def _bible_input_hash(inputs):
    encoded = json.dumps(inputs, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(encoded.encode()).hexdigest()


def _current_bible_pins(session, run, inputs, lock):
    from ..models import Artifact
    from ..pipeline_checkpoint import S5_STAGE, _outline_slot
    from ..task_daemon import _outline_type_for

    if not inputs.get("pipelineExecutionId") or inputs.get("pipelineStageId") != S5_STAGE:
        return True
    targets = inputs.get("targets")
    if not isinstance(targets, list) or not targets:
        return False
    pins = {}
    def add(ref, kind, slot):
        aid, version = ref["id"], ref["version"]
        if not isinstance(aid, str) or not aid or type(version) is not int or version < 1 or aid in pins:
            raise ValueError("invalid frozen artifact")
        pins[aid] = (version, kind, slot)

    slots = set()
    for target in targets:
        slot = target["episodeNo"]
        if type(slot) is not int or slot < 1 or slot in slots:
            return False
        slots.add(slot)
        add(target["manuscript"], "manuscript", slot)
        add(target["outline_ref"], _outline_type_for(inputs["format"]), slot)
    upstream = inputs["upstreamArtifacts"]
    if not isinstance(upstream, list) or len(upstream) != len(pins) or any(
        type(r["version"]) is not int for r in upstream
    ) or {r["id"]: r["version"] for r in upstream} != {k: v[0] for k, v in pins.items()}:
        return False
    graphs = inputs.get("episodeGraphs", [])
    if not isinstance(graphs, list):
        return False
    for ref in graphs:
        add(ref, "episode_graph", None)
    query = select(Artifact).where(Artifact.id.in_(list(pins)), Artifact.project_id == run.project_id).order_by(Artifact.id)
    rows = session.exec(query.with_for_update() if lock else query).all()
    for row in rows:
        version, kind, slot = pins[row.id]
        if (row.version != version or row.type != kind or row.status in {"archived", "rejected"} or
                (slot and _outline_slot(row.title, row.body_json) != slot)):
            return False
    return len(rows) == len(pins)


def _current_bible_pack(session, run, payload, lock):
    from ..models import MemoryFile
    from ..memory_service import memory_hash, resolve_store_id
    from datetime import datetime
    out = json.loads(payload["result"])
    row = out["row"]
    path = f"/memories/projects/{run.project_id}/bible_pack.md"
    if (out["ok"] is not True or out["path"] != path or row["path"] != path or row["projectId"] != run.project_id
            or row["isHypothesis"] is not False or row["hash"] != out["hash"]):
        return False
    query = select(MemoryFile).where(MemoryFile.path == path, MemoryFile.user_id == _demo_user(),
                                     MemoryFile.project_id == run.project_id)
    current = session.exec(query.with_for_update() if lock else query).first()
    return bool(current and current.store_id in (None, resolve_store_id(path, project_id=run.project_id))
                and not current.is_hypothesis and current.hash == row["hash"] == memory_hash(current.content)
                and current.updated_at == datetime.fromisoformat(row["updatedAt"].replace("Z", "+00:00")))


def _bible_native_pair(steps, result, turn_id, actor, project_id, workdir):
    matches = [s for s in steps if s.kind in {"bash", "tool_call", "tool_result"} and
               s.payload.get("id") == result.get("id") and not s.payload.get("child_run_id")]
    if len(matches) != 1:
        return False
    call = matches[0]
    args = call.payload["args"]
    out = json.loads(result["result"])
    return (call.kind == "tool_call" and not call.payload.get("event") and not result.get("event")
            and call.payload.get("event_id") and result.get("event_id") and not result.get("requiresVerification")
            and not call.payload.get("parent_run_id") and call.actor == actor == "agent:qc.bible_guard" and turn_id
            and call.turn_id == turn_id == call.payload.get("turn_id") == result.get("turn_id")
            and call.payload.get("name") == result.get("name") == "memory_write" and result["status"] == "done"
            and isinstance(result["id"], str) and result["id"]
            and _bible_memory_target(args.get("path"), project_id, workdir) == out["path"]
            and not args.get("isHypothesis") and isinstance(args["content"], str) and
            args.get("expectedHash") != out["hash"] and
            ("expectedHash" not in args or (isinstance(args["expectedHash"], str) and len(args["expectedHash"]) == 64))
            and hashlib.sha256(args["content"].encode()).hexdigest() == out["hash"])


def _bible_steps(session, run):
    return session.exec(select(RunStep).where(RunStep.run_id == run.id,
        RunStep.payload["child_run_id"].as_string().is_(None),
        RunStep.kind.in_(["tool_call", "tool_result", "bash", "steer"])).order_by(RunStep.seq)).all()


def _bible_memory_target(raw, project_id, workdir):
    # Same fleet routing as resolveFleetMemoryPath. An unknown destination needs review.
    if not isinstance(raw, str):
        return None
    raw = raw.strip()
    base = (workdir or "").removesuffix("/")
    if not raw:
        return base + "/note.md"
    if workdir and raw.startswith(base):
        return raw
    if raw.startswith(("/memories/", "memories/")):
        return base + "/" + raw.rstrip("/").split("/")[-1] if base else "/" + raw.lstrip("/")
    return (base or f"/memories/projects/{project_id}") + "/" + raw.lstrip("/")


def _may_change_bible(name, args, project_id, workdir):
    import re

    target = f"/memories/projects/{project_id}/bible_pack.md"
    name = str(name or "").strip().lower().replace(".", "_")
    if name == "tool_invoke":
        if not isinstance(args, dict) or not isinstance(args.get("name"), str):
            return True
        name = args["name"].strip().lower().replace(".", "_")
        args = args.get("args")
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except ValueError:
                return True
        if not name or name == "tool_invoke":
            return True
    args = args if isinstance(args, dict) else {}
    if name in {"memory_write", "bible_write", "memory_merge", "memory_freeze"}:
        return _bible_memory_target(args.get("path"), project_id, workdir) in {None, target}
    if name in {"fs_write", "fs_edit"}:
        path = args.get("path")
        return not isinstance(path, str) or _vfs_path(path) == target
    if name == "bash":
        # Recognize plain read commands only. Execution permission remains in bash.js.
        command = args.get("command")
        return not isinstance(command, str) or not re.fullmatch(
            r"(?:ls|cat|wc|head|tail|grep|git status)(?:[ \t]+[-a-zA-Z0-9_./]+)*"
            r"|git[ \t]+diff|rg(?:[ \t]+[a-zA-Z0-9_./][-a-zA-Z0-9_./]*)+", command.strip())
    return name == "ontology_action"


# Native names eligible for recoverReadonlyRound (toolCatalog.js risk === "read").
# Only used to recognize a repeated ledger call when checking this pack's currency.
_NATIVE_REPLAY_READS = frozenset({
    "ab_pingpong_detect", "artifact_list", "beat20_scaffold", "bible_read", "checklist_open",
    "clip_candidate_extract", "cool_stack_score", "decay_detect", "diff_artifacts", "done_check",
    "duration_risk_flag", "exchange_chain_step", "finger_simplify", "format_scene_header",
    "fs_find", "fs_grep", "fs_ls", "fs_read", "gate_run", "hook_100word_check", "info_asymmetry_tag",
    "kb_read", "kb_search", "lapi_checklist", "line_split_attitude_info_subtext", "location_merge_suggest",
    "memory_get", "memory_grep", "memory_list", "memory_search", "midpoint_locator", "ner_realworld",
    "one_plus_one_suggest", "ontology_query", "option_enumerate", "outline_table", "payoff_ledger",
    "paywall_slots", "project_get", "prompt_4part_build", "prompt_render", "prompt_validate_lock",
    "regex_redline", "same_loc_task_change_check", "scan_banned_phrases", "scan_hook_present", "scan_length",
    "scene_triple_validate", "similarity_heuristic", "speak_aloud_hint", "speak_aloud_lint",
    "spec_pitch_validate", "suspense_budget_check", "trope_coverage", "voice_diversity_score",
    "want_how_concretize", "web_search", "witness_suggest",
})


def _bible_superseded(steps, origin_call_id, project_id, workdir):
    # The native result may omit arguments. Pair it before deciding whether a
    # completed write touched this pack. An outstanding same-target call is uncertain.
    pending = {}
    for step in steps:
        p = step.payload
        if step.kind == "steer" or p.get("id") == origin_call_id:
            return True
        key = (step.turn_id, p.get("id"))
        if step.kind in {"tool_call", "bash"}:
            if key in pending:
                prior = pending[key]
                # recoverReadonlyRound records a second native call before the
                # missing read result. Compare exact typed args, including bools.
                if (all(isinstance(x, str) and x for x in key) and prior.kind == step.kind == "tool_call"
                        and prior.actor == step.actor == "agent:qc.bible_guard"
                        and all(q.get("event_id") and not q.get("event") and not q.get("parent_run_id")
                                for q in (prior.payload, p))
                        and prior.payload.get("turn_id") == p.get("turn_id") == step.turn_id
                        and p.get("name") in _NATIVE_REPLAY_READS
                        # Historical ledger reads and checklist calls could already have written.
                        and p["name"] not in {"payoff_ledger", "checklist_open"}
                        and prior.payload.get("name") == p["name"] and isinstance(p.get("args"), dict)
                        and _bible_input_hash(prior.payload.get("args")) == _bible_input_hash(p["args"])):
                    continue
                return True
            pending[key] = step
            continue
        if step.kind != "tool_result":
            continue
        try:
            outcome = json.loads(p["result"]) if isinstance(p.get("result"), str) else p.get("result")
        except ValueError:
            outcome = None
        outcome = outcome if isinstance(outcome, dict) else {}
        if any(v.get("requiresVerification") is True or v.get("status") in ("unknown_after_interrupt", "mutation_result_unknown")
               or v.get("error") == "mutation_result_unknown" for v in (p, outcome)):
            return True
        recorded = pending.pop(key, None)
        call = recorded.payload if recorded else None
        if call and call.get("name") != p.get("name"):
            return True
        source = call or p
        if _may_change_bible(source.get("name"), source.get("args"), project_id, workdir):
            # This specific executor rejection happens before CAS. The retained
            # digest/precondition check also excludes a coincidental error string.
            args = source.get("args") or {}
            if (call and source.get("name") == "memory_write" and p.get("status") == "error"
                    and outcome.get("ok") is False and outcome.get("error") == "bible_pack_unchanged"
                    and outcome.get("sideEffect") is False and isinstance(args.get("content"), str)
                    and hashlib.sha256(args["content"].encode()).hexdigest() == args.get("expectedHash")):
                continue
            return True
    return any(_may_change_bible(s.payload.get("name"), s.payload.get("args"), project_id, workdir)
               for s in pending.values())


def _current_bible_write(session, run, steps=None, *, lock=False):
    if run.agent_id != "qc.bible_guard":
        return None
    steps = _bible_steps(session, run) if steps is None else steps
    hit = next((s for s in reversed(steps) if s.kind == "tool_result" and s.id.startswith("bible-write:")), None)
    if not hit:
        return None
    try:
        proof = hit.payload["bibleWriteProof"]
        job = session.get(Job, proof["jobId"])
        if (not job or job.result_ref != run.id or job.project_id != run.project_id or job.user_id != _demo_user()
                or job.payload.get("agentId") != run.agent_id or job.payload.get("nested") or job.payload.get("depth")
                or job.status != "running" or run.control_signal is not None):
            return None
        inputs = run.input_json
        if (not isinstance(inputs, dict) or inputs.get("__evalOverrides") is not None
                or proof["admittedInputHash"] != _bible_input_hash(inputs)
                or proof["steerRevision"] != inputs.get("steerRevision")
                or _bible_superseded((s for s in steps if s.seq > hit.seq and not s.payload.get("child_run_id")
                                      and s.kind in {"tool_call", "tool_result", "bash", "steer"}), hit.payload["id"],
                                     run.project_id, job.payload.get("workdir") or inputs.get("fleetWorkdir"))
                or not _current_bible_pack(session, run, hit.payload, lock)
                or not _current_bible_pins(session, run, inputs, lock)):
            return None
        return hit
    except (KeyError, TypeError, ValueError, AttributeError):
        return None


def _accept_bible_candidate(session, run, job, body, actor, candidate):
    if (run.agent_id != "qc.bible_guard" or body.kind != "tool_result" or body.payload.get("name") != "memory_write"
            or job.payload.get("nested") or job.payload.get("depth") or run.input_json.get("__evalOverrides") is not None
            or body.payload.get("child_run_id") or body.payload.get("parent_run_id") or not isinstance(candidate, dict)
            or type(candidate.get("v")) is not int or candidate["v"] != 1
            or not isinstance(candidate.get("workingScope"), str) or len(candidate["workingScope"]) != 64
            or any(c not in "0123456789abcdef" for c in candidate["workingScope"])
            or type(candidate.get("leaseVersion")) is not int or candidate["leaseVersion"] <= 0):
        raise HTTPException(403, "invalid BibleGuard write candidate")
    if not session.execute(update(AgentRun).where(AgentRun.id == run.id, AgentRun.status == "running",
            AgentRun.control_signal.is_(None), AgentRun.lease_version == candidate["leaseVersion"],
            AgentRun.lease_until > utcnow()).values(status="running").execution_options(synchronize_session=False)).rowcount:
        raise HTTPException(409, "stale BibleGuard write candidate")
    session.refresh(run)
    if not session.exec(select(Job.id).where(Job.id == job.id, Job.status == "running").with_for_update()).first():
        raise HTTPException(409, "stale BibleGuard job")
    try:
        digest = _bible_input_hash(run.input_json)
        steps = _bible_steps(session, run)
        if (digest != _bible_input_hash(json.loads(candidate["inputJsonText"]))
                or any(s.kind == "steer" and not s.payload.get("revision") for s in steps)
                or not _bible_native_pair(steps, body.payload, body.turn_id, actor, run.project_id,
                                          job.payload.get("workdir") or run.input_json.get("fleetWorkdir"))
                or not _current_bible_pack(session, run, body.payload, True)
                or not _current_bible_pins(session, run, run.input_json, True)):
            return None
        body.payload["bibleWriteProof"] = dict(v=1, jobId=job.id, leaseVersion=candidate["leaseVersion"],
            workingScope=candidate["workingScope"], admittedInputHash=digest, steerRevision=run.input_json.get("steerRevision"))
        return "bible-write:" + new_id()
    except (KeyError, TypeError, ValueError, AttributeError):
        return None


def _bible_terminal_dependency(envelopes, body):
    """The terminal PATCH sends a compact receipt. Recover its dependency from the acknowledged envelope."""
    if not any("bibleWriteStepId" in (s.payload.get("terminalResult") or {}) for s in envelopes):
        return None
    attestation = (body.get("receipt") or {}).get("attestation")
    matching = [s for s in envelopes if s.actor == "agent:qc.bible_guard" and s.payload.get("status") == "succeeded"
                and s.payload.get("receiptId") == body.get("receiptId") and attestation
                and s.payload.get("attestation") == attestation
                and s.payload.get("terminalResult", {}).get("receipt", {}).get("attestation") == attestation]
    if len(matching) != 1 or matching[0].id != envelopes[-1].id:
        raise HTTPException(409, "ambiguous BibleGuard delivery")
    return matching[0].payload["terminalResult"]


def _check_carried_terminal(session, run, job, result, lease):
    if "bibleWriteStepId" not in result:
        return
    hit = _current_bible_write(session, run, lock=True)
    if (type(lease) is not int or not hit or hit.id != result["bibleWriteStepId"] or hit.payload["bibleWriteProof"]["jobId"] != job.id
            or not 0 < hit.payload["bibleWriteProof"]["leaseVersion"] < lease
            or result.get("steerRevision") != (run.input_json or {}).get("steerRevision")):
        raise HTTPException(409, "BibleGuard write evidence changed")


@router.post("/runs/{run_id}/steps")
def append_run_step(
    run_id: str,
    body: RunStepIn,
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """agent-worker 落库执行步骤（tool_call / tool_result / status / bash）。"""
    # Reserve the SQLite writer before validation reads can establish a WAL
    # snapshot. Never retry an append with an uncertain commit outcome.
    if session.get_bind().dialect.name == "sqlite":
        connection = session.connection()
        if not connection.connection.driver_connection.in_transaction:
            connection.exec_driver_sql("BEGIN IMMEDIATE")
    run = session.get(AgentRun, run_id)
    if not run:
        raise HTTPException(404, "run not found")
    owner = _demo_user()
    owned_project(session, run.project_id, owner)
    job = session.get(Job, body.job_id)
    if (not job or job.type not in {"agent.run", "agent.batch"} or job.user_id != owner or
            job.project_id != run.project_id or job.result_ref != run.id or job.payload.get("agentId") != run.agent_id or
            (job.conversation_id and job.conversation_id != run.conversation_id)):
        raise HTTPException(403, "步骤与已派发任务不匹配")
    conversation_id = run.conversation_id or project_replay_conversation_id(run.project_id, run.id)
    if body.conversation_id and body.conversation_id != conversation_id:
        raise HTTPException(403, "步骤会话与运行不匹配")
    if run.conversation_id:
        from ..models import Conversation
        conv = session.get(Conversation, run.conversation_id)
        if not conv or conv.user_id != owner or (conv.project_id and conv.project_id != run.project_id):
            raise HTTPException(403, "运行会话或所属项目不匹配")
    commission_id = body.payload.get("editorialAdmissionId")
    dispatch_id = None
    if body.kind == "editorial_revision":
        raise HTTPException(403, "修订只能由作者提交")
    if commission_id is not None:
        admission = session.get(RunStep, commission_id) if isinstance(commission_id, str) else None
        if (body.kind != "model_call" or not admission or admission.run_id != run.id or admission.actor != "user"
                or admission.kind != "editorial_revision" or admission.payload.get("jobId") != job.id
                or admission.payload.get("steerRevision") != run.input_json.get("steerRevision")
                or body.payload.get("child_run_id") or body.payload.get("parent_run_id")
                or not session.execute(update(AgentRun).where(AgentRun.id == run.id, AgentRun.status == "running",
                    AgentRun.lease_version == body.payload.get("leaseVersion"), AgentRun.lease_until > utcnow())
                    .values(status="running").execution_options(synchronize_session=False)).rowcount):
            raise HTTPException(409, "作者修订或执行租约已变化")
        dispatch_id = "dispatch:" + commission_id
        if session.get(RunStep, dispatch_id):
            raise HTTPException(409, "本次作者修订已经发出")
    actor_id = run.agent_id
    parent = body.payload.get("parent_run_id")
    child = body.payload.get("child_run_id")
    if child or parent:
        actor_id = _child_actor(session, run.id, parent, child)
    if body.kind == "run_start" and (run.knowledge_role_version or body.payload.get("roleVersion")):
        role = run_role(session, run.id, job.id, owner)
        if body.payload.get("roleVersion") != role["version"]:
            raise HTTPException(409, "知识执行开始记录与已绑定授权不一致")
    actor = actor_id if run.knowledge_role_version or body.actor == actor_id else f"agent:{actor_id}"
    if body.actor and body.actor not in {actor_id, f"agent:{actor_id}"}:
        raise HTTPException(403, "步骤执行同事与任务不匹配")
    if "bibleWriteProof" in body.payload:
        raise HTTPException(403, "write proof is server-issued")
    bible_write_id = None
    if "bibleWriteCandidate" in body.payload:
        bible_write_id = _accept_bible_candidate(session, run, job, body, actor, body.payload.pop("bibleWriteCandidate"))
    admission_id = None
    if body.kind == "subagent" and body.payload.get("phase") == "admitted":
        from ..agent_colleagues import is_agent_colleague_id
        spawned = body.payload.get("spawned_run_id")
        spawner = child or run.id
        if (not is_agent_colleague_id(actor_id) or not is_agent_colleague_id(body.payload.get("agent_id")) or
                body.payload.get("spawning_run_id") != spawner or not isinstance(spawned, str) or
                not spawned.startswith(f"nested_{spawner}_") or not spawned.endswith("_run")):
            raise HTTPException(403, "只能派发本运行下已注册的子岗位")
        admission_id = _child_admission_id(run.id, spawned)
        existing = session.get(RunStep, admission_id)
        if existing:
            if existing.payload.get("agent_id") != body.payload["agent_id"]:
                raise HTTPException(409, "子运行执行身份已绑定")
            return {"ok": True, "id": existing.id, "seq": existing.seq, "conversationId": conversation_id}
    if body.kind == "subagent" and body.payload.get("status") in {"succeeded", "failed", "cancelled"}:
        spawned = body.payload.get("spawned_run_id")
        spawner = child or run.id
        if body.payload.get("spawning_run_id") != spawner:
            raise HTTPException(403, "子运行结果与派单人不匹配")
        _child_actor(session, run.id, spawner, spawned)
        terminal = session.get(RunStep, _child_terminal_id(run.id, spawned))
        if not terminal or terminal.payload.get("status") != body.payload["status"]:
            raise HTTPException(409, "子运行结果缺少匹配的终态收据")
    if "workingContextRef" in body.payload:
        if (body.kind not in {"compaction", "handoff"} or child or parent or
                not session.execute(update(AgentRun).where(AgentRun.id == run.id, AgentRun.status == "running",
                    AgentRun.lease_version == body.payload.get("leaseVersion"), AgentRun.lease_until > utcnow())
                    .values(status="running").execution_options(synchronize_session=False)).rowcount):
            raise HTTPException(409, "stale working context")
        prior = session.exec(select(RunStep).where(RunStep.run_id == run.id,
            RunStep.payload["child_run_id"].as_string().is_(None),
            RunStep.kind.in_(["model_response","reply","tool_call","bash","tool_result","steer"]))
            .order_by(RunStep.seq.desc()).limit(1)).first()
        boundary = (prior.payload.get("event_id") or prior.id) if prior else None
        if body.payload.get("workingContextBoundary") != boundary:
            raise HTTPException(409, "working context does not cover current execution ledger")
    if body.kind == "receipt" and "terminalResult" in body.payload:
        result = body.payload["terminalResult"]
        job = session.get(Job, body.payload.get("jobId"))
        if not job or job.id != body.job_id or job.result_ref != run.id or result.get("runId") != run.id or not session.execute(
            update(AgentRun).where(AgentRun.id == run.id, AgentRun.status == "running",
                AgentRun.lease_version == body.payload.get("leaseVersion"), AgentRun.lease_until > utcnow())
            .values(status="running").execution_options(synchronize_session=False)
        ).rowcount:
            raise HTTPException(409, "stale terminal receipt")
        if "bibleWriteStepId" in result:
            session.refresh(run)
            if (job.status != "running" or run.control_signal or result.get("status") != "succeeded"
                    or child or parent):
                raise HTTPException(409, "stale carried delivery")
            _check_carried_terminal(session, run, job, result, body.payload["leaseVersion"])
    child_id = body.payload.get("child_run_id")
    terminal_id = None
    if body.kind == "run_end" and isinstance(child_id, str) and child_id:
        terminal_id = _child_terminal_id(run_id, child_id)
        existing = session.get(RunStep, terminal_id)
        if existing:
            return {"ok": True, "id": existing.id, "seq": existing.seq, "conversationId": existing.conversation_id}
    row = RunStep(
        id=bible_write_id or dispatch_id or terminal_id or admission_id or new_id(),
        conversation_id=conversation_id,
        run_id=run_id,
        turn_id=body.turn_id,
        seq=next_step_seq(session, conversation_id),
        actor=actor,
        kind=body.kind,
        payload=body.payload or {},
    )
    session.add(row)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        identity = terminal_id or admission_id
        winner = session.get(RunStep, identity) if identity else None
        if admission_id and winner and winner.payload.get("agent_id") != body.payload.get("agent_id"):
            raise HTTPException(409, "子运行执行身份已绑定")
        if winner is None:
            raise
        row = winner
    session.refresh(row)
    return {"ok": True, "id": row.id, "seq": row.seq, "conversationId": conversation_id}


@router.get("/runs/{run_id}/replay")
def get_run_replay(
    run_id: str,
    session: Session = Depends(get_session),
    cursor_rows: bool = False,
) -> dict[str, Any]:
    """单次 Run 全链路回放：状态 + checkpoint + 步骤账本。"""
    from ..models import RunStep

    run = session.get(AgentRun, run_id)
    if not run:
        raise HTTPException(404, "run not found")
    project = owned_project(session, run.project_id, _demo_user())
    steps = list(
        session.exec(
            select(RunStep)
            .where(RunStep.run_id == run_id)
            .order_by(RunStep.seq.asc(), RunStep.created_at.asc())
        ).all()
    )
    from ..pipeline_checkpoint import current_graph_approval
    approval = current_graph_approval(session, run, project) if cursor_rows else None
    bible_write = _current_bible_write(session, run, steps) if run.status == "running" else None
    return {
        "run": {
            **({"currentBibleWriteStepId": bible_write.id} if bible_write else {}),
            **({"currentStageApproval": approval} if approval else {}),
            "id": run.id,
            "projectId": run.project_id,
            "conversationId": run.conversation_id,
            "agentId": run.agent_id,
            "status": run.status,
            "model": run.model,
            "inputJson": run.input_json,
            "outputArtifactIds": run.output_artifact_ids,
            "gateResults": run.gate_results,
            "receiptId": run.receipt_id,
            "tokenPrompt": run.token_prompt,
            "tokenCompletion": run.token_completion,
            "execCheckpoint": run.exec_checkpoint,
            "attempt": run.attempt,
            "createdAt": run.created_at,
            "finishedAt": run.finished_at,
        },
        "steps": [
            {
                "id": s.id,
                "seq": s.seq,
                "actor": s.actor,
                "kind": s.kind,
                "payload": ({k: v for k, v in (s.payload or {}).items() if k in {"turn_id", "event_id", "child_run_id"}}
                            if s.kind == "thinking" else s.payload),
                "runId": s.run_id,
                "turnId": s.turn_id,
                "createdAt": s.created_at,
            }
            for s in steps if cursor_rows or s.kind != "thinking"
        ],
    }


@router.patch("/jobs/{job_id}/status", response_model=JobOut)
def patch_job_status(
    job_id: str,
    body: dict,
    session: Session = Depends(get_session),
) -> Job:
    """Worker 回写 Job 状态（Pi agent-worker / job-worker 共用）。"""
    job = session.get(Job, job_id)
    if not job:
        raise HTTPException(404, "job not found")
    status = str(body.get("status") or "").strip()
    if not status:
        raise HTTPException(400, "status required")
    job.status = status
    if status == "running" and not job.started_at:
        job.started_at = utcnow()
    if status in _TERMINAL:
        job.finished_at = utcnow()
    if status == "queued":
        job.finished_at = None
        job.error = str(body["error"]) if body.get("error") else job.error
    if body.get("error") and status != "queued":
        job.error = str(body["error"])
    if body.get("attempts") is not None:
        job.attempts = max(0, int(body["attempts"]))
    if body.get("resultRef"):
        job.result_ref = str(body["resultRef"])
    session.add(job)
    if status in _TERMINAL:
        session.add(
            ActivityLog(
                actor="system",
                action="job_finish",
                summary=f"任务 {job.type} {status}",
                project_id=job.project_id,
                detail={"job_id": job.id, "status": status, "error": job.error},
            )
        )
    session.commit()
    session.refresh(job)
    publish_job_event(
        job.id,
        {"type": "status", "status": status, "jobId": job.id, "error": job.error},
    )
    # Worker 自动重试：重新入队 Redis / 内存队列
    if status == "queued" and str(job.type or "").startswith("agent."):
        enqueue_job(job.id, {"type": job.type, "payload": job.payload})
    if status in _TERMINAL:
        _maybe_announce_job(session, job, status)
    return job


@router.patch("/runs/{run_id}/status", response_model=AgentRunOut)
def patch_run_status(
    run_id: str,
    body: dict,
    session: Session = Depends(get_session),
) -> AgentRun:
    """Worker 回写 AgentRun 状态。"""
    run = session.get(AgentRun, run_id)
    if not run:
        raise HTTPException(404, "run not found")
    status = str(body.get("status") or "").strip()
    if not status:
        raise HTTPException(400, "status required")
    # Fencing：带 leaseVersion 的写入必须与当前租约一致，旧 worker（已被回收）不能覆盖新状态
    if body.get("leaseVersion") is not None:
        try:
            lv = int(body["leaseVersion"])
        except (TypeError, ValueError):
            lv = -1
        if lv != int(run.lease_version or 0):
            raise HTTPException(409, {"error": "lease_lost", "runId": run_id})
    terminal_job = None
    if body.get("terminalJobId"):
        terminal_job = session.get(Job, body["terminalJobId"])
        if (not terminal_job or terminal_job.result_ref != run.id or terminal_job.project_id != run.project_id
                or body.get("leaseVersion") is None or status not in _TERMINAL):
            raise HTTPException(409, "invalid terminal delivery")
        recorded = next((g.get("receipt") for g in run.gate_results if g.get("type") == "receipt"), None)
        if (run.status == terminal_job.status == status and run.receipt_id == body.get("receiptId")
                and recorded == body.get("receipt")):
            return run
        # Take a conditional write lock on both rows before recording either terminal state.
        if not session.execute(update(AgentRun).where(AgentRun.id == run_id, AgentRun.status == "running",
                AgentRun.lease_version == lv, AgentRun.lease_until > utcnow()).values(status=status)
                .execution_options(synchronize_session=False)).rowcount:
            session.rollback()
            # The competing transaction may have committed the exact same terminal receipt.
            session.refresh(run)
            session.refresh(terminal_job)
            if (run.status == terminal_job.status == status and run.lease_version == lv
                    and run.receipt_id == body.get("receiptId") and next((g.get("receipt") for g in run.gate_results
                    if g.get("type") == "receipt"), None) == body.get("receipt")):
                return run
            raise HTTPException(409, "stale terminal delivery")
        session.refresh(run)
        expected_revision = (run.input_json or {}).get("steerRevision")
        if expected_revision != body.get("steerRevision"):
            # An accepted instruction supersedes this delivery, even if the interrupt
            # notification or the worker that drained its mailbox was lost.
            if not session.execute(update(Job).where(Job.id == terminal_job.id,
                    Job.status.in_(["running", "queued"])).values(status="queued", finished_at=None)).rowcount:
                session.rollback()
                raise HTTPException(409, "job state changed")
            run.status = "queued"
            run.lease_owner = run.lease_until = None
            run.lease_version = lv + 1
            run.progress_stage = "已接收追加指令，等待继续"
            session.add(run)
            session.flush()
            queued = AgentRunOut.model_validate(run)
            session.commit()
            enqueue_job(terminal_job.id, {"type": terminal_job.type, "payload": terminal_job.payload})
            return queued
        if run.agent_id == "qc.bible_guard" and status == "succeeded":
            envelopes = session.exec(select(RunStep).where(RunStep.run_id == run.id, RunStep.kind == "receipt",
                RunStep.payload["child_run_id"].as_string().is_(None),
                RunStep.payload["jobId"].as_string() == terminal_job.id).order_by(RunStep.seq)).all()
            dependency = _bible_terminal_dependency(envelopes, body)
            if dependency is not None:
                _check_carried_terminal(session, run, terminal_job, dependency, lv)
        if not session.execute(update(Job).where(Job.id == terminal_job.id, Job.status.in_(["queued","running",status]))
                .values(status=status, finished_at=utcnow())).rowcount:
            session.rollback()
            raise HTTPException(409, "job state changed")
    if run.status == "paused" and status in {"failed", "cancelled"} and body.get("leaseVersion") is not None:
        # worker 因 pause 中断时不应把 run 写成失败
        raise HTTPException(409, {"error": "run_paused", "runId": run_id})
    run.status = status
    if status != "running":
        run.lease_owner = None
        run.lease_until = None
    if body.get("error"):
        # AgentRun 无独立 error 列：记入 gate_results 末条
        gates = list(run.gate_results or [])
        gates.append({"type": "worker_error", "message": str(body["error"])})
        run.gate_results = gates
    if "outputArtifactIds" in body and isinstance(body["outputArtifactIds"], list):
        run.output_artifact_ids = [str(x) for x in body["outputArtifactIds"]]
    if (body.get("receipt") or {}).get("exitReason") == "pending_human_ack" and (
        run.input_json.get("pipelineExecutionId") or run.input_json.get("qaSourceVersions")
    ) and run.agent_id in {"qc.human_checklist", "qc.human_qc_duanju"}:
        run.approval_state = "waiting"
    if body.get("receiptId"):
        run.receipt_id = str(body["receiptId"])
    if "gateResults" in body and isinstance(body["gateResults"], list):
        run.gate_results = list(body["gateResults"])
    if body.get("tokenPrompt") is not None:
        try:
            run.token_prompt = int(body["tokenPrompt"])
        except (TypeError, ValueError):
            pass
    if body.get("tokenCompletion") is not None:
        try:
            run.token_completion = int(body["tokenCompletion"])
        except (TypeError, ValueError):
            pass
    # 收据 narrative / attestation 写入 gate_results 尾部元数据，避免改表
    if body.get("receipt"):
        gates = list(run.gate_results or [])
        gates.append({"type": "receipt", "receipt": body["receipt"]})
        run.gate_results = gates
        if not run.receipt_id and isinstance(body["receipt"], dict):
            run.receipt_id = str(body["receipt"].get("runId") or run.id)
            if run.receipt_id and not str(run.receipt_id).startswith("receipt_"):
                run.receipt_id = f"receipt_{run.receipt_id}"
    if status in _TERMINAL:
        run.finished_at = utcnow()
    session.add(run)

    # Actual turn events cover all paused/resumed attempts. They already charged
    # project usage; a terminal worker's latest-attempt counters must not replace
    # the full run totals or create a second aggregate charge.
    if status in _TERMINAL:
        from sqlalchemy import func

        event_count, prompt_total, completion_total = session.exec(
            select(
                func.count(UsageEvent.id),
                func.coalesce(func.sum(UsageEvent.prompt_tokens), 0),
                func.coalesce(func.sum(UsageEvent.completion_tokens), 0),
            ).where(UsageEvent.run_id == run.id, ~UsageEvent.id.startswith(DIGEST_EVENT_PREFIX))
        ).one()
        if event_count:
            run.token_prompt = int(prompt_total)
            run.token_completion = int(completion_total)
        elif run.token_prompt or run.token_completion:
            # Legacy workers without turn events retain one aggregate event.
            try:
                cache_hit = int(body.get("tokenCacheHit") or 0)
            except (TypeError, ValueError):
                cache_hit = 0
            try:
                cache_miss = int(body.get("tokenCacheMiss") or 0)
            except (TypeError, ValueError):
                cache_miss = 0
            session.add(
                UsageEvent(
                    user_id=get_settings().demo_user_id,
                    project_id=run.project_id,
                    run_id=run.id,
                    agent_id=run.agent_id,
                    bot_id=run.agent_id if (run.input_json or {}).get("pipelineExecutionId") else None,
                    model=run.model or resolve_default_model(),
                    prompt_tokens=int(run.token_prompt or 0),
                    completion_tokens=int(run.token_completion or 0),
                    cache_hit_tokens=cache_hit,
                    cache_miss_tokens=cache_miss,
                )
            )
            if run.project_id:
                increment_project_tokens(session, run.project_id,
                                         int(run.token_prompt or 0) + int(run.token_completion or 0))
    if terminal_job and run.conversation_id:
        from ..thread_router import deliver_completion
        session.flush()
        deliver_completion(session, run, status)
    session.commit()
    session.refresh(run)
    # 补全编排：run 成功落库后采纳本步产物（按 created_by_run_id 写回原处）。
    # 采纳失败不应让状态回写失败，故吞掉异常并记录。
    if status == "succeeded":
        try:
            from ..task_daemon import adopt_post_run

            adopt_post_run(session, run)
        except Exception:  # noqa: BLE001
            logger.exception("adopt_post_run failed for run %s", run_id)
    if status in _TERMINAL:
        _maybe_announce_run(session, run, status)
        if status in {"succeeded", "failed"}:
            # 决策摘要（narrator）：run 结束后入队 run.digest job
            try:
                _enqueue_run_digest(session, run, terminal_job.user_id if terminal_job else _demo_user())
            except Exception:  # noqa: BLE001
                session.rollback()
                logger.exception("enqueue run.digest failed for run %s", run_id)
    return run
