"""Memory Store 挂载 + Dreaming PR 提案 API。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import update
from sqlmodel import Session, select

from ..agent_colleagues import agent_id_from_bot_id
from ..db import get_session
from ..dream_sources import check_dream_scope, conversation_changes, current_change, target_allowed
from ..memory_service import (
    apply_dream_merge,
    _private_store_ids,
    scoped_memory_files,
    build_dream_changes_from_scan,
    build_lessons_consolidation,
    default_mounts_for_project,
    ensure_default_stores,
    ensure_store,
    resolve_mount_store,
)
from ..models import DreamChange, DreamJob, MemoryMount, MemoryStore, utcnow
from ..schemas import (
    DreamChangeOut,
    DreamChangePatchIn,
    DreamCreateIn,
    DreamJobOut,
    MemoryMountIn,
    MemoryMountOut,
    MemoryStoreCreateIn,
    MemoryStoreOut,
)

router = APIRouter(tags=["memory-ext"])


def _scoped_job(session, dream_id, *, write=False):
    if write:
        session.execute(update(DreamJob).where(DreamJob.id == dream_id).values(id=DreamJob.id))
        session.expire_all()
    job = session.get(DreamJob, dream_id)
    if not job:
        raise HTTPException(404, "dream not found")
    check_dream_scope(session, job)
    return job


def _job_out(session: Session, job: DreamJob) -> DreamJobOut:
    changes = list(
        session.exec(
            select(DreamChange)
            .where(DreamChange.dream_job_id == job.id)
            .order_by(DreamChange.path)
        )
    )
    base = DreamJobOut.model_validate(job)
    base.changes = []
    for ch in changes:
        view = DreamChangeOut.model_validate(ch)
        if not current_change(session, job, ch):
            view = view.model_copy(update=dict(path="（来源已失效）", status="conflict",
                before_content="", after_content="", edited_content=None, provenance=None,
                rationale="", conflict_detail="来源或范围已改变，请重新扫描"))
            base.report_markdown = "部分来源已失效，请重新扫描。"
        base.changes.append(view)
    return base


@router.get("/memory/stores", response_model=list[MemoryStoreOut])
def list_stores(
    project_id: str | None = Query(default=None),
    session: Session = Depends(get_session),
) -> list[MemoryStore]:
    ensure_default_stores(session, project_id=project_id)
    rows = list(session.exec(select(MemoryStore).order_by(MemoryStore.id)))
    if project_id:
        private_options = {}
        for row in rows:
            owner, aliases = _private_store_ids(row.id)
            if not owner or row.status == "retired" or aliases[0] in private_options:
                continue
            if scoped_memory_files(session, aliases[0], project_id):
                private_options[aliases[0]] = row.model_copy(update={"id": aliases[0], "shared": False})
        rows = [
            r
            for r in rows
            if r.kind in {"org", "user"}
            or r.scope_ref == project_id
            or (r.id.startswith(f"project.{project_id}."))
        ]
        rows.extend(private_options.values())
    return [r for r in rows if r.status != "retired"]


@router.post("/memory/stores", response_model=MemoryStoreOut)
def create_store(
    body: MemoryStoreCreateIn,
    session: Session = Depends(get_session),
) -> MemoryStore:
    sid = body.id or f"{body.kind}.{body.scope_ref or 'custom'}"
    existing = session.get(MemoryStore, sid)
    if existing:
        raise HTTPException(400, f"store already exists: {sid}")
    return ensure_store(
        session,
        sid,
        name=body.name,
        kind=body.kind,
        scope_ref=body.scope_ref,
        description=body.description,
        shared=body.shared,
    )


@router.get("/memory/stores/{store_id}", response_model=MemoryStoreOut)
def get_store(store_id: str, session: Session = Depends(get_session)) -> MemoryStore:
    row = session.get(MemoryStore, store_id)
    if not row:
        raise HTTPException(404, "store not found")
    return row


@router.post("/memory/stores/{store_id}/retire", response_model=MemoryStoreOut)
def retire_store(store_id: str, session: Session = Depends(get_session)) -> MemoryStore:
    row = session.get(MemoryStore, store_id)
    if not row:
        raise HTTPException(404, "store not found")
    if row.kind == "org":
        raise HTTPException(400, "org store cannot be retired")
    row.status = "retired"
    row.updated_at = utcnow()
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@router.get("/memory/mounts", response_model=list[MemoryMountOut])
def list_mounts(
    conversation_id: str | None = Query(default=None),
    run_id: str | None = Query(default=None),
    session: Session = Depends(get_session),
) -> list[MemoryMountOut]:
    rows = list(session.exec(select(MemoryMount).order_by(MemoryMount.priority.desc())))
    if conversation_id:
        rows = [r for r in rows if r.conversation_id == conversation_id]
    if run_id:
        rows = [r for r in rows if r.run_id == run_id]
    return [MemoryMountOut.model_validate(row).model_copy(update={
        "agent_id": agent_id_from_bot_id(row.agent_id),
    }) for row in rows]


@router.post("/memory/mounts", response_model=MemoryMountOut)
def create_mount(
    body: MemoryMountIn,
    session: Session = Depends(get_session),
) -> MemoryMount:
    agent_id = agent_id_from_bot_id(body.agent_id)
    store_id = resolve_mount_store(session, body.store_id, agent_id, body.conversation_id, body.run_id)
    if not session.get(MemoryStore, store_id):
        ensure_store(session, store_id)
    m = MemoryMount(
        store_id=store_id,
        conversation_id=body.conversation_id,
        run_id=body.run_id,
        agent_id=agent_id,
        access=body.access if body.access in {"read_only", "read_write"} else "read_write",
        prompt_hint=body.prompt_hint,
        priority=body.priority,
    )
    session.add(m)
    session.commit()
    session.refresh(m)
    return m


@router.post("/memory/mounts/bootstrap", response_model=list[MemoryMountOut])
def bootstrap_mounts(
    project_id: str = Query(...),
    conversation_id: str | None = Query(default=None),
    run_id: str | None = Query(default=None),
    agent_id: str | None = Query(default=None),
    session: Session = Depends(get_session),
) -> list[MemoryMount]:
    return default_mounts_for_project(
        session,
        project_id=project_id,
        conversation_id=conversation_id,
        run_id=run_id,
        agent_id=agent_id,
    )


@router.get("/memory/dreams", response_model=list[DreamJobOut])
def list_dreams(
    project_id: str | None = Query(default=None),
    store_id: str | None = Query(default=None),
    session: Session = Depends(get_session),
) -> list[DreamJobOut]:
    query = select(DreamJob)
    if project_id:
        query = query.where(DreamJob.project_id == project_id)
    if store_id:
        query = query.where(DreamJob.store_id == store_id)
    result = []
    for job in session.exec(query.order_by(DreamJob.created_at.desc()).limit(50)):
        try:
            check_dream_scope(session, job)
        except HTTPException:
            continue
        result.append(_job_out(session, job))
    return result


@router.post("/memory/dreams", response_model=DreamJobOut)
def create_dream(
    body: DreamCreateIn,
    session: Session = Depends(get_session),
) -> DreamJobOut:
    return propose_dream(session, body)


def propose_dream(session: Session, body: DreamCreateIn, *, created_by="user") -> DreamJobOut:
    project_id = body.project_id
    store_id = body.store_id
    if not store_id:
        if not project_id:
            raise HTTPException(400, "store_id 或 project_id 必填其一")
        store_id = f"project.{project_id}.bible"
    job = DreamJob(
        store_id=store_id,
        project_id=project_id,
        status="running",
        title=body.title or "Dreaming 巩固",
        window_hours=body.window_hours,
        session_ids=body.session_ids or [],
        run_ids=body.run_ids or [],
        instructions=body.instructions or "",
        created_by=created_by,
    )
    check_dream_scope(session, job, selectors=True)
    try:
        # The job insert takes the SQLite write lock before dedupe and source selection.
        session.add(job)
        session.flush()
        ensure_store(session, store_id, commit=False)
        if job.session_ids or job.run_ids:
            changes, report = [], "已扫描指定来源。"
        elif store_id.startswith("agent."):
            changes, report = build_lessons_consolidation(session, store_id=store_id, project_id=project_id)
        else:
            changes, report = build_dream_changes_from_scan(session, store_id=store_id, project_id=project_id,
                                                           window_hours=job.window_hours)
        grounded = conversation_changes(session, job)
        changes.extend(grounded)
        report += f"\n新增会话候选：{len(grounded)}"
        for candidate in changes:
            ch = DreamChange(dream_job_id=job.id, status="pending", **candidate)
            if target_allowed(session, job, ch):
                session.add(ch)
        job.report_markdown = report
        job.status = "ready"
        job.finished_at = utcnow()
        job.token_estimate = sum(
            len(c.get("after_content") or "") + len(c.get("before_content") or "")
            for c in changes
        )
        session.add(job)
        session.commit()
        session.refresh(job)
    except Exception as exc:  # noqa: BLE001
        session.rollback()
        job.status = "failed"
        job.error = f"扫描失败（{type(exc).__name__}），请重新发起。"
        job.finished_at = utcnow()
        session.add(job)
        session.commit()
        session.refresh(job)

    return _job_out(session, job)


@router.get("/memory/dreams/{dream_id}", response_model=DreamJobOut)
def get_dream(dream_id: str, session: Session = Depends(get_session)) -> DreamJobOut:
    job = _scoped_job(session, dream_id)
    return _job_out(session, job)


@router.patch("/memory/dreams/{dream_id}/changes/{change_id}", response_model=DreamChangeOut)
def patch_dream_change(
    dream_id: str,
    change_id: str,
    body: DreamChangePatchIn,
    session: Session = Depends(get_session),
) -> DreamChange:
    job = _scoped_job(session, dream_id, write=True)
    ch = session.get(DreamChange, change_id)
    if not ch or ch.dream_job_id != dream_id:
        raise HTTPException(404, "change not found")
    if ch.status not in {"pending", "accepted"} or job.status not in {"ready", "partial"}:
        raise HTTPException(409, "此变更已关闭")
    if not current_change(session, job, ch):
        raise HTTPException(409, "来源或范围已改变，请重新扫描")
    if body.edited_content is not None:
        ch.edited_content = body.edited_content
        ch.status = "pending"
    if body.status is not None:
        if body.status not in {"pending", "accepted", "rejected"}:
            raise HTTPException(400, "invalid status")
        ch.status = body.status
    session.add(ch)
    session.commit()
    session.refresh(ch)
    return ch


@router.post("/memory/dreams/{dream_id}/accept-all", response_model=DreamJobOut)
def accept_all_dream_changes(
    dream_id: str,
    session: Session = Depends(get_session),
) -> DreamJobOut:
    job = _scoped_job(session, dream_id, write=True)
    changes = list(
        session.exec(select(DreamChange).where(DreamChange.dream_job_id == dream_id))
    )
    for ch in changes:
        if ch.status == "pending" and current_change(session, job, ch):
            ch.status = "accepted"
            session.add(ch)
    session.commit()
    return _job_out(session, job)


@router.post("/memory/dreams/{dream_id}/merge")
def merge_dream(dream_id: str, session: Session = Depends(get_session)) -> dict:
    job = _scoped_job(session, dream_id)
    return apply_dream_merge(session, job)


@router.post("/memory/dreams/{dream_id}/reject", response_model=DreamJobOut)
def reject_dream(dream_id: str, session: Session = Depends(get_session)) -> DreamJobOut:
    job = _scoped_job(session, dream_id, write=True)
    job.status = "rejected"
    job.finished_at = job.finished_at or utcnow()
    session.add(job)
    changes = list(
        session.exec(select(DreamChange).where(DreamChange.dream_job_id == dream_id))
    )
    for ch in changes:
        if ch.status in {"pending", "accepted"}:
            ch.status = "rejected"
            session.add(ch)
    session.commit()
    session.refresh(job)
    return _job_out(session, job)
