"""Grounded Dream candidates from completed human turns, within their project audience."""

import re
from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlmodel import Session, select

from .agent_colleagues import is_agent_colleague_id
from .knowledge_colleague import colleague, owned_project
from .memory_service import _private_store_ids, memory_hash, resolve_store_id
from .models import AgentEvent, AgentRun, Conversation, DreamChange, DreamJob, FeishuIdentity, MemoryFile, MemoryStore, Message
from .seed import DEMO_USER

# Conservative sentence grammar. A following acknowledgement request is outside the quote.
_DECLARATION = re.compile(
    r"\s*(?P<quote>(?:(?P<fact>(?:本项目|这个项目|本书|本剧)的(?:正式)?"
    r"(?:代号|名称|书名|主角|主人公|题材|背景|叙事视角)(?:是|为))|"
    r"(?P<preference>我(?:一直|一贯|长期)(?:喜欢|偏好|倾向于)))"
    r"(?P<value>[\w·《》、 —-]{1,80})[。.!！]?)"
    r"(?:\s*请(?:只|仅)?回复[“「\"].{1,16}?[”」\"](?:，不调用工具)?[。！!]?)?\s*"
)
_QUESTION_VALUE = re.compile(
    r"^(?:到底|究竟)?(?:什么|谁(?:$|的|来)|哪(?:个|位|种|部|本|里|儿|一[个种位部本])|"
    r"怎样|怎么样|如何|多少|几(?:个|位|种|部|本))|[吗呢么]$"
)
_QUALIFIED = re.compile(r"可能|也许|或许|暂时|暂定|目前|这次|本次|如果|假设|示例|举例|不确定|有人说|据说|待定|有争议|考虑|应该|尚未|不是|改成|忽略|指令|调用")


def eligible_conversation(conv, project_id):
    return bool(project_id and conv and conv.project_id == project_id and conv.user_id == DEMO_USER
                and conv.source in {"assistant", "feishu"} and conv.kind == "dm"
                and conv.bot_id in (None, "chief") and not conv.team_id and not conv.member_bot_ids
                and not conv.group_rules)


def check_dream_scope(session: Session, job: DreamJob, *, selectors=False):
    if job.project_id:
        owned_project(session, job.project_id, DEMO_USER)
    store = session.get(MemoryStore, job.store_id)
    owner, _ = _private_store_ids(job.store_id)
    if job.store_id.startswith("project."):
        if job.store_id not in {f"project.{job.project_id}.bible", f"project.{job.project_id}.journal"} or not job.project_id:
            raise HTTPException(403, "记忆库与项目不匹配")
        if store and store.scope_ref not in (None, job.project_id):
            raise HTTPException(403, "记忆库的项目已改变")
    elif owner:
        if not is_agent_colleague_id(owner):
            colleague(session, owner, DEMO_USER, job.project_id)
    elif job.store_id not in {"user.profile", "user.archive", "org.methodology"}:
        raise HTTPException(400, "此记忆库不支持 Dreaming")
    if store and store.status == "retired":
        raise HTTPException(409, "记忆库已停用")
    if not selectors:
        return
    if len(job.session_ids) + len(job.run_ids) > 64 or not 1 <= job.window_hours <= 8760:
        raise HTTPException(422, "扫描窗口或来源数量超出范围")
    if (job.session_ids or job.run_ids) and job.store_id != f"project.{job.project_id}.bible":
        raise HTTPException(403, "会话候选限同一项目共享库")
    for cid in job.session_ids:
        if not eligible_conversation(session.get(Conversation, cid), job.project_id):
            raise HTTPException(403, "会话来源不可用")
    for rid in job.run_ids:
        run = session.get(AgentRun, rid)
        if not run or run.project_id != job.project_id or not eligible_conversation(
            session.get(Conversation, run.conversation_id) if run.conversation_id else None, job.project_id
        ):
            raise HTTPException(403, "运行来源不可用")


def target_allowed(session, job, ch):
    _, stores = _private_store_ids(job.store_id)
    row = session.get(MemoryFile, ch.path)
    project_path = ch.path.startswith("/memories/projects/")
    path_project = ch.path.split("/")[3] if project_path else None
    if project_path and job.project_id and path_project != job.project_id:
        return False
    if project_path:
        try:
            owned_project(session, path_project, DEMO_USER)
        except HTTPException:
            return False
    return (resolve_store_id(ch.path) in stores and
            (not row or (row.user_id == DEMO_USER and row.project_id in (None, path_project or job.project_id)
                         and row.store_id in (None, *stores))))


def _source(session, job, msg):
    if not msg or msg.role != "user" or msg.bot_id or msg.evidence or msg.mentions:
        return
    conv = session.get(Conversation, msg.conversation_id)
    if not eligible_conversation(conv, job.project_id) or (job.session_ids and conv.id not in job.session_ids):
        return
    actions = msg.actions or []
    if len(actions) != 1 or actions[0].get("type") != "inbox_event":
        return
    ids = actions[0].get("eventIds") or []
    if len(ids) != 1:
        return
    ev = session.get(AgentEvent, ids[0])
    if not ev or ev.status != "done" or ev.conversation_id != conv.id or ev.target_bot_id not in (None, "chief"):
        return
    p = ev.payload or {}
    if (ev.source != {"assistant": "web", "feishu": "feishu"}[conv.source] or p.get("message") != msg.content
            or p.get("project_id") != job.project_id or p.get("contextRefs") or p.get("mention_bot_ids")
            or p.get("knowledgeAdmission") or p.get("force_continue")):
        return
    if ev.source == "feishu":
        chat = conv.external_chat_id
        if not chat or p.get("chat_id") != chat or not ev.dedupe_key:
            return
        ingress = session.exec(select(AgentEvent).where(
            AgentEvent.conversation_id == f"feishu-ingress:{chat}", AgentEvent.source == "feishu_ingress",
            AgentEvent.dedupe_key == ev.dedupe_key)).first()
        item = ingress.payload if ingress else {}
        identity = session.exec(select(FeishuIdentity).where(
            FeishuIdentity.open_id == conv.external_open_id, FeishuIdentity.user_id == conv.user_id)).first()
        if (not identity or item.get("kind") != "message" or item.get("chat_id") != chat or item.get("is_bot") is not False
                or item.get("chat_type") not in {"p2p", "private", "dm"} or not conv.external_open_id
                or item.get("open_id") != conv.external_open_id or (item.get("text") or "").strip() != msg.content.strip()):
            return
    run_id = msg.run_id or p.get("run_id") or p.get("runId")
    if job.run_ids and run_id not in job.run_ids:
        return
    if run_id:
        run = session.get(AgentRun, run_id)
        if not run or (run.project_id, run.conversation_id) != (job.project_id, conv.id):
            return
    match = _DECLARATION.fullmatch(msg.content) if len(msg.content) <= 1000 else None
    if not match or _QUALIFIED.search(match["quote"]) or _QUESTION_VALUE.search(match["value"].strip()):
        return
    return dict(category="project_fact" if match["fact"] else "durable_preference",
                audience="project", ownerId=conv.user_id, projectId=conv.project_id, conversationId=conv.id,
                messageId=msg.id, eventId=ev.id, runId=run_id, sourceHash=memory_hash(msg.content),
                start=match.start("quote"), end=match.end("quote"), quote=match["quote"])


def current_change(session, job, ch):
    if not target_allowed(session, job, ch):
        return False
    if not ch.provenance:
        return not ch.candidate_key
    return (job.store_id == f"project.{job.project_id}.bible" and
            _source(session, job, session.get(Message, ch.provenance["messageId"])) == ch.provenance)


def conversation_changes(session, job):
    if job.store_id != f"project.{job.project_id}.bible":
        return []
    query = select(Message).join(Conversation, Message.conversation_id == Conversation.id).where(
        Conversation.user_id == DEMO_USER, Conversation.project_id == job.project_id, Conversation.kind == "dm",
        Conversation.team_id.is_(None), or_(Conversation.bot_id.is_(None), Conversation.bot_id == "chief"),
        Conversation.source.in_(("assistant", "feishu")), Message.role == "user", func.length(Message.content) <= 1000,
        Message.created_at.between(job.created_at - timedelta(hours=job.window_hours), job.created_at))
    if job.session_ids:
        query = query.where(Message.conversation_id.in_(job.session_ids))
    if job.run_ids:
        query = query.where(Message.conversation_id.in_(select(AgentRun.conversation_id).where(AgentRun.id.in_(job.run_ids))))
    changes = []
    for msg in session.exec(query.order_by(Message.created_at.desc(), Message.id).limit(160)):
        evidence = _source(session, job, msg)
        if not evidence:
            continue
        key = memory_hash("|".join([job.store_id, msg.id, evidence["sourceHash"], evidence["quote"]]))
        if session.exec(select(DreamChange.id).where(DreamChange.candidate_key == key)).first():
            continue
        path = f"/memories/projects/{job.project_id}/semantic/{key[:24]}.md"
        changes.append(dict(path=path, op="create", after_content=evidence["quote"], candidate_key=key,
                            provenance=evidence, rationale="已完成私聊中的用户原话，待确认后供本项目检索。"))
        if len(changes) >= 24:
            break
    return changes
