"""Authority for project-scoped execution of a saved colleague."""
from hashlib import sha256
import json

from fastapi import HTTPException
from sqlmodel import Session, select

from .models import AgentRun, Bot, BotSkill, Job, KnowledgeDoc, Project, RunStep
from .settings import get_settings

TOOLS = ("kb_search", "kb_read", "artifact_create", "gate_run", "done_check", "tool_search")


LEGACY_DEMO_OWNER = "00000000-0000-4000-8000-000000000001"


def canonical_bot_owner(owner):
    return LEGACY_DEMO_OWNER if owner == "demo_user" else owner


def bot_owner_ids(owner):
    # Before project-aware colleagues, bot_registry used this exact owner sentinel.
    return (owner, "demo_user") if owner == LEGACY_DEMO_OWNER else (owner,)


def team_members(session, team_id, owner):
    from .models import BotTeam
    team = session.get(BotTeam, team_id)
    if not team or team.owner_user_id not in bot_owner_ids(owner):
        raise HTTPException(403, "团队不存在或不属于当前用户")
    return team


def owns_bot(bot, owner):
    return bool(bot and (bot.is_system or bot.owner_user_id in bot_owner_ids(owner)))


def owned_project(session, project_id, owner):
    project = session.get(Project, project_id, populate_existing=True) if project_id else None
    if not project or project.user_id != owner:
        raise HTTPException(404, "项目不存在或无权使用")
    return project


def validate_config(session, owner, config, tools):
    from .routers.agents_catalog import _load_stage_graphs
    if not isinstance(config, dict) or set(config) - {"enabled", "projectId", "formats", "stage", "documentIds"}:
        raise HTTPException(422, "知识同事配置字段无效")
    if not config or config == {"enabled": False}:
        return {}
    if config.get("enabled") is not True:
        raise HTTPException(422, "启用知识执行需要 enabled=true")
    pid = config.get("projectId")
    if pid is not None and (not isinstance(pid, str) or not 0 < len(pid) <= 128):
        raise HTTPException(422, "项目 ID 无效")
    project = owned_project(session, pid, owner) if pid else None
    formats, docs = config.get("formats"), config.get("documentIds")
    for values, maximum in [(formats, 8), (docs, 32)]:
        if (not isinstance(values, list) or not 1 <= len(values) <= maximum
                or any(not isinstance(x, str) or not 0 < len(x) <= 128 for x in values)
                or len(set(values)) != len(values)):
            raise HTTPException(422, "请选择有效且唯一的格式与知识文档")
    graphs = _load_stage_graphs()
    stage = config.get("stage")
    if any(f not in graphs for f in formats) or (project and project.format not in formats):
        raise HTTPException(422, "格式无效或与项目不符")
    if stage is not None and any(not any(s["id"] == stage for s in graphs[f]) for f in formats):
        raise HTTPException(422, "阶段与适用格式不符")
    if not isinstance(tools, list) or len(tools) > len(TOOLS) or any(t not in TOOLS for t in tools) or len(set(tools)) != len(tools):
        raise HTTPException(422, "知识岗位只允许检索、读取、报告和验收工具")
    if tools and not set(TOOLS[:5]).issubset(tools):
        raise HTTPException(422, "知识岗位需要检索、读取、报告和验收工具")
    owned = session.exec(select(KnowledgeDoc.id).where(KnowledgeDoc.user_id == owner, KnowledgeDoc.id.in_(docs))).all()
    if set(docs) != set(owned):
        raise HTTPException(403, "知识文档不存在或未获授权")
    return dict(config)


def colleague(session, identity, owner, project_id, *, check_scope=True):
    from .bot_registry import get_bot
    bot = get_bot(session, identity)
    if bot and not bot.is_system:
        bot = session.get(Bot, bot.id, populate_existing=True)
    if not owns_bot(bot, owner) or bot.status != "active":
        raise HTTPException(404, "同事不存在、已停用或无权使用")
    if check_scope and (bot.execution or {}).get("enabled"):
        config = validate_config(session, owner, bot.execution, bot.tool_allowlist)
        project = owned_project(session, project_id, owner)
        if (config.get("projectId") not in (None, project.id) or project.format not in config["formats"]
                or config.get("stage") not in (None, project.stage)):
            raise HTTPException(403, "请选择该知识同事获准的项目、格式和阶段")
    return bot


def card(bot):
    cfg = bot.execution
    return dict(id=bot.id, name=bot.name, persona=bot.name, summary=bot.persona, team="知识顾问",
                formats=cfg["formats"], stage=cfg.get("stage"), projectId=cfg.get("projectId"),
                tools=list(bot.tool_allowlist or TOOLS), modelProfile=bot.model_profile, custom=True)


def resolve_agent(session, identity, project_id, owner):
    from .agent_colleagues import agent_id_from_bot_id, load_catalog_by_id
    owned_project(session, project_id, owner)
    identity = agent_id_from_bot_id(identity)
    builtin = load_catalog_by_id().get(identity)
    if builtin:
        colleague(session, identity, owner, project_id)
        return builtin
    if not session.get(Bot, identity):
        raise HTTPException(400, f"unknown agent: {identity}")
    bot = colleague(session, identity, owner, project_id)
    if not (bot.execution or {}).get("enabled"):
        raise HTTPException(422, "此同事尚未启用知识执行")
    return card(bot)


def catalog(session, project_id=None, owner=None, *, directory=False):
    from .routers.agents_catalog import _load_agent_catalog
    owner = owner or get_settings().demo_user_id
    items = _load_agent_catalog()
    if project_id:
        owned_project(session, project_id, owner)
    elif not directory:
        return items
    for bot in session.exec(select(Bot).where(Bot.owner_user_id.in_(bot_owner_ids(owner)), Bot.status == "active", Bot.is_system == False)):
        if not (bot.execution or {}).get("enabled"):
            if directory:
                items.append(dict(id=bot.id,name=bot.name,summary=bot.persona,team="我的同事",formats=["*"],custom=True))
            continue
        try:
            if project_id:
                colleague(session, bot.id, owner, project_id)
            else:
                validate_config(session, owner, bot.execution, bot.tool_allowlist)
        except HTTPException:
            continue
        item = card(bot)
        project = session.get(Project, item["projectId"]) if item["projectId"] else None
        item.update(projectTitle=project.title if project else None,
                    documentCount=len(bot.execution["documentIds"]),
                    when="核查授权资料中的事实、出处与待考问题",
                    doneContract=[{"type": "artifact_count", "artifact": "qc_report", "min": 1},
                                  {"type": "gate_pass", "gates": ["Schema"]}])
        items.append(item)
    return items


def validate_knowledge_input(role, inputs):
    if role.get("custom") and isinstance(inputs, dict) and ("adoptType" in inputs or "adoptMode" in inputs):
        raise HTTPException(422, "知识报告须保留为候选，不能自动采纳")


def validate_reference_ids(scope, refs):
    if not scope.get("enabled") or any(kind != "kb_doc" or identity not in scope["documentIds"] for kind, identity in refs):
        raise HTTPException(403, "引用文档已超出该知识同事的当前授权范围")


def current_selected_sources(session, refs):
    from .context_refs import content_hash
    from .routers.kb import _doc_text
    sources = {}
    for ref in refs:
        identity = ref["sourceId"]
        if identity not in sources:
            doc = session.get(KnowledgeDoc, identity, populate_existing=True)
            if not doc:
                raise HTTPException(409, "引用文档已移除，请重新选择原文")
            text = _doc_text(doc)
            sources[identity] = (text, content_hash(text))
        if sources[identity][1] != ref["contentHash"]:
            raise HTTPException(409, "引用原文已变更，请重新选择原文后发起核查")
    return sources


def selected_references(session, bot, project_id, refs):
    """Project immutable intake identities onto the authorized current KB text."""
    from .context_refs import resolve_refs, utf16_slice
    from .schemas import ContextRefRequest

    validate_reference_ids(bot.execution, [(ref.get("kind"), ref.get("sourceId")) for ref in refs])
    for ref in refs:
        if not ref.get("id") or not ref.get("snapshotId") or ref.get("projectId") not in (None, project_id):
            raise HTTPException(409, "选区来源或项目不匹配，请重新选择原文")
    canonical = resolve_refs(session, [ContextRefRequest.model_validate(ref) for ref in refs])
    selected = [r.model_dump(by_alias=True, exclude_none=True, exclude={"context_before", "context_after"})
                for r in canonical.refs]
    sources = current_selected_sources(session, selected)
    for ref in selected:
        text, _ = sources[ref["sourceId"]]
        quote, offset, end = utf16_slice(text, ref["start"], ref["end"])
        if quote != ref["quote"]:
            raise HTTPException(409, "选区文本与原文不一致，请重新选择原文")
        ref.update(rangeUnit="utf16", offsetUnit="codePoint", offset=offset, limit=end-offset)
    return selected


def selected_job(session, run):
    if not run:
        return None
    return next((job for job in session.exec(select(Job).where(Job.result_ref == run.id, Job.type == "agent.run"))
                 if job.payload.get("selectedReferences")), None)


def knowledge_admission(session, conv, target_id, payload, admitted_ids=None):
    """Record the server-selected knowledge recipients, independently of later Bot edits."""
    if admitted_ids is None:
        members = list(conv.member_bot_ids or [])
        team = team_members(session, conv.team_id, conv.user_id) if conv.team_id else None
        if not members and team:
            members = team.member_bot_ids or []
        lead = (conv.group_rules or {}).get("lead_bot_id") or (team.lead_bot_id if team else None)
        candidates = {identity for identity in [conv.bot_id, target_id, lead, *members,
                      *(payload.get("mention_bot_ids") or [])] if identity}
        if not candidates:
            return None
        rows = session.exec(select(Bot.id, Bot.execution).where(Bot.id.in_(candidates)))
        admitted_ids = [identity for identity, config in rows if (config or {}).get("enabled")]
    if not admitted_ids:
        return None
    refs = [(ref.get("kind"), ref.get("sourceId")) for ref in payload.get("contextRefs") or []]
    for identity in admitted_ids:
        participant = colleague(session, identity, conv.user_id, conv.project_id)
        validate_reference_ids(participant.execution or {}, refs)
    # Stage checkpoints retain identities even when the original inbox turn has ended.
    fields = ("kind", "sourceId", "id", "projectId", "version", "snapshotId", "start", "end")
    selections = [{k: ref[k] for k in fields if k in ref} for ref in payload.get("contextRefs") or []]
    return {"projectId":conv.project_id, "botIds":sorted(set(admitted_ids)),
            **({"selections": selections} if selections else {}),
            **({"recipientBotId":conv.bot_id} if conv.kind != "group" and conv.bot_id in admitted_ids else {}),
            "documentIds":list(dict.fromkeys(doc for _,doc in refs))}


def validate_knowledge_delivery(session, conv, payloads, bot_id=None):
    """Return the knowledge recipients authorized for this already-admitted work."""
    validated = set()
    for payload in payloads:
        admission = (payload or {}).get("knowledgeAdmission") or {}
        if bot_id and "knowledgeAdmission" not in (payload or {}) and (payload or {}).get("contextRefs"):
            # A pending, referenced turn from before admission provenance existed cannot
            # establish which mode a currently ordinary custom colleague was assigned.
            stored = session.get(Bot, bot_id, populate_existing=True)
            if stored and not stored.is_system and not (stored.execution or {}).get("enabled"):
                raise HTTPException(409, "旧派单缺少来源授权记录，请重新发起")
        if admission.get("recipientBotId") and conv.bot_id != admission["recipientBotId"]:
            raise HTTPException(409, "派单同事与会话当前同事不符")
        for identity in admission.get("botIds", []):
            if admission.get("projectId") != conv.project_id:
                raise HTTPException(409, "知识派单所属项目已变更，请重新发起")
            participant = colleague(session, identity, conv.user_id, conv.project_id)
            validate_reference_ids(participant.execution or {},
                                   [("kb_doc", doc) for doc in admission.get("documentIds", [])])
            if payload.get("contextRefs"):
                selected_references(session, participant, conv.project_id, payload["contextRefs"])
            validated.add(identity)
    return validated


def run_role(session: Session, run_id, job_id, owner, *, initialize=False, selected_sources=None):
    job, run = session.get(Job, job_id), session.get(AgentRun, run_id)
    if (not job or not run or job.type != "agent.run" or job.result_ref != run.id or job.user_id != owner
            or job.project_id != run.project_id or job.payload.get("agentId") != run.agent_id):
        raise HTTPException(403, "任务、运行和项目绑定无效")
    meta = resolve_agent(session, run.agent_id, run.project_id, owner)
    if not meta.get("custom"):
        raise HTTPException(422, "仅用于自定义知识岗位")
    bot = session.get(Bot, run.agent_id)
    skills = session.exec(select(BotSkill).where(BotSkill.bot_id == bot.id).order_by(BotSkill.id)).all()
    instructions = dict(persona=bot.persona, tone=bot.tone, duties=bot.duties, neverDo=bot.never_do,
                        skills=[dict(name=s.name, version=s.version, steps=s.steps_md) for s in skills])
    role = dict(**meta, documentIds=bot.execution["documentIds"], instructions=instructions, runId=run_id, runProjectId=run.project_id)
    role["version"] = sha256(json.dumps(role, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    # Explicit tool lists remain authoritative. This scoped default is runtime metadata,
    # outside the historical role digest, and is rechecked for each revision.
    role["canReviseOwnReport"] = not bot.tool_allowlist
    version = role["version"]
    if job.payload.get("selectedReferences"):
        refs = job.payload["selectedReferences"]
        validate_reference_ids(bot.execution, [(r["kind"], r["sourceId"]) for r in refs])
        current = current_selected_sources(session, refs)
        if selected_sources is not None:
            selected_sources.update(current)
        role["selectedReferences"] = refs
    pinned = run.knowledge_role_version
    if pinned is None:
        # For historical jobs the worker's original run_start is the binding.
        starts = session.exec(select(RunStep.payload).where(RunStep.run_id == run.id, RunStep.kind == "run_start"))
        versions = {p["roleVersion"] for p in starts if p.get("roleVersion") and not p.get("child_run_id")}
        if versions:
            if versions != {version}:
                raise HTTPException(409, "本次运行的原始知识授权已变更")
            return role
        if not initialize:
            raise HTTPException(409, "本次运行尚未绑定知识岗位")
        from sqlalchemy import update
        session.execute(update(AgentRun).where(AgentRun.id == run.id, AgentRun.knowledge_role_version.is_(None))
                        .values(knowledge_role_version=version).execution_options(synchronize_session=False))
        session.commit()
        session.refresh(run)
        pinned = run.knowledge_role_version
    if pinned != version:
        raise HTTPException(409, "本次知识岗位授权版本已变更")
    return role
