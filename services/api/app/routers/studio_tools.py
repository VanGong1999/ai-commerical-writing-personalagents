"""Conversation-scoped adapters for the existing studio operations."""
import json
import re

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import and_, or_
from sqlmodel import select

from ..context_refs import artifact_text

from ..models import Artifact, Project
from ..schemas import AdoptArtifactIn, PatchArtifactIn
from .autopilot import AutopilotStartIn, AutopilotStepIn, launch_autopilot

EXACT_PAGE_BUDGET = 6000

NAMES = {"list_artifacts", "adopt_artifact", "read_artifact", "save_artifact",
         "list_artifact_versions", "rollback_artifact", "start_studio_batch"}


def definitions(tool):
    string = {"type": "string"}
    base = {"project_id": string, "artifact_id": string}
    guarded = {**base, "expectedVersion": {"type": "integer", "minimum": 1}}
    return [
        tool("read_artifact", "读取精确正文或结构化 JSON 片段；用 nextOffset 连续读取同一版本，完整读取后再改稿。", {**base, "offset": {"type": "integer", "minimum": 0}, "field": {"type": "string", "enum": ["bodyMarkdown", "bodyJson"]}}, list(base)),
        tool("save_artifact", "按版本保存完整正文 bodyMarkdown 或合并顶层结构化字段 bodyJson。", {**guarded, "bodyMarkdown": string, "bodyJson": {"type": "object"}}, list(guarded)),
        tool("list_artifact_versions", "查看稿件历史版本和快照编号。", base, list(base)),
        tool("rollback_artifact", "按当前版本回滚稿件到历史快照。", {**guarded, "version_id": string}, [*guarded, "version_id"]),
        tool("start_studio_batch", "启动工作室批量补全，默认 step 逐步确认，显式 auto 自动运行。", {
            "project_id": string, "mode": {"enum": ["auto", "step"], "type": "string"},
            "steps": {"type": "array", "items": AutopilotStepIn.model_json_schema()}}, ["project_id", "steps"]),
    ]


def metadata(row):
    return {"id": row.id, "title": row.title[:160], "status": row.status, "type": row.type,
            "version": row.version, "createdByRunId": row.created_by_run_id,
            "batchId": row.batch_id, "parentId": row.parent_id, "projectId": row.project_id}


def validate_body_targets(session, project, steps):
    """Match the studio's missing-unit selection for manually supplied body steps."""
    episodic = project.format in {"manju", "duanju", "ip_adapt"}
    body_type = "scene" if project.format == "duanju" else "manuscript"
    body_steps = [step for step in steps if step.agent_id in
                  {"prose.episode_body", "orch.batch_writer", "prose.novel_body"}]
    if not body_steps:
        return
    if not episodic and len(body_steps) > 1:
        raise ValueError("该格式一次仅能生成一个正文稿")
    bodies = session.exec(select(Artifact).where(
        Artifact.project_id == project.id, Artifact.type == body_type)).all()
    targets = set()
    for row in bodies:
        data = row.body_json if isinstance(row.body_json, dict) else {}
        number = next((data[k] for k in ("episodeNo", "episode_no", "chapterNo", "chapter_no")
                       if data.get(k) is not None), None)
        if not str(number).isdigit() or int(number) < 1:
            header = re.match(r"^\s*(\d+)", str(data.get("scene_header") or ""))
            number = int(header[1]) if header else None
        if number:
            targets.add(int(number))
    for step in body_steps:
        if episodic and (not step.episode_no or step.episode_no < 1):
            raise ValueError("分集正文步骤需要正整数集号")
        if (not episodic and bodies) or step.episode_no in targets:
            raise ValueError("该正文已有稿件或已在计划中")
        targets.add(step.episode_no)


def content_patch(art, args):
    fields = args.get("bodyJson", {})
    if not isinstance(fields, dict) or ("bodyMarkdown" not in args and not fields):
        raise ValueError("需要完整正文 bodyMarkdown 或结构化字段 bodyJson")
    body = {**(art.body_json or {}), **fields}
    patch = {"bodyJson": body} if fields else {}
    if "bodyMarkdown" in args:
        text = args["bodyMarkdown"]
        if not isinstance(text, str):
            raise ValueError("正文必须是字符串")
        if art.type == "scene" or isinstance(body.get("script_body"), str):
            if "script_body" in fields and fields["script_body"] != text:
                raise ValueError("script_body 与正文不一致")
            body["script_body"] = text
        else:
            patch["bodyMarkdown"] = text
        if art.type in {"scene", "manuscript"} or "script_body" in body:
            body["wordCount"] = len(re.sub(r"\s", "", text))
            patch["bodyJson"] = body
    elif "script_body" in fields:
        if not isinstance(fields["script_body"], str):
            raise ValueError("script_body 必须是字符串")
        body["wordCount"] = len(re.sub(r"\s", "", fields["script_body"]))
    return patch


def execute(name, args, session, conv):
    from . import assistant, projects
    from .agents_catalog import _load_agent_catalog

    pid = args.get("project_id") or conv.project_id
    aid = args.get("artifact_id")
    detail = {"tool": name, "projectId": pid, "conversationId": conv.id}
    try:
        if not isinstance(pid, str) or (conv.project_id and conv.project_id != pid):
            raise ValueError("需要当前会话所属项目")
        project = session.get(Project, pid)
        if not project or project.user_id != conv.user_id:
            raise ValueError("找不到该项目")
        if name == "start_studio_batch":
            body = AutopilotStartIn.model_validate({"mode": "step", **args})
            detail["mode"] = body.mode
            formats = {a["id"]: a["formats"] for a in _load_agent_catalog()}
            seen = set()
            for step in body.steps:
                allowed = formats.get(step.agent_id, [])
                if not step.id.strip() or step.id in seen or not set(step.depends_on) <= seen:
                    raise ValueError("步骤编号须唯一，依赖须指向前序步骤")
                if "*" not in allowed and project.format not in allowed:
                    raise ValueError("Agent 不支持该项目格式")
                seen.add(step.id)
            validate_body_targets(session, project, body.steps)
            detail.update(launch_autopilot(pid, body, session, conv.id))
        elif name == "list_artifacts":
            query = select(Artifact).where(Artifact.project_id == pid)
            if args.get("type"):
                query = query.where(Artifact.type == args["type"])
            cursor = args.get("cursor")
            if cursor is not None:
                anchor = session.get(Artifact, cursor) if isinstance(cursor, str) else None
                if not anchor or anchor.project_id != pid or (args.get("type") and anchor.type != args["type"]):
                    raise ValueError("该项目或类型的分页游标无效")
                query = query.where(or_(Artifact.created_at < anchor.created_at,
                                        and_(Artifact.created_at == anchor.created_at, Artifact.id < anchor.id)))
            rows = session.exec(query.order_by(Artifact.created_at.desc(), Artifact.id.desc()).limit(5)).all()
            detail["artifacts"] = [metadata(row) for row in rows[:4]]
            detail["nextCursor"] = rows[3].id if len(rows) > 4 else None
        else:
            art = session.get(Artifact, aid) if isinstance(aid, str) else None
            if not art or art.project_id != pid:
                raise ValueError("找不到该产物")
            detail.update(artifact_id=aid, versionBefore=art.version)
            if name == "read_artifact":
                offset = args.get("offset", 0)
                if type(offset) is not int or offset < 0:
                    raise ValueError("offset 必须为非负整数")
                field = args.get("field", "bodyMarkdown")
                if field not in ("bodyMarkdown", "bodyJson"):
                    raise ValueError("field 必须为 bodyMarkdown 或 bodyJson")
                content = artifact_text(art)
                if field == "bodyJson":
                    content = json.dumps(art.body_json, ensure_ascii=False)
                detail.update(artifact=metadata(art), versionAfter=art.version, offset=offset, length=len(content))
                start = min(offset, len(content))
                def page(end):
                    return {**detail, field: content[start:end], "nextOffset": end if end < len(content) else None}

                def fits(candidate):
                    return len(json.dumps(candidate, ensure_ascii=False, default=str)) <= EXACT_PAGE_BUDGET

                end = min(start + 4000, len(content))
                candidate = page(end)
                if not fits(candidate):
                    low, high = start, end - 1
                    while low < high:
                        middle = (low + high + 1) // 2
                        if fits(page(middle)):
                            low = middle
                        else:
                            high = middle - 1
                    if low == start:
                        raise ValueError("产物元数据超出单页预算")
                    candidate = page(low)
                detail = candidate
            elif name == "list_artifact_versions":
                detail["versions"] = [{"id": v.id, "version": v.version, "title": v.title}
                                      for v in assistant.artifact_versions(pid, aid, session)[:50]]
            else:
                expected = args.get("expectedVersion")
                if type(expected) is not int or expected < 1:
                    raise ValueError("expectedVersion 必须为正整数")
                if name == "adopt_artifact":
                    projects.adopt_artifact(pid, aid, AdoptArtifactIn(expectedVersion=expected, mode=args.get("mode", "strong")), session)
                elif name == "save_artifact":
                    patch = content_patch(art, args)
                    projects.patch_artifact(pid, aid, PatchArtifactIn(
                        expectedVersion=expected, viaOntologyAction=True, **patch), session)
                else:
                    if not isinstance(args.get("version_id"), str):
                        raise ValueError("需要历史快照 version_id")
                    assistant.artifact_rollback(pid, aid, args["version_id"], {"expectedVersion": expected}, session)
                    detail["versionId"] = args["version_id"]
            detail.update(artifact=metadata(art), versionAfter=art.version)
    except (HTTPException, ValidationError, ValueError) as exc:
        detail["error"] = exc.detail if isinstance(exc, HTTPException) else str(exc)
    return json.dumps(detail, ensure_ascii=False, default=str), detail
