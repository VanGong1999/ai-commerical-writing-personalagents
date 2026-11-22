"""Docker 风格任务守护进程：DAG 依赖解锁、双模式审批、并发槽位调度。

挂载于 inbox_pump._tick，不另起进程。
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import or_, update
from fastapi import HTTPException
from sqlmodel import Session, select

from .gates import can_strong_adopt, check_core_hook_adoption
from .knowledge_colleague import resolve_agent, validate_knowledge_input
from .llm_service import resolve_default_model
from .models import AgentRun, Artifact, AsyncTaskGroup, Job, MemoryFile, Project, new_id, utcnow
from .queue import enqueue_job, publish_job_event, publish_task_event, request_cancel
from .settings import get_settings

logger = logging.getLogger(__name__)

_TERMINAL = frozenset({"succeeded", "failed", "cancelled", "dead"})
_PROSE_PREFIXES = ("prose.", "orch.batch")


def _demo_user() -> str:
    return get_settings().demo_user_id


def _is_prose_agent(agent_id: str) -> bool:
    return any(str(agent_id or "").startswith(p) for p in _PROSE_PREFIXES)


def _deps_satisfied(session: Session, run: AgentRun) -> bool:
    deps = list(run.depends_on_run_ids or [])
    if not deps:
        return True
    for dep_id in deps:
        dep = session.get(AgentRun, dep_id)
        if not dep or dep.status != "succeeded":
            return False
    return True


def _group_active_count(session: Session, group_id: str) -> int:
    rows = list(
        session.exec(
            select(AgentRun).where(
                AgentRun.task_group_id == group_id,
                AgentRun.status.in_(["queued", "running", "pending_deps"]),  # type: ignore[attr-defined]
            )
        )
    )
    # SQLModel .in_ may fail on some backends; filter in Python as fallback
    if not rows:
        all_rows = list(session.exec(select(AgentRun).where(AgentRun.task_group_id == group_id)))
        rows = [r for r in all_rows if r.status in {"queued", "running", "pending_deps"}]
    return sum(1 for r in rows if r.status in {"queued", "running"})


def _project_prose_busy(session: Session, project_id: str | None, exclude_run_id: str) -> bool:
    """同书正文互斥：防止同项目多章并发写乱圣经。"""
    if not project_id:
        return False
    rows = list(
        session.exec(
            select(AgentRun).where(
                AgentRun.project_id == project_id,
                AgentRun.status.in_(["queued", "running"]),  # type: ignore[attr-defined]
            )
        )
    )
    if not rows:
        rows = [
            r
            for r in session.exec(select(AgentRun).where(AgentRun.project_id == project_id))
            if r.status in {"queued", "running"} and r.id != exclude_run_id
        ]
    else:
        rows = [r for r in rows if r.id != exclude_run_id]
    return any(_is_prose_agent(r.agent_id) for r in rows)


def _find_job_for_run(session: Session, run_id: str) -> Job | None:
    return session.exec(select(Job).where(Job.result_ref == run_id)).first()


_SCRIPT_FORMATS = frozenset({"manju", "duanju", "ip_adapt"})
# 一键补全流水线里的「大纲」步骤 agent（struct.* 中只有这三者是出大纲的步骤）。
_OUTLINE_AGENTS = frozenset(
    {"struct.episode_outline", "struct.ep_outline_duanju", "struct.chapter_cap"}
)
_BIBLE_HINTS = ("bible", "world", "character", "persona", "project.md", "decisions")
_JOURNAL_HINTS = ("journal", "chapter", "episode", "summary")


def _body_type_for(fmt: str) -> str:
    return "scene" if fmt == "duanju" else "manuscript"


def _outline_type_for(fmt: str) -> str:
    return "episode_outline" if fmt in _SCRIPT_FORMATS else "chapter_outline"


def _default_word_target(fmt: str) -> dict[str, int]:
    if fmt in _SCRIPT_FORMATS:
        return {"min": 800, "max": 1200, "target": 1000}
    return {"min": 2000, "max": 3000, "target": 2000}


def _autopilot_body_count(fmt: str) -> int:
    return 3 if fmt in {"manju", "duanju"} else 1


def _hook_text(session: Session, project_id: str) -> str:
    arts = list(
        session.exec(
            select(Artifact)
            .where(Artifact.project_id == project_id, Artifact.type == "core_hook")
            .order_by(Artifact.created_at)
        )
    )
    if not arts:
        return ""
    hook = next((a for a in arts if a.status == "adopted"), None) or arts[0]
    markdown = (hook.body_markdown or "").strip()
    if markdown:
        return markdown
    body = hook.body_json or {}
    return str(body.get("coreHook") or body.get("titleHook") or "").strip()


def _bio_text(session: Session, project_id: str) -> str:
    arts = list(
        session.exec(
            select(Artifact)
            .where(Artifact.project_id == project_id, Artifact.type == "character")
            .order_by(Artifact.created_at)
        )
    )
    parts = [a.body_markdown for a in arts[:5] if (a.body_markdown or "").strip()]
    return "\n\n".join(parts)


def _outline_text(session: Session, project_id: str, fmt: str) -> str:
    arts = list(
        session.exec(
            select(Artifact)
            .where(
                Artifact.project_id == project_id,
                Artifact.type == _outline_type_for(fmt),
            )
            .order_by(Artifact.created_at)
        )
    )
    parts = [a.body_markdown for a in arts if (a.body_markdown or "").strip()]
    return "\n\n".join(parts)


def _manuscript_text(session: Session, project_id: str, fmt: str) -> str:
    arts = list(
        session.exec(
            select(Artifact)
            .where(Artifact.project_id == project_id, Artifact.type == _body_type_for(fmt))
            .order_by(Artifact.created_at)
        )
    )
    parts: list[str] = []
    for a in arts:
        if a.type == "scene":
            parts.append(str((a.body_json or {}).get("script_body") or ""))
        else:
            parts.append(a.body_markdown or "")
    return "\n\n".join(parts)


def _adopted_body_count(session: Session, project_id: str, fmt: str) -> int:
    rows = list(
        session.exec(
            select(Artifact).where(
                Artifact.project_id == project_id,
                Artifact.type == _body_type_for(fmt),
                Artifact.status == "adopted",
            )
        )
    )
    return len(rows)


def _path_score(path: str, hints: tuple[str, ...]) -> int:
    lower = path.lower()
    return sum(1 for hint in hints if hint in lower)


def _read_snippets(files: list[MemoryFile], limit_chars: int) -> str:
    chunks: list[str] = []
    used = 0
    for f in files:
        if used >= limit_chars:
            break
        content = (f.content or "").strip()
        if not content:
            continue
        slice_ = content[: min(1800, limit_chars - used)]
        name = f.path.split("/")[-1] if f.path else "memory"
        chunks.append(f"## {name}\n{slice_}")
        used += len(slice_)
    return "\n\n".join(chunks)


def _studio_upstream(session: Session, project_id: str) -> dict[str, str]:
    """对齐前端 buildStudioUpstreamContext：setting/emotion/foreshadow 取自已采纳产物，
    bible/journal 从项目记忆现算；取不到则跳过。"""
    out: dict[str, str] = {}
    arts = list(session.exec(select(Artifact).where(Artifact.project_id == project_id)))

    setting_art = next(
        (
            a
            for a in arts
            if a.type in {"world", "world_setting"}
            and ((a.body_markdown or "").strip() or a.body_json)
        ),
        None,
    )
    if setting_art is not None and (setting_art.body_markdown or "").strip():
        out["setting"] = setting_art.body_markdown.strip()[:4000]

    emotion_art = next(
        (
            a
            for a in arts
            if a.type == "emotion_curve"
            and ((a.body_markdown or "").strip() or a.body_json)
        ),
        None,
    )
    if emotion_art is not None:
        md = (emotion_art.body_markdown or "").strip()
        out["emotion"] = (md or json.dumps(emotion_art.body_json, ensure_ascii=False))[:2000]

    foreshadow_art = next(
        (
            a
            for a in arts
            if a.type == "foreshadow_ledger"
            or (a.type == "other" and (a.body_json or {}).get("kind") == "foreshadow_ledger")
        ),
        None,
    )
    if foreshadow_art is not None:
        md = (foreshadow_art.body_markdown or "").strip()
        out["foreshadow"] = (
            md or json.dumps(foreshadow_art.body_json, ensure_ascii=False)
        )[:2000]

    files = list(
        session.exec(
            select(MemoryFile).where(
                or_(
                    MemoryFile.project_id == project_id,
                    MemoryFile.path.contains(project_id),
                )
            )
        )
    )
    bible_files = sorted(
        (f for f in files if _path_score(f.path, _BIBLE_HINTS) > 0),
        key=lambda f: (-_path_score(f.path, _BIBLE_HINTS), f.path),
    )[:3]
    journal_files = sorted(
        (f for f in files if _path_score(f.path, _JOURNAL_HINTS) > 0),
        key=lambda f: (-_path_score(f.path, _JOURNAL_HINTS), f.path),
    )[:3]
    bible = _read_snippets(bible_files, 3500)
    journal = _read_snippets(journal_files, 2500)
    if bible:
        out["bible"] = bible
    if journal:
        out["journal"] = journal
    return out


def _is_autopilot_run(session: Session, run: AgentRun) -> bool:
    """判定一键补全 run：以任务组级 ``plan_json.pipeline == "autopilot"`` 标记为准。

    这样 char/outline/选题/金手指/卷纲/换元/拆书/IP/四件套等无 adoptType、agent 又不匹配
    char.*/_OUTLINE_AGENTS 的辅助步骤，也能被注入 bible/journal/setting 等上游上下文。

    无任务组的旧 run（直接构造 AgentRun 的场景）回退到 adoptType / char / outline agent 判定，
    保持既有测试与兼容性；非补全的通用任务组 run 不受影响。
    """
    if run.task_group_id:
        group = session.get(AsyncTaskGroup, run.task_group_id)
        if group is not None and (group.plan_json or {}).get("pipeline") == "autopilot":
            return True
    input_json = run.input_json or {}
    if input_json.get("adoptType"):
        return True
    agent_id = run.agent_id or ""
    return agent_id.startswith("char.") or agent_id in _OUTLINE_AGENTS


def outline_version_approved(progress: dict, artifact_id: str, version: int) -> bool:
    approved = (progress.get("logicAckVersions") or {}).get(artifact_id)
    return (type(approved) is int and approved == version
            and artifact_id not in (progress.get("artifactReviewRequired") or {}))


_BATCH_RELEASE_FAILED = "批次格式或已确认大纲版本变更，已停止入队"
_BATCH_DEPENDENCY_CANCELLED = "前序正文失败，已停止批次"


def _batch_release_valid(session: Session, group: AsyncTaskGroup, run: AgentRun) -> bool:
    manifest = group.plan_json or {}
    if not manifest.get("dispatcherRunId"):
        return True
    data = run.input_json or {}
    matches = [task for task in manifest.get("tasks", []) if task.get("agent_id") == run.agent_id
               and task.get("input_extra", {}).get("episodeNo") == data.get("episodeNo")]
    if len(matches) != 1:
        return False
    task = matches[0]
    project = session.get(Project, run.project_id)
    if (not project or project.id != task.get("project_id") or
            project.format != task.get("format") or data.get("format") != project.format):
        return False
    slot = task.get("input_extra", {})
    if not slot:  # QA has no outline of its own.
        return True
    ref = slot["outline_ref"]
    art = session.get(Artifact, ref["id"])
    progress = project.progress or {}
    return (data.get("outline_ref") == ref and art is not None and art.project_id == project.id
            and art.type == _outline_type_for(project.format) and art.version == ref["version"]
            and outline_version_approved(progress, art.id, art.version))


def build_autopilot_upstream(session: Session, run: AgentRun) -> dict[str, Any]:
    """入队时现算上游上下文（对齐前端 AutopilotDrawer.runItem / buildStudioUpstreamContext）。

    按 run 的 step 类型注入：char→hook；outline→hook+bio；正文（adoptType∈{manuscript,scene}）
    →hook+bio+outline+ep_no/count+wordTarget；qc_report→text；bible/journal/setting/emotion/
    foreshadow 从项目记忆现算。取不到相应上游产物时字段留空/跳过，不抛异常。
    """
    if not _is_autopilot_run(session, run):
        return {}

    project_id = run.project_id
    if not project_id:
        return {}

    input_json = run.input_json or {}
    project = session.get(Project, project_id)
    fmt = str(
        (project.format if project is not None else None)
        or input_json.get("format")
        or "manju"
    )
    group = session.get(AsyncTaskGroup, run.task_group_id) if run.task_group_id else None
    if group and (group.plan_json or {}).get("dispatcherRunId"):
        fmt = input_json["format"]
        # Batch runs are already bound to a single versioned outline or group QA.
        child = {k: input_json[k] for k in ("episodeNo","chapterNo","outline_ref") if k in input_json}
        siblings = session.exec(select(AgentRun).where(AgentRun.task_group_id == group.id)).all()
        slots = sorted(({"episodeNo":r.input_json["episodeNo"], "runId":r.id} for r in siblings
                        if r.input_json.get("episodeNo") and (r.status == "succeeded" or r.id == run.id)),
                       key=lambda slot: slot["episodeNo"])
        if not child and slots:
            owners = [s["runId"] for s in slots]
            manuscripts = session.exec(select(Artifact).where(
                Artifact.project_id == project_id, Artifact.created_by_run_id.in_(owners),
                Artifact.type == _body_type_for(fmt))).all()
            child["artifactIds"] = [a.id for a in manuscripts]
            dispatcher = session.get(AgentRun, group.plan_json["dispatcherRunId"])
            if dispatcher and dispatcher.input_json.get("pipelineExecutionId"):
                child["qaSourceVersions"] = {a.id: a.version for a in manuscripts}
        return {"format":fmt,"taskGroupId":group.id,"batchBodySlots":slots,**child}
    adopt_type = input_json.get("adoptType")
    agent_id = run.agent_id or ""

    # format 一律写回上游：入队合并后，5/6 格式 worker（hook/char/outline/…）不会再拿到
    # 硬编码的 "manju"，而是项目真实 format（如 duanju/short_novel）。
    out: dict[str, Any] = {"format": fmt}
    try:
        out.update(_studio_upstream(session, project_id))
    except Exception:  # noqa: BLE001
        logger.exception("build_autopilot_upstream: studio upstream failed")

    if adopt_type in {"manuscript", "scene"}:
        kind = "body"
    elif adopt_type == "qc_report":
        kind = "qc"
    elif agent_id.startswith("char."):
        kind = "char"
    elif agent_id in _OUTLINE_AGENTS:
        kind = "outline"
    else:
        kind = "other"

    try:
        if kind in {"char", "outline", "body"}:
            hook = _hook_text(session, project_id)
            if hook:
                out["hook"] = hook
        if kind in {"outline", "body"}:
            bio = _bio_text(session, project_id)
            if bio:
                out["bio"] = bio
        if kind == "body":
            outline_text = _outline_text(session, project_id, fmt)
            if outline_text:
                out["outline"] = outline_text
            ep_no = input_json.get("episodeNo")
            if ep_no:
                out["ep_no"] = ep_no
                out["episodeNo"] = ep_no
                out["count"] = 1
            else:
                out["count"] = max(
                    1, _autopilot_body_count(fmt) - _adopted_body_count(session, project_id, fmt)
                )
            out["wordTarget"] = _default_word_target(fmt)
            # 人工偏好好坏例：仅手稿类步骤注入，对齐前端 runItem 的 GET /eval/exemplars。
            # 取不到/未启用时跳过，不阻塞正文运行。
            try:
                from .eval.feedback import select_exemplars

                ex = select_exemplars(
                    session, format=fmt, artifact_type=_body_type_for(fmt)
                )
                if ex.get("enabled") and (ex.get("text") or "").strip():
                    out["exemplars"] = {
                        "text": ex["text"],
                        "chars": int(ex.get("chars") or 0),
                    }
            except Exception:  # noqa: BLE001
                logger.exception("build_autopilot_upstream: exemplars failed")
        if kind == "qc":
            out["text"] = _manuscript_text(session, project_id, fmt)[:120_000]
    except Exception:  # noqa: BLE001
        logger.exception("build_autopilot_upstream: step context failed")

    return out


def _enqueue_run(session: Session, run: AgentRun, owner: str | None = None) -> bool:
    owner = owner or _demo_user()
    role = resolve_agent(session, run.agent_id, run.project_id, owner)
    upstream = {} if role.get("custom") else build_autopilot_upstream(session, run)
    if upstream:
        run.input_json = {**(run.input_json or {}), **upstream}

    # Historical terminal jobs must not hide the delivery being resumed. Keep
    # one live delivery and retire duplicates before publishing another hint.
    live_jobs = list(session.exec(select(Job).where(
        Job.result_ref == run.id,
        Job.status.notin_({"cancelled", "failed", "succeeded", "dead"}),
    ).order_by(Job.created_at, Job.id).execution_options(populate_existing=True)))
    job = live_jobs[0] if live_jobs else None
    for duplicate in live_jobs[1:]:
        duplicate.status = "cancelled"
        session.add(duplicate)
    if job is None:
        # Read the committed identity directly. A cached paused object can refer
        # to a delivery which another session has since completed or failed.
        if session.exec(select(Job.id).where(Job.result_ref == run.id).limit(1)).first() is not None:
            return False
        # 延迟创建 Job（pending_deps → ready）
        input_json = run.input_json or {}
        base_input = input_json.get("input")
        if isinstance(base_input, dict):
            payload_input = {**base_input, **upstream}
        elif base_input:
            # 保持既有行为：非 dict 的 input 原样透传（upstream 只合并进 dict 与 run.input_json）
            payload_input = base_input
        else:
            payload_input = {
                "assistantPrompt": input_json.get("assistantPrompt") or "",
                "format": input_json.get("format") or "manju",
                **upstream,
            }
        payload = {
            "runId": run.id,
            "agentId": run.agent_id,
            "input": payload_input,
        }
        job = Job(
            type="agent.run",
            payload=payload,
            project_id=run.project_id,
            conversation_id=run.conversation_id,
            user_id=owner,
            result_ref=run.id,
            task_group_id=run.task_group_id,
            status="queued",
        )
        session.add(job)
    else:
        job.status = "queued"
        job.task_group_id = run.task_group_id
        session.add(job)

    run.status = "queued"
    run.approval_state = "approved" if run.approval_state == "waiting" else (run.approval_state or "none")
    run.progress_stage = run.progress_stage or "排队中"
    session.add(run)
    session.commit()

    enqueue_job(job.id, {"type": job.type, "payload": job.payload, "runId": run.id})
    publish_job_event(
        job.id,
        {"type": "status", "status": "queued", "jobId": job.id, "runId": run.id},
    )
    publish_task_event(
        {
            "type": "run_queued",
            "runId": run.id,
            "jobId": job.id,
            "taskGroupId": run.task_group_id,
            "agentId": run.agent_id,
            "projectId": run.project_id,
            "conversationId": run.conversation_id,
        }
    )
    return True


def refresh_group_status(session: Session, group: AsyncTaskGroup) -> AsyncTaskGroup:
    session.flush()
    session.refresh(group)
    if group.status in {"paused", "cancelled"}:
        return group
    rows = session.exec(select(AgentRun.status, AgentRun.approval_state).where(
        AgentRun.task_group_id == group.id)).all()
    statuses = {status for status, _ in rows}
    if not rows and group.status in {"completed", "partial_failed"}:
        return group
    if group.approval_mode == "checkpoint_gate" and any(approval == "waiting" for _, approval in rows):
        status = "waiting_approval"
    elif statuses <= {"succeeded"}:
        status = "completed"
    elif statuses == {"cancelled"}:
        status = "cancelled"
    elif statuses <= _TERMINAL:
        status = "partial_failed"
    else:
        status = "running"
    changes = {"status": status, "updated_at": utcnow()}
    if status in {"completed", "partial_failed", "cancelled"}:
        changes["finished_at"] = changes["updated_at"]
    # A pause or cancellation committed after this read owns the group state.
    session.execute(update(AsyncTaskGroup).where(
        AsyncTaskGroup.id == group.id, AsyncTaskGroup.status == group.status,
        AsyncTaskGroup.updated_at == group.updated_at,
    ).values(**changes).execution_options(synchronize_session=False))
    session.commit()
    session.refresh(group)
    return group


def maybe_announce_group_done(session: Session, group: AsyncTaskGroup) -> None:
    if group.status not in {"completed", "partial_failed"}:
        return
    if not group.conversation_id:
        return
    try:
        from .agent_inbox import submit_event

        submit_event(
            session,
            conversation_id=group.conversation_id,
            source="task_group_done",
            dedupe_key=f"task_group_done:{group.id}:{group.status}",
            payload={
                "task_group_id": group.id,
                "project_id": (group.plan_json or {}).get("projectId"),
                "title": group.title,
                "goal": group.goal,
                "status": group.status,
                "kind": group.kind,
            },
        )
        publish_task_event(
            {
                "type": "group_done",
                "taskGroupId": group.id,
                "status": group.status,
                "title": group.title,
                "conversationId": group.conversation_id,
            }
        )
    except Exception:  # noqa: BLE001
        logger.exception("announce group done failed")


def recover_stale_queued(session: Session, *, now: datetime | None = None) -> dict[str, int]:
    """队列卫生恢复：Worker 崩溃 / Redis 重启后，DB 里仍为 queued 的 agent 任务
    若不在 Redis 队列中，按幂等方式重新入队；Job 已不存在的直接判 dead。

    仅处理超过宽限期（默认 90s）的排队任务，避免与「刚入队未领取」竞争。
    超过恢复窗口（默认 6h）仍没被执行的老任务判 dead 并注明原因，避免陈旧任务复活烧 Token。
    """
    from .queue import enqueue_job, job_in_queue

    now = now or utcnow()
    grace = int(get_settings().queue_recovery_after_s or 90)
    cutoff = now - timedelta(seconds=max(10, grace))
    window = timedelta(hours=max(1, int(get_settings().queue_recovery_window_hours or 6)))
    expired = now - window
    rows = list(
        session.exec(
            select(AgentRun).where(AgentRun.status == "queued").limit(200)
        )
    )
    requeued = 0
    dead = 0
    for run in rows:
        created = run.created_at
        if created is not None:
            created_aware = created if created.tzinfo else created.replace(tzinfo=timezone.utc)
            if created_aware > cutoff:
                continue
            if created_aware < expired:
                job = _find_job_for_run(session, run.id)
                if job and job.status == "queued":
                    job.status = "dead"
                    session.add(job)
                run.status = "dead"
                run.progress_stage = f"排队超过 {int(window.total_seconds() // 3600)}h 未执行，已判 dead（可手动重试）"
                run.finished_at = now
                session.add(run)
                dead += 1
                continue
        job = _find_job_for_run(session, run.id)
        if not job:
            run.status = "dead"
            run.progress_stage = "队列条目丢失（无 Job），已判 dead"
            run.finished_at = now
            session.add(run)
            dead += 1
            continue
        if job.status != "queued":
            continue
        # 幂等：队列里已有信封就跳过；没有才重新入队
        if job_in_queue(job.id):
            continue
        payload = {
            "runId": run.id,
            "agentId": run.agent_id,
            "input": (run.input_json or {}).get("input")
            or {
                "assistantPrompt": (run.input_json or {}).get("assistantPrompt") or "",
                "format": (run.input_json or {}).get("format") or "manju",
            },
        }
        enqueue_job(job.id, {"type": job.type, "payload": payload, "runId": run.id})
        publish_job_event(
            job.id,
            {"type": "status", "status": "queued", "jobId": job.id, "runId": run.id, "recovered": True},
        )
        requeued += 1
    if requeued or dead:
        session.commit()
        logger.info("recover_stale_queued: requeued=%s dead=%s", requeued, dead)
    return {"requeued": requeued, "dead": dead}


def tick(session: Session, *, group_id: str | None = None) -> dict[str, Any]:
    """扫描 pending_deps / waiting 审批，按配额入队；先回收租约过期的实例。"""
    unlocked = 0
    waiting_set = 0
    reclaimed: dict[str, Any] = {"requeued": 0, "dead": 0}
    recovered: dict[str, int] = {"requeued": 0, "dead": 0}
    if group_id is not None:
        group = session.get(AsyncTaskGroup, group_id)
        groups = [group] if group and group.status in {"running", "waiting_approval"} else []
    else:
        try:
            from .run_lease import reclaim_expired

            reclaimed = reclaim_expired(session)
        except Exception:  # noqa: BLE001
            logger.exception("lease reclaim failed")
        try:
            recovered = recover_stale_queued(session)
        except Exception:  # noqa: BLE001
            logger.exception("stale queue recovery failed")
        groups = list(
            session.exec(
                select(AsyncTaskGroup).where(
                    AsyncTaskGroup.status.in_(["running", "waiting_approval", "paused"])  # type: ignore[attr-defined]
                )
            )
        )
        if not groups:
            # fallback without .in_
            groups = [
                g
                for g in session.exec(select(AsyncTaskGroup))
                if g.status in {"running", "waiting_approval", "paused"}
            ]

    for group in groups:
        if group.status == "paused":
            continue
        runs = list(
            session.exec(
                select(AgentRun)
                .where(AgentRun.task_group_id == group.id)
                .order_by(AgentRun.created_at)
            )
        )
        active = sum(1 for r in runs if r.status in {"queued", "running"})
        from . import llm_governor

        max_c = llm_governor.effective_fleet_concurrency(int(group.max_concurrency or 4))

        for run in runs:
            if run.status != "pending_deps":
                continue
            if not _deps_satisfied(session, run):
                if (group.plan_json or {}).get("dispatcherRunId") and any(
                    (dep := session.get(AgentRun, dep_id)) and dep.status in {"dead","failed","cancelled"}
                    for dep_id in run.depends_on_run_ids
                ):
                    run.status = "cancelled"
                    run.progress_stage = _BATCH_DEPENDENCY_CANCELLED
                    run.finished_at = utcnow()
                    session.add(run)
                    session.commit()
                continue

            # checkpoint_gate：关键节点先等审批
            needs_gate = (
                group.approval_mode == "checkpoint_gate"
                and bool(run.checkpoint)
                and run.approval_state not in {"approved", "rejected"}
            )
            if needs_gate:
                if run.approval_state != "waiting":
                    run.approval_state = "waiting"
                    run.progress_stage = "等待审批"
                    session.add(run)
                    session.commit()
                    waiting_set += 1
                    publish_task_event(
                        {
                            "type": "run_waiting_approval",
                            "runId": run.id,
                            "taskGroupId": group.id,
                            "agentId": run.agent_id,
                            "label": run.label,
                            "projectId": run.project_id,
                            "conversationId": run.conversation_id or group.conversation_id,
                        }
                    )
                continue

            if run.approval_state == "rejected":
                run.status = "cancelled"
                run.finished_at = utcnow()
                run.progress_stage = "已驳回"
                session.add(run)
                session.commit()
                continue

            if active >= max_c:
                break
            if _is_prose_agent(run.agent_id) and _project_prose_busy(session, run.project_id, run.id):
                continue
            # 全局 LLM 闸：无槽则保持 pending_deps（错峰，不失败）
            if not llm_governor.slots_available(priority="fleet"):
                run.progress_stage = "限流排队"
                session.add(run)
                session.commit()
                break

            if (group.plan_json or {}).get("dispatcherRunId"):
                # An explicit group wake and the periodic scheduler may see the same ready run.
                # Keep the claim and the first Job in one transaction.
                claimed = session.execute(update(AgentRun).where(
                    AgentRun.id == run.id, AgentRun.status == "pending_deps", AgentRun.task_group_id == group.id,
                    select(AsyncTaskGroup.id).where(
                        AsyncTaskGroup.id == group.id, AsyncTaskGroup.status.in_(("running", "waiting_approval")),
                        AsyncTaskGroup.approval_mode == group.approval_mode,
                    ).exists(),
                ).values(status="queued").execution_options(synchronize_session=False))
                if claimed.rowcount != 1:
                    session.rollback()
                    continue
            if not _batch_release_valid(session, group, run):
                run.status = "failed"
                run.progress_stage = _BATCH_RELEASE_FAILED
                run.finished_at = utcnow()
                session.add(run)
                session.commit()
                continue
            try:
                if not _enqueue_run(session, run, group.user_id):
                    session.rollback()
                    continue
            except HTTPException as exc:
                run.status = "failed"
                run.progress_stage = str(exc.detail)
                run.finished_at = utcnow()
                session.add(run)
                session.commit()
                continue
            active += 1
            unlocked += 1

        refreshed = refresh_group_status(session, group)
        if refreshed.status in {"completed", "partial_failed"}:
            maybe_announce_group_done(session, refreshed)

    fleet_pumped = 0
    if group_id is None:
        try:
            from .routers.agents_catalog import pump_deferred_fleets

            fleet_pumped = pump_deferred_fleets(session)
        except Exception:  # noqa: BLE001
            logger.exception("pump_deferred_fleets failed")

    return {
        "unlocked": unlocked,
        "waitingSet": waiting_set,
        "groups": len(groups),
        "reclaimed": reclaimed,
        "recoveredQueued": recovered,
        "fleetPumped": fleet_pumped,
    }


def create_task_group(
    session: Session,
    *,
    user_id: str,
    conversation_id: str | None,
    title: str,
    goal: str,
    kind: str,
    approval_mode: str,
    max_concurrency: int,
    tasks: list[dict[str, Any]],
    plan_extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """创建任务组与子 AgentRun（初始 pending_deps，由 daemon 解锁入队）。

    tasks 项字段：
      project_id | new_project_title, format, agent_id, instruction,
      depends_on (local indices or run ids), checkpoint, label, chapter_index,
      input_extra (可选 dict，建 run 时合并进 input_json——用于补全的 adoptType/adoptMode/episodeNo
      在首次 tick 入队前就位，而非建组后再回填)。

    plan_extra（可选 dict）在建组时合并进 plan_json，用于写入组级标记（如 pipeline=autopilot），
    使首次 tick 入队时 _is_autopilot_run 即可通过组标记识别补全 run。
    """
    mode = approval_mode if approval_mode in {"auto_pilot", "checkpoint_gate"} else "auto_pilot"
    from . import llm_governor

    from .agent_colleagues import load_catalog_by_id
    builtins = load_catalog_by_id()
    for raw in tasks:
        agent = str(raw.get("agent_id") or raw.get("agentId") or "orch.writing")
        project = raw.get("project_id") or raw.get("projectId")
        if project or agent not in builtins:
            role = resolve_agent(session, agent, project, user_id)
            for key in ("input_extra", "inputExtra"):
                validate_knowledge_input(role, raw.get(key))
    st = llm_governor.status()
    requested = max(1, min(16, int(max_concurrency or st.fleet_default_concurrency or 4)))
    # 忙碌/节流时压默认并发，避免 Fleet/多书一上来打满额度
    if st.throttled or st.inflight >= st.effective:
        requested = min(requested, 2)
    group = AsyncTaskGroup(
        user_id=user_id,
        conversation_id=conversation_id,
        title=title or goal[:40] or "后台任务组",
        goal=goal or "",
        kind=kind if kind in {"multi_book", "multi_chapter", "multi_agent"} else "multi_agent",
        approval_mode=mode,
        max_concurrency=requested,
        status="running",
        plan_json={"tasks": tasks, **(plan_extra or {})},
    )
    session.add(group)
    session.commit()
    session.refresh(group)

    created_runs: list[AgentRun] = []
    index_to_run: dict[int, str] = {}

    for i, raw in enumerate(tasks):
        project_id = raw.get("project_id") or raw.get("projectId")
        new_title = raw.get("new_project_title") or raw.get("newProjectTitle")
        fmt = raw.get("format") or "manju"
        if not project_id and new_title:
            project = Project(
                title=str(new_title),
                format=str(fmt),
                user_id=user_id,
                stage="S0_SETUP",
            )
            session.add(project)
            session.commit()
            session.refresh(project)
            project_id = project.id
        if not project_id:
            # 回退：无项目则跳过该项
            continue

        agent_id = str(raw.get("agent_id") or raw.get("agentId") or "orch.writing")
        instruction = str(raw.get("instruction") or raw.get("task") or goal or "")
        label = str(raw.get("label") or agent_id)
        chapter_index = raw.get("chapter_index") or raw.get("chapterIndex")
        checkpoint = bool(raw.get("checkpoint") or raw.get("is_checkpoint") or False)
        # 正文默认视为检查点候选
        if not checkpoint and _is_prose_agent(agent_id) and mode == "checkpoint_gate":
            checkpoint = True

        deps_raw = raw.get("depends_on") or raw.get("dependsOn") or []
        depends: list[str] = []
        for d in deps_raw:
            if isinstance(d, int) and d in index_to_run:
                depends.append(index_to_run[d])
            elif isinstance(d, str) and d.isdigit() and int(d) in index_to_run:
                depends.append(index_to_run[int(d)])
            elif isinstance(d, str) and d:
                depends.append(d)

        input_json: dict[str, Any] = {
            "assistantPrompt": instruction,
            "label": label,
            "taskGroupId": group.id,
            "format": str(fmt or "manju"),
        }
        if chapter_index is not None:
            input_json["chapterIndex"] = chapter_index
        extra = raw.get("input_extra") or raw.get("inputExtra") or {}
        if isinstance(extra, dict) and extra:
            input_json = {**input_json, **extra}

        run = AgentRun(
            project_id=str(project_id),
            conversation_id=conversation_id,
            agent_id=agent_id,
            status="pending_deps",
            input_json=input_json,
            model=resolve_default_model(),
            task_group_id=group.id,
            depends_on_run_ids=depends,
            approval_state="none",
            progress_pct=0,
            progress_stage="等待依赖",
            checkpoint=checkpoint,
            label=label,
        )
        session.add(run)
        session.commit()
        session.refresh(run)
        index_to_run[i] = run.id
        created_runs.append(run)

        # Thread 订阅
        if conversation_id:
            try:
                from .thread_router import project_thread_key, upsert_subscription

                upsert_subscription(
                    session,
                    thread_key=project_thread_key(str(project_id)),
                    conversation_id=conversation_id,
                    run_id=run.id,
                    agent_id=agent_id,
                    project_id=str(project_id),
                    mode="wake",
                )
            except Exception:  # noqa: BLE001
                pass

    # 无依赖的任务立即尝试解锁
    tick(session)
    refresh_group_status(session, group)

    publish_task_event(
        {
            "type": "group_created",
            "taskGroupId": group.id,
            "title": group.title,
            "kind": group.kind,
            "approvalMode": group.approval_mode,
            "runCount": len(created_runs),
            "conversationId": conversation_id,
        }
    )

    return {
        "task_group_id": group.id,
        "taskGroupId": group.id,
        "title": group.title,
        "approval_mode": group.approval_mode,
        "run_ids": [r.id for r in created_runs],
        "runs": [
            {
                "runId": r.id,
                "agentId": r.agent_id,
                "projectId": r.project_id,
                "status": r.status,
                "label": r.label,
                "checkpoint": r.checkpoint,
                "dependsOn": r.depends_on_run_ids,
            }
            for r in created_runs
        ],
    }


def set_group_approval_mode(
    session: Session,
    group_id: str,
    approval_mode: str,
) -> AsyncTaskGroup | None:
    group = session.get(AsyncTaskGroup, group_id)
    if not group:
        return None
    mode = approval_mode if approval_mode in {"auto_pilot", "checkpoint_gate"} else group.approval_mode
    group.approval_mode = mode
    group.updated_at = utcnow()
    if mode == "auto_pilot":
        # 放行所有 waiting
        runs = list(session.exec(select(AgentRun).where(AgentRun.task_group_id == group.id)))
        for r in runs:
            if r.approval_state == "waiting":
                r.approval_state = "approved"
                session.add(r)
        if group.status == "waiting_approval":
            group.status = "running"
    session.add(group)
    session.commit()
    session.refresh(group)
    tick(session)
    publish_task_event(
        {
            "type": "group_mode_changed",
            "taskGroupId": group.id,
            "approvalMode": group.approval_mode,
            "conversationId": group.conversation_id,
        }
    )
    return group


def approve_run(
    session: Session,
    run_id: str,
    *,
    approve: bool,
    note: str | None = None,
) -> AgentRun | None:
    run = session.get(AgentRun, run_id)
    if not run:
        return None
    run.approval_state = "approved" if approve else "rejected"
    if note:
        inp = dict(run.input_json or {})
        inp["approvalNote"] = note
        run.input_json = inp
    if not approve:
        run.status = "cancelled"
        run.finished_at = utcnow()
        run.progress_stage = "已驳回"
        job = _find_job_for_run(session, run.id)
        if job and job.status in {"queued", "running"}:
            request_cancel(job.id)
            job.status = "cancelled"
            session.add(job)
    else:
        if run.status == "pending_deps":
            run.progress_stage = "已批准，等待调度"
    session.add(run)
    session.commit()
    session.refresh(run)
    if run.task_group_id:
        group = session.get(AsyncTaskGroup, run.task_group_id)
        if group:
            refresh_group_status(session, group)
    tick(session)
    publish_task_event(
        {
            "type": "run_approval",
            "runId": run.id,
            "approved": approve,
            "taskGroupId": run.task_group_id,
            "conversationId": run.conversation_id,
            "note": note,
        }
    )
    return run


def cancel_group(session: Session, group_id: str) -> AsyncTaskGroup | None:
    group = session.get(AsyncTaskGroup, group_id)
    if not group:
        return None
    runs = list(session.exec(select(AgentRun).where(AgentRun.task_group_id == group.id)))
    for r in runs:
        if r.status in _TERMINAL:
            continue
        r.status = "cancelled"
        r.finished_at = utcnow()
        r.progress_stage = "已取消"
        session.add(r)
        job = _find_job_for_run(session, r.id)
        if job and job.status in {"queued", "running"}:
            request_cancel(job.id)
            job.status = "cancelled"
            session.add(job)
    group.status = "cancelled"
    group.finished_at = utcnow()
    group.updated_at = utcnow()
    session.add(group)
    session.commit()
    session.refresh(group)
    publish_task_event(
        {
            "type": "group_cancelled",
            "taskGroupId": group.id,
            "conversationId": group.conversation_id,
        }
    )
    return group


def group_progress(session: Session, group: AsyncTaskGroup) -> dict[str, Any]:
    runs = list(session.exec(select(AgentRun).where(AgentRun.task_group_id == group.id)))
    if not runs:
        return {"pct": 0, "total": 0, "done": 0, "running": 0, "waiting": 0}
    total = len(runs)
    done = sum(1 for r in runs if r.status in _TERMINAL)
    running = sum(1 for r in runs if r.status in {"queued", "running"})
    waiting = sum(1 for r in runs if r.approval_state == "waiting")
    pct_sum = sum(int(r.progress_pct or 0) for r in runs)
    pct = int(pct_sum / total) if total else 0
    if done == total and total:
        pct = 100
    return {"pct": pct, "total": total, "done": done, "running": running, "waiting": waiting}


def serialize_group(session: Session, group: AsyncTaskGroup) -> dict[str, Any]:
    runs = list(
        session.exec(
            select(AgentRun)
            .where(AgentRun.task_group_id == group.id)
            .order_by(AgentRun.created_at)
        )
    )
    prog = group_progress(session, group)
    return {
        "id": group.id,
        "title": group.title,
        "goal": group.goal,
        "kind": group.kind,
        "approvalMode": group.approval_mode,
        "maxConcurrency": group.max_concurrency,
        "status": group.status,
        "conversationId": group.conversation_id,
        "progress": prog,
        "createdAt": group.created_at,
        "finishedAt": group.finished_at,
        "updatedAt": group.updated_at,
        "runs": [_serialize_run(session, r) for r in runs],
    }


def _lifecycle_state(r: AgentRun) -> str:
    from .run_lease import lifecycle_state

    return lifecycle_state(r)


def _lease_expires_in(r: AgentRun) -> int | None:
    if not r.lease_until:
        return None
    from .run_lease import _aware

    return int((_aware(r.lease_until) - utcnow()).total_seconds())


def _serialize_run(session: Session, r: AgentRun) -> dict[str, Any]:
    job = _find_job_for_run(session, r.id)
    return {
        "runId": r.id,
        "agentId": r.agent_id,
        "projectId": r.project_id,
        "status": r.status,
        "label": r.label or r.agent_id,
        "progressPct": r.progress_pct or 0,
        "progressStage": r.progress_stage,
        "approvalState": r.approval_state,
        "checkpoint": r.checkpoint,
        "lifecycleState": _lifecycle_state(r),
        "attempt": r.attempt or 0,
        "leaseExpiresInS": _lease_expires_in(r),
        "dependsOn": r.depends_on_run_ids or [],
        "outputArtifactIds": r.output_artifact_ids or [],
        "createdAt": r.created_at,
        "finishedAt": r.finished_at,
        "jobId": job.id if job else None,
    }


def list_task_groups(
    session: Session,
    *,
    user_id: str,
    conversation_id: str | None = None,
    limit: int = 40,
) -> list[dict[str, Any]]:
    stmt = select(AsyncTaskGroup).where(AsyncTaskGroup.user_id == user_id)
    if conversation_id:
        stmt = stmt.where(AsyncTaskGroup.conversation_id == conversation_id)
    stmt = stmt.order_by(AsyncTaskGroup.created_at.desc()).limit(limit)
    groups = list(session.exec(stmt))
    return [serialize_group(session, g) for g in groups]


def adopt_post_run(session: Session, run: AgentRun) -> int:
    """run 成功后把该 run 新产出的产物采纳（写回原处），返回采纳条数。

    与 ``routers.projects.adopt_artifact`` 的采纳语义对齐（status / adopted_at /
    version），但不走 ontology 物化、进度推进与线上评测——本函数只解决
    「前几步结果没写回原处」：按 ``run.input_json`` 的 adoptType/adoptMode，
    采纳 ``created_by_run_id == run.id`` 的产物。

    - 无 adoptType 或 project_id 时返回 0。
    - strong 模式下 core_hook 走 ``can_strong_adopt`` 门禁，不满足回退 draft。
    - 幂等：只处理 ``adopted_at`` 为空的产物，已采纳的不重复计入、不误改。
    """
    input_json = run.input_json or {}
    adopt_type = input_json.get("adoptType")
    if not adopt_type or not run.project_id:
        return 0
    from .agent_colleagues import is_agent_colleague_id
    from .models import Bot
    if run.knowledge_role_version or (not is_agent_colleague_id(run.agent_id) and session.get(Bot, run.agent_id)):
        return 0
    mode = input_json.get("adoptMode") or "draft"

    arts = list(
        session.exec(
            select(Artifact).where(
                Artifact.project_id == run.project_id,
                Artifact.type == adopt_type,
                Artifact.created_by_run_id == run.id,
                Artifact.adopted_at == None,  # noqa: E711
            )
        )
    )
    adopted = 0
    for art in arts:
        final_mode = mode
        if mode == "strong" and art.type == "core_hook" and art.body_json:
            checks = check_core_hook_adoption(art.body_json, "strong")
            if not can_strong_adopt(checks):
                final_mode = "draft"
        art.status = "adopted" if final_mode == "strong" else "draft"
        art.adopted_at = utcnow()
        art.version += 1
        art.updated_at = utcnow()
        session.add(art)
        # 对齐 routers.projects.adopt_artifact：strong 采纳 core_hook 后推进项目
        # progress / stage，保证下游闸门与看板读到「已强采纳核心梗」的状态。
        if final_mode == "strong" and art.type == "core_hook":
            project = session.get(Project, run.project_id)
            if project:
                project.progress = {**(project.progress or {}), "S2_HOOK_SELECT": 1}
                from .routers.projects import _set_stage

                if project.format == "manju":
                    # 九格金牌路径：强采纳核心梗后进入 100 字测试人工闸，禁止直接跳大纲
                    _set_stage(session, project, "S2_LOGLINE_100", reason="强采纳核心梗")
                elif project.format == "short_novel":
                    # 短篇无独立核心梗闸：强采纳后落到换元阶段，而非原地不动
                    _set_stage(session, project, "S2_SWAP", reason="强采纳核心梗")
                project.updated_at = utcnow()
                session.add(project)
        adopted += 1
    if adopted:
        session.commit()
    return adopted


def patch_run_progress(
    session: Session,
    run_id: str,
    *,
    progress_pct: int | None = None,
    progress_stage: str | None = None,
) -> None:
    run = session.get(AgentRun, run_id)
    if not run:
        return
    if progress_pct is not None:
        run.progress_pct = max(0, min(100, int(progress_pct)))
    if progress_stage is not None:
        run.progress_stage = progress_stage
    session.add(run)
    job = _find_job_for_run(session, run_id)
    if job:
        if progress_pct is not None:
            job.progress_pct = run.progress_pct
        if progress_stage is not None:
            job.progress_stage = progress_stage
        session.add(job)
    session.commit()
    publish_task_event(
        {
            "type": "progress",
            "runId": run_id,
            "jobId": job.id if job else None,
            "taskGroupId": run.task_group_id,
            "progressPct": run.progress_pct,
            "progressStage": run.progress_stage,
            "agentId": run.agent_id,
            "projectId": run.project_id,
            "conversationId": run.conversation_id,
            "status": run.status,
        }
    )
