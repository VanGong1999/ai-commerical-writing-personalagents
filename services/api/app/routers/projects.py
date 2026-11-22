from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select
from sqlalchemy import update
from pydantic import BaseModel, ConfigDict, Field

from ..db import get_session
from ..models import (
    ActivityLog,
    AgentRun,
    AnalysisReport,
    AnalyticsSnapshot,
    Artifact,
    ArtifactVersion,
    Job,
    KbBinding,
    KnowledgeDoc,
    MemoryFile,
    Project,
    ProjectSnapshot,
    ProjectStageEvent,
    SwapPlan,
    TaskProposal,
    UsageEvent,
    new_id,
    utcnow,
)
from ..schemas import (
    ArtifactOut,
    AdoptArtifactIn,
    CreateArtifactIn,
    CreateProjectIn,
    CreateSnapshotIn,
    PatchProjectIn,
    PatchArtifactIn,
    ProjectOut,
    ProjectSnapshotOut,
)
from ..gates import can_strong_adopt, check_core_hook_adoption
from ..seed import DEMO_USER

router = APIRouter(prefix="/projects", tags=["projects"])

INITIAL_STAGE = {
    "manju": "S0_SETUP",
    "duanju": "S0_PRODUCT",
    "short_novel": "S0_SETUP",
    "male_long": "S0_SETUP",
    "female_long": "S0_SETUP",
    "ip_adapt": "S0_SETUP",
}

PACK_ID_BY_FORMAT = {
    "manju": "pack.manju.default",
    "duanju": "pack.duanju.default",
    "short_novel": "pack.short.default",
    "male_long": "pack.male.default",
    "female_long": "pack.female.default",
    "ip_adapt": "pack.ip.default",
}


def _lock_project_stage(session: Session, project: Project) -> bool:
    """Serialize stage revisions on SQLite as well as row-locking databases."""
    locked = session.execute(update(Project).where(Project.id == project.id)
                             .values(stage=Project.stage).execution_options(synchronize_session=False))
    if locked.rowcount != 1:
        return False
    session.refresh(project, attribute_names=["stage", "status", "user_id", "format"])
    return True


def _set_stage(
    session: Session,
    project: Project,
    new_stage: str,
    *,
    actor: str = "user",
    reason: str = "",
) -> ProjectStageEvent | None:
    """Persist a stage transition and return its audit revision in this transaction."""
    if not new_stage or not _lock_project_stage(session, project) or project.stage == new_stage:
        return None
    event = ProjectStageEvent(project_id=project.id, from_stage=project.stage or None,
                              to_stage=new_stage, actor=actor, reason=reason)
    session.add(event)
    project.stage = new_stage
    project.updated_at = utcnow()
    session.add(project)
    return event


def _generation_actor(session: Session, project_id: str, run_id: str | None, default: str) -> str:
    if not run_id:
        return default
    run = session.get(AgentRun, run_id)
    if not run or run.project_id != project_id or run.status != "running":
        raise ValueError("invalid_generation_run")
    return f"agent:{run.id}"


def _snapshot_version(session: Session, art: Artifact, *, actor: str = "user",
                      note: str | None = None, expected_version: int | None = None) -> ArtifactVersion:
    version = art.version if expected_version is None else expected_version
    session.flush()
    # A conditional write locks the parent even on SQLite, where FOR UPDATE is ignored.
    locked = session.execute(update(Artifact).where(Artifact.id == art.id,
        Artifact.version == version).values(version=Artifact.version)
        .execution_options(synchronize_session=False))
    if locked.rowcount != 1:
        raise HTTPException(409, "artifact_version_conflict")
    session.refresh(art)
    payload = {key: getattr(art, key) for key in ("title", "status", "body_markdown", "body_json")}
    existing = session.exec(select(ArtifactVersion).where(
        ArtifactVersion.artifact_id == art.id, ArtifactVersion.version == art.version)
        .order_by(ArtifactVersion.created_at, ArtifactVersion.id)).all()
    if any(any(getattr(row, key) != value for key, value in payload.items()) for row in existing):
        raise HTTPException(409, "artifact_snapshot_evidence_conflict")
    if existing:
        return existing[0]
    row = ArtifactVersion(artifact_id=art.id, version=art.version, actor=actor, note=note, **payload)
    session.add(row)
    session.flush()
    return row


def _capture_baseline(session: Session, art: Artifact, source: str,
                      expected_version: int | None = None) -> ArtifactVersion:
    return _snapshot_version(session, art, actor="system", expected_version=expected_version,
                             note=f"Recovered baseline from current artifact ({source})")


def recover_current_version(session: Session, *, user_id: str, project_id: str,
                            artifact_id: str, expected_version: int) -> ArtifactVersion:
    project = session.get(Project, project_id)
    art = session.get(Artifact, artifact_id)
    if not project or project.user_id != user_id or not art or art.project_id != project_id:
        raise ValueError("project_boundary:artifact")
    if art.version != expected_version:
        raise HTTPException(409, "artifact_version_conflict")
    return _capture_baseline(session, art, "explicit repair", expected_version)


def _log_activity(
    session: Session,
    *,
    actor: str,
    action: str,
    summary: str,
    project_id: str | None = None,
    detail: dict | None = None,
) -> None:
    session.add(
        ActivityLog(
            actor=actor,
            action=action,
            summary=summary,
            project_id=project_id,
            detail=detail or {},
        )
    )


@router.get("", response_model=list[ProjectOut])
def list_projects(
    format: str | None = None,
    status: str | None = None,
    q: str | None = None,
    genre: str | None = None,
    session: Session = Depends(get_session),
) -> list[Project]:
    stmt = select(Project).order_by(Project.last_opened_at.desc())
    rows = list(session.exec(stmt))
    # 评测沙箱项目不进入普通列表 / 看板
    if status != "eval_sandbox":
        rows = [p for p in rows if p.status != "eval_sandbox"]
    if format:
        rows = [p for p in rows if p.format == format]
    if status:
        rows = [p for p in rows if p.status == status]
    if genre:
        rows = [p for p in rows if any(genre in t for t in p.genre_tags)]
    if q:
        ql = q.lower()
        rows = [p for p in rows if ql in p.title.lower() or any(ql in t.lower() for t in p.genre_tags)]
    return rows


def create_project_impl(session: Session, body: CreateProjectIn) -> Project:
    """新建项目（含 start_from 起点落地），供路由与 Personal Agent Supervisor 共用。"""
    project = Project(
        user_id=DEMO_USER,
        title=body.title,
        format=body.format,
        genre_tags=body.genre_tags,
        market=body.market,
        stage="",
        cover_meta=body.cover_meta,
        prompt_pack_id=body.prompt_pack_id or PACK_ID_BY_FORMAT[body.format],
    )
    session.add(project)
    session.flush()
    _set_stage(
        session,
        project,
        INITIAL_STAGE[body.format],
        actor="user",
        reason="新建项目",
    )

    # 起点落地：从知识库拆书 / 从 IP 原文导入时，把对标报告带进项目。
    if body.source_doc_id and body.start_from in {"kb_dissect", "ip"}:
        doc = session.get(KnowledgeDoc, body.source_doc_id)
        report = None
        if doc:
            report = session.exec(
                select(AnalysisReport).where(
                    AnalysisReport.doc_id == doc.id,
                    AnalysisReport.report_type == "dissect_params",
                )
            ).first()
        if doc and report:
            project.cover_meta = {
                **(project.cover_meta or {}),
                "benchmark": doc.title,
                "sourceDocId": doc.id,
            }
            session.add(
                Artifact(
                    project_id=project.id,
                    type="dissect_params",
                    title=f"拆书参数 · {doc.title}",
                    status="candidate",
                    body_markdown=report.body_markdown,
                    body_json={
                        "sourceDocId": doc.id,
                        "reportId": report.id,
                        "reportType": report.report_type,
                    },
                )
            )
            if body.start_from == "kb_dissect":
                if project.format == "short_novel":
                    _set_stage(session, project, "S1_DISSECT", reason="知识库拆书导入")
                elif project.format == "male_long":
                    _set_stage(session, project, "S1_TOPIC_SCAN", reason="知识库拆书导入")
                elif project.format == "female_long":
                    _set_stage(session, project, "S1_TOPIC", reason="知识库拆书导入")
            elif body.start_from == "ip" and project.format == "ip_adapt":
                _set_stage(session, project, "S1_IP_EVAL", reason="IP 原文导入")

    # 起点落地：从已有核心梗起步（把已选核心梗载入为 artifact，避免丢失）。
    if body.start_from == "existing_hook":
        hook = (
            body.cover_meta.get("hook")
            or body.cover_meta.get("coreHook")
            or body.cover_meta.get("core_hook")
        )
        logline = body.cover_meta.get("logline")
        if hook or logline:
            if isinstance(hook, dict):
                hook_json = dict(hook)
                hook_title = str(hook.get("title") or "已选核心梗")
                hook_md = str(
                    hook.get("summary")
                    or hook.get("logline")
                    or hook.get("title")
                    or logline
                    or ""
                )
            else:
                hook_json = {"summary": str(hook or ""), "logline": str(logline or "")}
                hook_title = "已选核心梗"
                hook_md = str(hook or logline or "")
            session.add(
                Artifact(
                    project_id=project.id,
                    type="core_hook",
                    title=hook_title,
                    status="candidate",
                    body_markdown=hook_md,
                    body_json=hook_json,
                )
            )
            if project.format == "manju":
                _set_stage(session, project, "S2_HOOK_SELECT", reason="已有核心梗起点")
            elif project.format == "short_novel":
                _set_stage(session, project, "S1_DISSECT", reason="已有核心梗起点")
    session.commit()
    session.refresh(project)
    return project


@router.post("", response_model=ProjectOut)
def create_project(
    body: CreateProjectIn,
    session: Session = Depends(get_session),
) -> Project:
    return create_project_impl(session, body)


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(
    project_id: str,
    session: Session = Depends(get_session),
) -> Project:
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "project not found")
    project.last_opened_at = utcnow()
    session.add(project)
    session.commit()
    session.refresh(project)
    return project


@router.patch("/{project_id}", response_model=ProjectOut)
def patch_project(
    project_id: str,
    body: PatchProjectIn,
    session: Session = Depends(get_session),
) -> Project:
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "project not found")
    data = body.model_dump(exclude_unset=True)
    new_stage = data.pop("stage", None)
    for k, v in data.items():
        setattr(project, k, v)
    if new_stage is not None:
        _set_stage(session, project, new_stage, actor="user", reason="手动推进/调整阶段")
    project.updated_at = utcnow()
    session.add(project)
    session.commit()
    session.refresh(project)
    return project


@router.delete("/{project_id}")
def delete_project(
    project_id: str,
    session: Session = Depends(get_session),
) -> dict[str, str]:
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "project not found")
    arts = session.exec(select(Artifact).where(Artifact.project_id == project_id)).all()
    art_ids = [a.id for a in arts]
    if art_ids:
        for av in session.exec(select(ArtifactVersion).where(ArtifactVersion.artifact_id.in_(art_ids))).all():
            session.delete(av)
    for a in arts:
        session.delete(a)
    for model in (
        AgentRun,
        Job,
        UsageEvent,
        MemoryFile,
        KbBinding,
        ProjectSnapshot,
        ProjectStageEvent,
        SwapPlan,
        TaskProposal,
        AnalyticsSnapshot,
    ):
        for row in session.exec(select(model).where(model.project_id == project_id)).all():
            session.delete(row)
    # 操作审计不随项目物理删除：代理人/用户代操作需可追溯（Hermes/OpenClaw 账本语义）
    for row in session.exec(select(ActivityLog).where(ActivityLog.project_id == project_id)).all():
        row.project_id = None
        detail = dict(row.detail or {})
        detail.setdefault("deletedProjectId", project_id)
        row.detail = detail
        session.add(row)
    session.delete(project)
    session.commit()
    return {"status": "deleted"}


@router.get("/{project_id}/artifacts", response_model=list[ArtifactOut])
def list_artifacts(
    project_id: str,
    type: str | None = Query(default=None, alias="type"),
    session: Session = Depends(get_session),
) -> list[Artifact]:
    if not session.get(Project, project_id):
        raise HTTPException(404, "project not found")
    rows = list(session.exec(select(Artifact).where(Artifact.project_id == project_id)))
    if type:
        rows = [a for a in rows if a.type == type]
    return rows


def _record_content_edit(session: Session, artifact: Artifact, previous_version: int, content_changed: bool) -> None:
    project = session.get(Project, artifact.project_id)
    if not project:
        return
    # Artifact writers hold their versioned write lock here. Flush any earlier
    # edits in this transaction, then reload the approval map after acquiring it.
    session.flush()
    session.refresh(project, attribute_names=["progress"])
    progress = dict(project.progress or {})
    versions = dict(progress.get("logicAckVersions") or {})
    if not content_changed:
        if versions.get(artifact.id) == previous_version:
            versions[artifact.id] = artifact.version
            progress["logicAckVersions"] = versions
    else:
        artifact.adopted_at = None
        if artifact.status == "adopted":
            artifact.status = "draft"
        session.add(artifact)
        progress.update({"logicAck": False, "logicAckAt": None, "logic_ack": 0, "logic_ack_at": None})
        reviews = dict(progress.get("artifactReviewRequired") or {})
        descendants = {artifact.id}
        rows = list(session.exec(select(Artifact).where(Artifact.project_id == project.id)))
        while True:
            next_ids = {row.id for row in rows if row.parent_id in descendants and row.id not in descendants}
            if not next_ids:
                break
            descendants.update(next_ids)
        progress["logicAckVersions"] = {aid: version for aid, version in versions.items() if aid not in descendants}
        for descendant_id in descendants - {artifact.id}:
            reviews[descendant_id] = {"sourceArtifactId": artifact.id, "sourceVersion": artifact.version,
                                      "reason": "上游内容已修改，请人工复核"}
        progress["artifactReviewRequired"] = reviews
    project.progress = progress
    project.updated_at = utcnow()
    session.add(project)


@router.patch("/{project_id}/artifacts/{artifact_id}", response_model=ArtifactOut)
def patch_artifact(
    project_id: str,
    artifact_id: str,
    body: PatchArtifactIn,
    session: Session = Depends(get_session),
) -> Artifact:
    return _patch_artifact(project_id, artifact_id, body, session)


def _patch_artifact(project_id: str, artifact_id: str, body: PatchArtifactIn, session: Session,
                    *, actor: str = "user", candidate_conditions: tuple = ()) -> Artifact:
    body = body.model_dump(by_alias=True, exclude_unset=True)
    row = session.get(Artifact, artifact_id)
    if not row or row.project_id != project_id:
        raise HTTPException(404, "artifact not found")
    from ..ontology.runtime import is_action_only_artifact_type, sync_artifact_to_object

    via = bool(body.get("viaOntologyAction") or body.get("via_ontology_action"))
    if is_action_only_artifact_type(row.type) and not via:
        raise HTTPException(
            409,
            detail={
                "message": "ontology_action_required",
                "artifactType": row.type,
                "hint": "已映射类型须经 POST /ontology/actions/submit 写入",
            },
        )
    expected = body.get("expectedVersion", body.get("expected_version", row.version))
    if isinstance(expected, bool) or not isinstance(expected, int) or expected < 1:
        raise HTTPException(422, "expectedVersion 必须是正整数")
    if expected != row.version:
        raise HTTPException(409, detail={"code": "version_conflict", "currentVersion": row.version,
                                         "message": "稿件已更新，请比较差异后再保存"})
    changes: dict[str, Any] = {"version": row.version + 1, "updated_at": utcnow()}
    for key in ("title", "bodyMarkdown", "body_markdown", "bodyJson", "body_json", "status"):
        if key in body:
            field = {"bodyMarkdown": "body_markdown", "bodyJson": "body_json"}.get(key, key)
            changes[field] = body[key]
    content_changed = any(key in changes and changes[key] != getattr(row, key)
                          for key in ("body_markdown", "body_json"))
    if content_changed:
        changes["adopted_at"] = None
        if row.status == "adopted" or changes.get("status") == "adopted":
            changes["status"] = "draft"
    _capture_baseline(session, row, "before edit")
    result = session.execute(
        update(Artifact).where(Artifact.id == artifact_id, Artifact.version == expected, *candidate_conditions)
        .values(**changes).execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        session.rollback()
        raise HTTPException(409, detail={"code": "version_conflict", "message": "稿件已被其他操作更新"})
    session.expire(row)
    session.refresh(row)
    if not candidate_conditions:
        _record_content_edit(session, row, expected, content_changed)
    _snapshot_version(session, row, actor=actor)
    _log_activity(
        session,
        actor=actor,
        action="artifact_edit",
        summary=f"修改 {row.title}",
        project_id=project_id,
        detail={"artifact_id": row.id, "version": row.version, "via_ontology": via},
    )
    written = Artifact.model_validate(row.model_dump())
    session.commit()
    if candidate_conditions:
        return written  # A private candidate revision has no project or ontology write authority.
    session.refresh(row)
    try:
        sync_artifact_to_object(session, artifact=row, via_action=True)
        session.commit()
    except Exception:  # noqa: BLE001
        pass
    return written


def _unwrap_list(value: Any) -> list[str]:
    """LLM 偶发把数组包成 {item: [...]}（可多层）→ 递归拍平为字符串数组。"""
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        out: list[str] = []
        for v in value:
            if isinstance(v, str):
                out.append(v)
            else:
                out.extend(_unwrap_list(v))
        return [s for s in out if s]
    if isinstance(value, dict):
        if "item" in value:
            return _unwrap_list(value["item"])
        if "items" in value:
            return _unwrap_list(value["items"])
    return []


def _normalize_core_hook_candidate(item: dict[str, Any]) -> dict[str, Any]:
    """核心梗候选字段归一：
    - tags / opening_beats / risk_flags 拍平 {item: []} 包装
    - motivation 缺失时用「冲突线（危机）+ 追剧点（four_step）」兜底推导
    保证强采纳门禁（CoreHookAdoption）可用，且不篡改原始文案。"""
    if item.get("candidate") and isinstance(item.get("candidate"), dict):
        item = dict(item["candidate"])
    out = dict(item)
    for key in ("tags", "opening_beats", "openingBeats", "risk_flags", "riskFlags"):
        if key in out:
            out[key] = _unwrap_list(out.get(key))
    mot = out.get("motivation")
    if not (isinstance(mot, str) and mot.strip()):
        four = out.get("four_step") or out.get("fourStep") or {}
        if isinstance(four, dict):
            parts: list[str] = []
            if out.get("crisis"):
                parts.append(f"冲突线：{out.get('crisis')}")
            chase = four.get("hook_point") or four.get("hookPoint")
            if chase:
                parts.append(f"追剧点：{chase}")
            if parts:
                out["motivation"] = "；".join(parts)
    return out


@router.post("/{project_id}/artifacts", response_model=ArtifactOut)
def create_artifact(
    project_id: str,
    body: CreateArtifactIn,
    session: Session = Depends(get_session),
) -> Artifact:
    if not session.get(Project, project_id):
        raise HTTPException(404, "project not found")
    from ..ontology.runtime import is_action_only_artifact_type, sync_artifact_to_object

    if is_action_only_artifact_type(body.type) and not body.via_ontology_action:
        raise HTTPException(
            409,
            detail={
                "message": "ontology_action_required",
                "artifactType": body.type,
                "hint": "已映射类型须经 POST /ontology/actions/submit（或 viaOntologyAction=true 物化通道）",
            },
        )
    body_json = dict(body.body_json or {})
    if body.type == "core_hook":
        if isinstance(body_json.get("items"), list):
            body_json["items"] = [
                _normalize_core_hook_candidate(i) if isinstance(i, dict) else i
                for i in body_json["items"]
            ]
        elif body_json:
            body_json = _normalize_core_hook_candidate(body_json)
    art = Artifact(
        project_id=project_id,
        type=body.type,
        title=body.title,
        status=body.status,
        body_markdown=body.body_markdown,
        body_json=body_json,
        parent_id=body.parent_id,
        batch_id=body.batch_id,
        created_by_run_id=body.created_by_run_id,
    )
    session.add(art)
    try:
        actor = _generation_actor(session, project_id, body.created_by_run_id, "user")
    except ValueError as exc:
        session.rollback()
        raise HTTPException(409, str(exc)) from exc
    if body.created_by_run_id:
        from ..knowledge_colleague import selected_job
        run = session.get(AgentRun, body.created_by_run_id)
        job = selected_job(session, run) if run and run.knowledge_role_version else None
        if job:
            # The INSERT holds the SQLite write lock through the source check and commit.
            from .jobs import verify_selected_report
            session.flush()
            verify_selected_report(session, run, job, art)
    _snapshot_version(session, art, actor=actor, note="初始版本")
    _log_activity(
        session,
        actor="agent" if body.created_by_run_id else "user",
        action="artifact_create",
        summary=f"新建 {art.title}",
        project_id=project_id,
        detail={
            "artifact_id": art.id,
            "type": art.type,
            "via_ontology": bool(body.via_ontology_action),
        },
    )
    written = Artifact.model_validate(art.model_dump())
    session.commit()
    session.refresh(art)
    try:
        sync_artifact_to_object(session, artifact=art, via_action=True)
        session.commit()
        session.refresh(art)
    except Exception:  # noqa: BLE001
        pass
    return written


@router.delete("/{project_id}/artifacts/{artifact_id}")
def delete_artifact(
    project_id: str,
    artifact_id: str,
    session: Session = Depends(get_session),
) -> dict[str, str]:
    art = session.get(Artifact, artifact_id)
    if not art or art.project_id != project_id:
        raise HTTPException(404, "artifact not found")
    _log_activity(
        session,
        actor="user",
        action="artifact_discard",
        summary=f"淘汰 {art.title}",
        project_id=project_id,
        detail={"artifact_id": art.id, "type": art.type},
    )
    for av in session.exec(
        select(ArtifactVersion).where(ArtifactVersion.artifact_id == artifact_id)
    ).all():
        session.delete(av)
    session.delete(art)
    session.commit()
    return {"status": "deleted"}


@router.get("/{project_id}/snapshots", response_model=list[ProjectSnapshotOut])
def list_snapshots(
    project_id: str,
    session: Session = Depends(get_session),
) -> list[ProjectSnapshot]:
    if not session.get(Project, project_id):
        raise HTTPException(404, "project not found")
    return list(
        session.exec(
            select(ProjectSnapshot)
            .where(ProjectSnapshot.project_id == project_id)
            .order_by(ProjectSnapshot.created_at.desc())
        ).all()
    )


@router.post("/{project_id}/snapshots", response_model=ProjectSnapshotOut)
def create_snapshot(
    project_id: str,
    body: CreateSnapshotIn,
    session: Session = Depends(get_session),
) -> ProjectSnapshot:
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "project not found")
    arts = list(session.exec(select(Artifact).where(Artifact.project_id == project_id)).all())
    snap = ProjectSnapshot(
        project_id=project_id,
        name=body.name,
        note=body.note,
        stage=project.stage,
        status=project.status,
        progress=dict(project.progress or {}),
        cover_meta=dict(project.cover_meta or {}),
        artifacts=[
            {
                "id": a.id,
                "type": a.type,
                "title": a.title,
                "status": a.status,
                "body_markdown": a.body_markdown,
                "body_json": a.body_json,
                "parent_id": a.parent_id,
                "batch_id": a.batch_id,
                "version": a.version,
            }
            for a in arts
        ],
    )
    session.add(snap)
    _log_activity(
        session,
        actor="user",
        action="snapshot",
        summary=f"创建项目快照「{body.name}」",
        project_id=project_id,
        detail={"snapshot_id": snap.id},
    )
    session.commit()
    session.refresh(snap)
    return snap


@router.post("/{project_id}/snapshots/{snapshot_id}/restore", response_model=ProjectOut)
def restore_snapshot(
    project_id: str,
    snapshot_id: str,
    session: Session = Depends(get_session),
) -> Project:
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "project not found")
    snap = session.get(ProjectSnapshot, snapshot_id)
    if not project or not snap or snap.project_id != project_id:
        raise HTTPException(404, "project or snapshot not found")
    # 回滚前先存当前状态快照，避免误操作丢失
    cur_arts = list(session.exec(select(Artifact).where(Artifact.project_id == project_id)).all())
    session.add(
        ProjectSnapshot(
            project_id=project_id,
            name="回滚前自动快照",
            note="由快照回滚自动生成",
            stage=project.stage,
            status=project.status,
            progress=dict(project.progress or {}),
            cover_meta=dict(project.cover_meta or {}),
            artifacts=[
                {
                    "id": a.id,
                    "type": a.type,
                    "title": a.title,
                    "status": a.status,
                    "body_markdown": a.body_markdown,
                    "body_json": a.body_json,
                    "parent_id": a.parent_id,
                    "batch_id": a.batch_id,
                    "version": a.version,
                }
                for a in cur_arts
            ],
        )
    )
    current = {artifact.id: artifact for artifact in cur_arts}
    restored_ids: set[str] = set()
    restored_versions: dict[str, int] = {}
    # Restore creates new versions; the previous timeline remains available to
    # old references, comparisons and subsequent restores.
    for artifact in cur_arts:
        _capture_baseline(session, artifact, "before project restore")
    for item in snap.artifacts or []:
        artifact_id = item.get("id") or new_id()
        restored_ids.add(artifact_id)
        artifact = current.get(artifact_id)
        historical = list(session.exec(select(ArtifactVersion).where(ArtifactVersion.artifact_id == artifact_id)))
        next_version = max([int(item.get("version") or 1),
                            artifact.version if artifact else 0,
                            *[version.version for version in historical]]) + 1
        if artifact is None:
            artifact = Artifact(id=artifact_id, project_id=project_id, type=str(item.get("type") or "other"),
                                title=str(item.get("title") or "未命名"))
        artifact.title = str(item.get("title") or "未命名")
        artifact.type = str(item.get("type") or "other")
        artifact.status = "draft" if item.get("status") == "adopted" else str(item.get("status") or "draft")
        artifact.adopted_at = None
        artifact.body_markdown = str(item.get("body_markdown") or "")
        artifact.body_json = item.get("body_json")
        artifact.parent_id = item.get("parent_id")
        artifact.batch_id = item.get("batch_id")
        artifact.version = next_version
        artifact.updated_at = utcnow()
        session.add(artifact)
        _snapshot_version(session, artifact, note="恢复项目快照")
        restored_versions[artifact_id] = next_version
    for artifact_id, artifact in current.items():
        if artifact_id not in restored_ids:
            session.delete(artifact)
    _set_stage(session, project, snap.stage, actor="user", reason=f"恢复快照「{snap.name}」")
    project.status = snap.status
    project.progress = {**dict(snap.progress or {}), "logicAck": False, "logicAckAt": None,
                        "logic_ack": 0, "logic_ack_at": None,
                        "logicAckVersions": {}, "artifactReviewRequired": {
                            artifact_id: {"sourceArtifactId": artifact_id, "sourceVersion": version,
                                          "reason": "项目快照已恢复，请人工复核"}
                            for artifact_id, version in restored_versions.items()}}
    project.cover_meta = dict(snap.cover_meta or {})
    project.updated_at = utcnow()
    session.add(project)
    # Restore the ontology mirror in the same transaction as the manuscript,
    # so an accepted object cannot outlive its reverted human approval.
    from ..ontology.runtime import sync_artifact_to_object
    for artifact_id in restored_ids:
        restored_artifact = session.get(Artifact, artifact_id)
        if restored_artifact:
            sync_artifact_to_object(session, artifact=restored_artifact,
                                    user_id=project.user_id, via_action=True)
    _log_activity(
        session,
        actor="user",
        action="snapshot_restore",
        summary=f"恢复项目快照「{snap.name}」",
        project_id=project_id,
        detail={"snapshot_id": snapshot_id},
    )
    session.commit()
    session.refresh(project)
    return project


@router.post("/{project_id}/duplicate", response_model=ProjectOut)
def duplicate_project(
    project_id: str,
    include_full_text: bool = Query(default=True, alias="includeFullText"),
    session: Session = Depends(get_session),
) -> Project:
    src = session.get(Project, project_id)
    if not src:
        raise HTTPException(404, "project not found")
    dup = Project(
        user_id=src.user_id,
        title=f"{src.title}（副本）",
        format=src.format,
        genre_tags=list(src.genre_tags),
        market=src.market,
        stage="",
        status="active",
        progress={},
        cover_meta=dict(src.cover_meta or {}),
        budget_tokens=src.budget_tokens,
        prompt_pack_id=src.prompt_pack_id,
        token_used=0,
    )
    session.add(dup)
    session.flush()
    _set_stage(
        session,
        dup,
        INITIAL_STAGE.get(src.format, "S0_SETUP"),
        actor="user",
        reason="复制项目",
    )
    session.commit()
    session.refresh(dup)
    if include_full_text:
        for a in session.exec(select(Artifact).where(Artifact.project_id == project_id)).all():
            session.add(
                Artifact(
                    project_id=dup.id,
                    type=a.type,
                    title=a.title,
                    status=a.status,
                    body_markdown=a.body_markdown,
                    body_json=a.body_json,
                    parent_id=None,
                    batch_id=None,
                    version=1,
                    created_by_run_id=None,
                )
            )
    _log_activity(
        session,
        actor="user",
        action="project_duplicate",
        summary=f"复制项目「{src.title}」",
        project_id=dup.id,
        detail={"source_project_id": project_id},
    )
    session.commit()
    return dup


class LogicAckIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_versions: dict[str, int] = Field(alias="expectedVersions", strict=True)
    qa_run_id: str | None = Field(default=None, alias="qaRunId")


@router.post("/{project_id}/logic-ack")
def logic_ack(
    project_id: str,
    session: Session = Depends(get_session),
    body: LogicAckIn | None = None,
) -> dict:
    """Human LogicAck — never auto-green from agents."""
    if body is not None:
        connection = session.connection()
        dialect = connection.dialect.name
        if dialect == "sqlite":
            connection.exec_driver_sql("BEGIN IMMEDIATE")
        elif dialect == "postgresql":
            # Artifact.project_id is not a foreign key. A project row lock alone
            # cannot prevent concurrently inserted artifacts from escaping review.
            connection.exec_driver_sql("LOCK TABLE artifact IN SHARE MODE")
            session.exec(select(Project).where(Project.id == project_id).with_for_update()).first()
        else:
            raise HTTPException(501, "Conditional approval is unavailable for this database")
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "project not found")
    versions = {artifact.id: artifact.version for artifact in
                session.exec(select(Artifact).where(Artifact.project_id == project_id))}
    if body is not None and versions != body.expected_versions:
        raise HTTPException(409, detail={"code": "review_version_conflict", "currentVersions": versions})
    if body and body.qa_run_id:
        from ..pipeline_checkpoint import qa_manifest, PipelinePause
        from ..agent_inbox import submit_event
        if project.user_id != DEMO_USER:
            raise HTTPException(404, "项目不存在")
        run = session.get(AgentRun, body.qa_run_id)
        try:
            manifest = qa_manifest(session, project, run)
        except PipelinePause as exc:
            raise HTTPException(409, str(exc)) from exc
        approvals = dict((project.progress or {}).get("pipelineQaApprovals") or {})
        approvals[run.id] = manifest
        project.progress = {**(project.progress or {}), "pipelineQaApprovals": approvals}
        run.approval_state = "approved"
        session.add_all([project, run])
        submit_event(session,conversation_id=run.conversation_id,source="confirm",
                     payload={"project_id": project.id, "executionId": manifest["executionId"], "qaRunId":run.id},
                     dedupe_key=f"qa_signed:{run.id}:{run.receipt_id}",commit=False)
        session.commit()
        return {"ok": True, "qaApproval": manifest}
    acked_at = utcnow().isoformat()
    project.progress = {**project.progress, "logicAck": True, "logicAckAt": acked_at,
                        "logic_ack": 1, "logic_ack_at": acked_at,
                        "logicAckVersions": versions, "artifactReviewRequired": {}}
    project.updated_at = utcnow()
    session.add(project)
    session.commit()
    return {"ok": True, "logicAck": True}


def _artifact_words(art: Artifact) -> int:
    if art.body_json and isinstance(art.body_json, dict):
        n = art.body_json.get("wordCount")
        if isinstance(n, (int, float)) and n > 0:
            return int(n)
    return len((art.body_markdown or "").replace("\n", ""))


@router.get("/{project_id}/replay")
def project_replay(
    project_id: str,
    limit: int = Query(200, ge=1, le=1000),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """项目全链路回放：Stage 流转 + AgentRun + RunStep + 审计，按时间合并。

    复用既有 durable 账本（不引入 Temporal）；创作台 Run 的步骤落在
    conversation_id=`project:{id}`。
    """
    from ..models import RunStep

    from ..knowledge_colleague import owned_project
    project = owned_project(session, project_id, DEMO_USER)

    project_conv = f"project:{project_id}"
    runs = list(
        session.exec(
            select(AgentRun)
            .where(AgentRun.project_id == project_id)
            .order_by(AgentRun.created_at.asc())
        ).all()
    )
    run_ids = [r.id for r in runs]
    stage_events = list(
        session.exec(
            select(ProjectStageEvent)
            .where(ProjectStageEvent.project_id == project_id)
            .order_by(ProjectStageEvent.created_at.asc())
        ).all()
    )
    audits = list(
        session.exec(
            select(ActivityLog)
            .where(ActivityLog.project_id == project_id)
            .order_by(ActivityLog.created_at.asc())
        ).all()
    )
    steps: list[RunStep] = []
    if run_ids:
        steps = list(
            session.exec(
                select(RunStep)
                .where(RunStep.run_id.in_(run_ids))  # type: ignore[attr-defined]
                .order_by(RunStep.created_at.asc())
            ).all()
        )
    extra_steps = list(
        session.exec(
            select(RunStep)
            .where(RunStep.conversation_id == project_conv)
            .order_by(RunStep.created_at.asc())
        ).all()
    )
    seen_step = {s.id for s in steps}
    for s in extra_steps:
        if s.id not in seen_step and (s.run_id is None or s.run_id in run_ids):
            steps.append(s)
            seen_step.add(s.id)

    timeline: list[dict[str, Any]] = []
    for ev in stage_events:
        timeline.append(
            {
                "at": ev.created_at,
                "kind": "stage",
                "actor": ev.actor,
                "summary": f"{ev.from_stage or '∅'} → {ev.to_stage}",
                "payload": {
                    "fromStage": ev.from_stage,
                    "toStage": ev.to_stage,
                    "reason": ev.reason,
                },
            }
        )
    for run in runs:
        timeline.append(
            {
                "at": run.created_at,
                "kind": "run_start",
                "actor": f"agent:{run.agent_id}",
                "summary": f"开跑 {run.agent_id}",
                "payload": {
                    "runId": run.id,
                    "status": run.status,
                    "model": run.model,
                    "inputKeys": sorted((run.input_json or {}).keys()),
                },
            }
        )
        if run.finished_at:
            arts = len(run.output_artifact_ids or [])
            timeline.append(
                {
                    "at": run.finished_at,
                    "kind": "run_end",
                    "actor": f"agent:{run.agent_id}",
                    "summary": f"{run.status} · 产物 {arts}",
                    "payload": {
                        "runId": run.id,
                        "status": run.status,
                        "artifactIds": run.output_artifact_ids,
                        "receiptId": run.receipt_id,
                        "checkpoint": run.exec_checkpoint,
                        "tokens": {
                            "prompt": run.token_prompt,
                            "completion": run.token_completion,
                        },
                    },
                }
            )
    from ..run_steps import overview_payload
    for step in steps:
        if step.kind == "thinking":
            continue
        payload = overview_payload(step)
        name = payload.get("name") or payload.get("summary") or step.kind
        timeline.append(
            {
                "at": step.created_at,
                "kind": f"step:{step.kind}",
                "actor": step.actor,
                "summary": str(name)[:160],
                "payload": {
                    "runId": step.run_id,
                    "seq": step.seq,
                    "stepId": step.id,
                    "kind": step.kind,
                    "detail": payload,
                },
            }
        )
    for row in audits:
        if not (row.detail or {}).get("audit"):
            continue
        timeline.append(
            {
                "at": row.created_at,
                "kind": "audit",
                "actor": row.actor,
                "summary": row.summary,
                "payload": {
                    "action": row.action,
                    "detail": row.detail,
                },
            }
        )

    timeline.sort(key=lambda item: item["at"] or utcnow())
    if len(timeline) > limit:
        timeline = timeline[-limit:]

    return {
        "projectId": project_id,
        "title": project.title,
        "stage": project.stage,
        "runCount": len(runs),
        "stepCount": len(steps),
        "events": timeline,
        "runs": [
            {
                "id": r.id,
                "agentId": r.agent_id,
                "status": r.status,
                "model": r.model,
                "artifactCount": len(r.output_artifact_ids or []),
                "createdAt": r.created_at,
                "finishedAt": r.finished_at,
                "execCheckpoint": r.exec_checkpoint,
            }
            for r in runs[-50:]
        ],
    }


@router.get("/{project_id}/analytics-charts")
def analytics_charts(
    project_id: str,
    session: Session = Depends(get_session),
) -> dict:
    """项目分析图表数据：正文字数趋势 / 采纳率 / 各 Stage 停留时长。"""
    from collections import defaultdict

    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "project not found")
    arts = list(session.exec(select(Artifact).where(Artifact.project_id == project_id)).all())
    manuscripts = [a for a in arts if a.type == "manuscript"]

    # 正文累计字数趋势（按产物创建日期）
    day_words: dict[str, int] = defaultdict(int)
    for a in manuscripts:
        day = (a.created_at.date() if a.created_at else utcnow().date()).isoformat()
        day_words[day] += _artifact_words(a)
    trend: list[dict[str, object]] = []
    running = 0
    for day in sorted(day_words):
        running += day_words[day]
        trend.append({"day": day, "words": running})

    # 采纳率
    adopted = sum(1 for a in manuscripts if a.status == "adopted")
    discarded = sum(1 for a in manuscripts if a.status == "discarded")
    candidates = len(manuscripts) - adopted - discarded
    rate = round(adopted / len(manuscripts), 4) if manuscripts else 0.0

    # 各 Stage 停留时长（小时）：按 ProjectStageEvent 切段，当前段算到此刻
    events = list(
        session.exec(
            select(ProjectStageEvent)
            .where(ProjectStageEvent.project_id == project_id)
            .order_by(ProjectStageEvent.created_at.asc())
        ).all()
    )
    now = utcnow()
    stages: list[dict[str, object]] = []
    if not events:
        hours = max((now - project.created_at).total_seconds() / 3600, 0)
        stages.append({"stage": project.stage, "hours": round(hours, 1)})
    else:
        segment_start = project.created_at
        segment_stage = events[0].from_stage or project.stage
        for ev in events:
            hours = max((ev.created_at - segment_start).total_seconds() / 3600, 0)
            if hours >= 0.01:
                stages.append({"stage": segment_stage, "hours": round(hours, 1)})
            segment_start = ev.created_at
            segment_stage = ev.to_stage
        hours = max((now - segment_start).total_seconds() / 3600, 0)
        stages.append({"stage": segment_stage, "hours": round(hours, 1)})

    target_words = (project.cover_meta or {}).get("targetWords")
    return {
        "manuscriptTrend": trend,
        "adoption": {
            "adopted": adopted,
            "candidates": candidates,
            "discarded": discarded,
            "total": len(manuscripts),
            "rate": rate,
        },
        "stageDurations": stages,
        "totalWords": sum(_artifact_words(a) for a in manuscripts),
        "targetWords": int(target_words) if isinstance(target_words, (int, float)) else None,
    }


@router.post("/{project_id}/artifacts/{artifact_id}/adopt", response_model=ArtifactOut)
def adopt_artifact(
    project_id: str,
    artifact_id: str,
    body: AdoptArtifactIn,
    session: Session = Depends(get_session),
) -> Artifact:
    art = session.get(Artifact, artifact_id)
    if not art or art.project_id != project_id:
        raise HTTPException(404, "artifact not found")
    if body.expected_version is not None and body.expected_version != art.version:
        raise HTTPException(409, detail={"code": "version_conflict", "currentVersion": art.version,
                                         "message": "稿件版本已变化，请重新复核后采纳"})
    reviewed_version = art.version if body.expected_version is None else body.expected_version
    if art.type == "core_hook" and art.body_json:
        checks = check_core_hook_adoption(art.body_json, body.mode)
        if body.mode == "strong" and not can_strong_adopt(checks):
            raise HTTPException(400, detail={"message": "gate failed", "gates": checks})

    from ..ontology.runtime import execute_action_in_transaction, sync_artifact_to_object

    try:
        _capture_baseline(session, art, "before adoption", reviewed_version)
        obj = sync_artifact_to_object(session, artifact=art, via_action=True)
        if obj:
            result = execute_action_in_transaction(
                session, action_api_name="AdoptObject", project_id=project_id, actor="user",
                parameters={"rid": obj.rid, "mode": body.mode}, user_id=DEMO_USER,
            )
            if not result["ok"] or art.version != reviewed_version + 1:
                raise ValueError("adoption_not_materialized")
        else:
            art.status = "adopted" if body.mode == "strong" else "draft"
            art.adopted_at = utcnow()
            art.version += 1
            art.updated_at = utcnow()
            _record_content_edit(session, art, reviewed_version, False)
            _snapshot_version(session, art)
    except HTTPException:
        session.rollback()
        raise
    except ValueError as exc:
        session.rollback()
        raise HTTPException(409, str(exc)) from exc
    project = session.get(Project, project_id)
    if project and art.type == "core_hook" and body.mode == "strong":
        project.progress = {**project.progress, "S2_HOOK_SELECT": 1}
        if project.format == "manju":
            # 九格金牌路径：强采纳核心梗后进入 100 字测试人工闸，禁止直接跳大纲
            _set_stage(session, project, "S2_LOGLINE_100", reason="强采纳核心梗")
        elif project.format == "short_novel":
            # 短篇无独立核心梗闸：强采纳后落到换元阶段，而非原地不动
            _set_stage(session, project, "S2_SWAP", reason="强采纳核心梗")
        project.updated_at = utcnow()
        session.add(project)
    session.add(art)
    _log_activity(
        session,
        actor="user",
        action="adopt",
        summary=f"采纳 {art.title}",
        project_id=project_id,
        detail={
            "artifact_id": art.id,
            "mode": body.mode,
            "version": art.version,
            "via_ontology": True,
        },
    )
    session.commit()
    session.refresh(art)
    try:
        from ..eval.online import on_artifact_adopted

        on_artifact_adopted(
            session,
            artifact_id=art.id,
            project_id=project_id,
            version=art.version,
        )
    except Exception:  # noqa: BLE001
        pass
    return art
