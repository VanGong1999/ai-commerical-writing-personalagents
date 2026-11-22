"""右下角 AI 助手：对话 + 代操作（运行 agent / 定时任务 / 爬虫 / 知识库检索）+ 运行痕迹。"""
from __future__ import annotations

from ..usage_attribution import record_model_usage

import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import update
from sqlmodel import Session, select

from ..db import get_session
from ..models import (
    ActivityLog,
    AgentRun,
    Artifact,
    ArtifactVersion,
    CrawlerSource,
    Job,
    MemoryFile,
    Project,
    ScheduledTask,
    new_id,
    utcnow,
)
from ..queue import enqueue_job, publish_job_event
from ..scheduling import SCHEDULE_TASK_JOB_TYPES, initial_run_at, validate_schedule, validate_schedule_job_type
from ..schemas import (
    ActivityLogOut,
    ArtifactVersionOut,
    AssistantAction,
    AssistantChatIn,
    AssistantChatOut,
    CowriteIn,
    CowriteOut,
)
from ..settings import get_settings
from ..personal_agent_output import validate_tool_batch, validate_agent_output, IncompleteAgentOutput
from ..llm_service import chat_completion, resolve_default_model


def _clean_dsml(text: str) -> str:
    """清理 DeepSeek 函数调用残留的 DSML 标记，保留自然语言。"""
    if re.match(r"<\s*[|｜]*\s*DSML\s*[|｜]*\s*(?:function_calls|invoke)(?=[\s/>]|$)", text.strip()):
        if _extract_dsml_tool_calls(text):
            return ""
    return text.strip()


def _extract_dsml_tool_calls(content: str) -> list[dict[str, Any]]:
    """DeepSeek 偶发把函数调用写进 content 而非 tool_calls，这里兜底解析。"""
    from xml.etree import ElementTree as ET
    prefix = r"<\s*[|｜]*\s*DSML\s*[|｜]*\s*"
    if not re.match(prefix + r"(?:function_calls|invoke)(?=[\s/>]|$)", content.strip()):
        return []
    xml = re.sub(r"<(/?)\s*[|｜]*\s*DSML\s*[|｜]*\s*(function_calls|invoke|parameter)(?=[\s/>]|$)", r"<\1dsml_\2", content.strip())
    try:
        root = ET.fromstring(xml)
    except ET.ParseError as exc:
        raise HTTPException(502, "模型 DSML 不完整") from exc
    invokes = [root] if root.tag == "dsml_invoke" else list(root)
    if root.tag not in {"dsml_invoke", "dsml_function_calls"} or not invokes or (root.text or "").strip():
        raise HTTPException(502, "模型 DSML 无效")
    calls = []
    for invoke in invokes:
        if invoke.tag != "dsml_invoke" or not invoke.get("name") or (invoke.text or "").strip() or (invoke.tail or "").strip():
            raise HTTPException(502, "模型工具调用无效")
        params = {}
        for param in invoke:
            key = param.get("name")
            if param.tag != "dsml_parameter" or not key or key in params or len(param) or (param.tail or "").strip():
                raise HTTPException(502, "模型工具参数无效")
            params[key] = (param.text or "").strip()
        calls.append({"function": {"name": invoke.get("name"), "arguments": json.dumps(params, ensure_ascii=False)}})
    return calls

router = APIRouter(tags=["assistant"])

_KB_CORE = Path(__file__).resolve().parents[4] / "packages" / "kb-core"
if _KB_CORE.exists() and str(_KB_CORE) not in sys.path:
    sys.path.insert(0, str(_KB_CORE))


def _user() -> str:
    return get_settings().demo_user_id


# 右下角助手写类操作走统一审计+通知；读类仍用轻量 ActivityLog
_ASSISTANT_WRITE_ACTIONS = frozenset(
    {
        "run_agent",
        "schedule_task",
        "crawl",
        "cowrite",
        "create_project",
        "adopt",
        "start_async_task",
        "memory_write",
    }
)


def _log(
    session: Session,
    *,
    actor: str,
    action: str,
    summary: str,
    project_id: str | None = None,
    conversation_id: str | None = None,
    detail: dict[str, Any] | None = None,
) -> ActivityLog:
    if action in _ASSISTANT_WRITE_ACTIONS:
        from ..action_audit import record_action

        return record_action(
            session,
            actor=actor or "assistant",
            action=action,
            summary=summary,
            target=f"project:{project_id}" if project_id else "",
            project_id=project_id,
            conversation_id=conversation_id,
            bot_id="chief",
            detail=detail or {},
            notify=True,
        )
    row = ActivityLog(
        actor=actor,
        action=action,
        summary=summary,
        project_id=project_id,
        conversation_id=conversation_id,
        detail=detail or {},
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def _search_distilled(q: str, limit: int = 6) -> list[dict[str, Any]]:
    try:
        from kb_core import search_knowledge  # type: ignore
    except Exception as exc:  # noqa: BLE001
        return [{"title": "知识索引不可用", "snippet": str(exc), "source": "error"}]

    index_path = (
        Path(__file__).resolve().parents[4] / "knowledge" / "00-meta" / "search-index.json"
    )
    if not index_path.exists():
        return [{"title": "未找到知识索引", "snippet": str(index_path), "source": "error"}]
    try:
        hits = search_knowledge(q, {"limit": limit}, index_path=index_path)
    except Exception as exc:  # noqa: BLE001
        return [{"title": "检索失败", "snippet": str(exc), "source": "error"}]
    out: list[dict[str, Any]] = []
    for h in hits:
        d = h.to_dict() if hasattr(h, "to_dict") else (h if isinstance(h, dict) else {"title": str(h)})
        out.append(d)
    return out[:limit]


def _latest_project(session: Session, format: str | None = None) -> Project | None:
    rows = list(session.exec(select(Project).order_by(Project.last_opened_at.desc())).all())
    if format:
        rows = [p for p in rows if p.format == format]
    return rows[0] if rows else None


AGENT_BY_KEYWORD: list[tuple[re.Pattern, str, str]] = [
    (re.compile(r"核心梗|选题|四步|hook"), "topic.core_hook_batch", "核心梗批量生成"),
    (re.compile(r"人设|人物小传|角色"), "char.bio_manju", "人物小传生成"),
    (re.compile(r"大纲|分集|章纲|卷纲"), "struct.episode_outline", "分集大纲生成"),
    (re.compile(r"正文|剧本|分镜"), "prose.storyboard", "正文/分镜生成"),
    (re.compile(r"去.?ai.?味|润色"), "qc.de_ai", "去 AI 味"),
    (re.compile(r"爽点|打脸"), "struct.cool12", "爽点结构"),
    (re.compile(r"期待感|钩子|伏笔"), "struct.expectation", "期待感/伏笔"),
    (re.compile(r"质检|门禁"), "qc.human_checklist", "质检校稿"),
]


def _detect_agent(message: str) -> tuple[str, str] | None:
    for pattern, agent_id, label in AGENT_BY_KEYWORD:
        if pattern.search(message):
            return agent_id, label
    return None


def _route_for(path: str | None, message: str) -> str | None:
    m = message
    if "灵感" in m or "选题" in m and "核心梗" not in m:
        return "/inspiration"
    if "知识库" in m or "拆书" in m or "换元" in m:
        return "/kb"
    if "项目" in m and "新建" in m:
        return "/projects/new"
    if "项目" in m:
        return "/projects"
    if "记忆" in m:
        return "/memory"
    if "token" in m.lower():
        return "/tokens"
    if "设置" in m or "模型" in m:
        return "/settings"
    if "爬虫" in m or "热点" in m:
        return "/kb/crawler"
    if path and path.strip():
        return path.strip()
    return None


_REQUEST_START = r"(?:^|[，。；,\n])\s*(?:(?:请(?:你)?|麻烦|帮我|给我|替我)\s*)*"
_SCHEDULE_COMMAND = r"(?:安排|设置|新建|创建|添加)"
_SCHEDULE_DAYPART = r"(?:早上|上午|中午|下午|晚上)?\s*"
_SCHEDULE_CLOCK = r"(?:\d{1,2}[:：]\d{2}|[0-9零一二两三四五六七八九十]+[点时](?:钟|半|[0-9零一二两三四五六七八九十]+分)?)"
_SCHEDULE_TIME = (
    rf"(?:{_SCHEDULE_COMMAND}\s*)?(?:在|从)?\s*(?:"
    r"(?:定时|定期|每(?:日|天|早|晚|小时|分钟|月|个工作日)|"
    r"(?:每|下)?(?:周|星期)[一二三四五六日天]?|明[天早晚]|后天|今晚|稍后|"
    r"每隔[0-9零一二两三四五六七八九十]+\s*(?:分钟|个?小时|天|周)|"
    r"[0-9零一二两三四五六七八九十]+\s*(?:分钟|个?小时|天|周)后)"
    rf"\s*{_SCHEDULE_DAYPART}(?:{_SCHEDULE_CLOCK})?"
    rf"|今天\s*{_SCHEDULE_DAYPART}{_SCHEDULE_CLOCK})"
    r"\s*(?:(?:自动|再|帮我|给我)\s*)*"
)


def _is_schedule_request(message: str) -> bool:
    return bool(re.search(
        rf"{_REQUEST_START}(?:"
        rf"{_SCHEDULE_TIME}(?:爬取|爬热点|爬榜|抓取|扫榜|执行|运行|生成|汇总|刷新|重建|检查|评估|提醒)"
        rf"|{_SCHEDULE_COMMAND}(?:一?[个条])?(?:定时|定期|一次性)任务"
        r"|(?:please\s+)?schedule\b)",
        message,
        re.IGNORECASE,
    ))


def _is_reminder_request(message: str) -> bool:
    return bool(re.search(
        rf"{_REQUEST_START}(?:"
        rf"{_SCHEDULE_TIME}提醒|提醒(?:我|我们|自己|一下)|"
        r"(?:设(?:置)?|定|添加|创建)(?:一?[个条])?(?:定时)?(?:提醒|闹钟)|"
        r"(?:please\s+)?remind\s+me\b)",
        message,
        re.IGNORECASE,
    ))


def _schedule_handoff() -> AssistantChatOut:
    reply = "定时任务未创建。请在总编工作台重新发送请求，说明时间以及要提醒的内容或要执行的操作。"
    return AssistantChatOut(
        reply=reply,
        actions=[AssistantAction(type="navigate", label="打开总编工作台", to="/agent")],
        tool_results=[{"type": "schedule_error", "summary": reply}],
    )


def _schedule_spec(args: dict[str, Any], now: datetime) -> tuple[str, str, datetime]:
    job_type = (args.get("job_type") or "").strip()
    if not job_type:
        raise ValueError("请明确要执行的任务类型。")
    job_type = validate_schedule_job_type(job_type)
    try:
        cron = validate_schedule(args.get("cron") or "")
        next_run_at = initial_run_at(cron, now)
    except OverflowError as exc:
        raise ValueError("执行时间超出可用范围。") from exc
    if next_run_at <= now:
        raise ValueError("请提供未来的执行时间。")
    return cron, job_type, next_run_at


TOOL_SCHEMAS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "search_knowledge",
            "description": "检索写作知识库（换元法、核心梗、爽点、去 AI 味、期待感、人设等）。",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_agent",
            "description": "在指定项目运行创作 Agent（核心梗/大纲/人设/正文/去 AI 味等）。",
            "parameters": {
                "type": "object",
                "properties": {
                    "instruction": {"type": "string", "description": "要做什么，例如「生成核心梗」"},
                    "project_id": {"type": "string", "description": "可省略；省略时系统自动使用最近打开的项目"},
                },
                "required": ["instruction"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_scheduled_task",
            "description": "按明确的时间和任务类型安排后台操作。提醒请引导用户到总编工作台。",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "cron": {"type": "string", "description": "五字段 Cron（上海时间）、间隔如 1h 或一次性时间 once:ISO8601"},
                    "job_type": {
                        "type": "string",
                        "description": "必须明确指定后台任务类型。可选："
                        + "、".join(sorted(SCHEDULE_TASK_JOB_TYPES - {"assistant.follow_up"}))
                        + "。maintenance.noop 仅用于明确要求的调度诊断。",
                    },
                },
                "required": ["name", "cron"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "crawl_hotspots",
            "description": "抓取公开榜单热点（仅摘要级，合规）。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "navigate",
            "description": "跳转到应用页面。",
            "parameters": {
                "type": "object",
                "properties": {"route": {"type": "string", "description": "如 /kb /inspiration /settings /projects"}},
                "required": ["route"],
            },
        },
    },
]


async def _execute_tool(
    name: str,
    args: dict[str, Any],
    session: Session,
    project_id: str | None,
    *,
    message: str = "",
) -> tuple[str, list[AssistantAction], list[dict[str, Any]], str | None]:
    """执行单个工具，返回 (说明文本, actions, tool_results, run_id)。"""
    actions: list[AssistantAction] = []
    tool_results: list[dict[str, Any]] = []
    run_id: str | None = None

    if name == "search_knowledge":
        q = str(args.get("query") or "").strip()
        clean_q = re.sub(
            r"搜索|帮我|查一下|查查|查找|什么是|怎么回事|为什么|如何|请问|一下|知识库|里|的|内容|怎么|用",
            "",
            q,
        ).strip()
        hits = _search_distilled(clean_q or q)
        tool_results.append({"type": "kb_search", "query": q, "hits": hits})
        _log(session, actor="assistant", action="kb_search", summary=f"检索知识库：{q[:60]}", detail={"query": q})
        if hits:
            return (
                "知识库命中：" + "；".join(
                    f"{h.get('title', '')}（{str(h.get('snippet') or h.get('summary') or '')[:80]}）"
                    for h in hits[:4]
                ),
                actions,
                tool_results,
                run_id,
            )
        return "知识库没有直接命中，换关键词试试。", actions, tool_results, run_id

    if name == "run_agent":
        instruction = str(args.get("instruction") or "")
        project = session.get(Project, args.get("project_id")) if args.get("project_id") else None
        detected = _detect_agent(instruction)
        if not project:
            return "需要先有项目才能运行 Agent。", actions, tool_results, run_id
        if not detected:
            return "没有识别到要运行哪个创作 Agent，请说清楚（核心梗/大纲/人设/正文/去 AI 味）。", actions, tool_results, run_id
        agent_id, label = detected
        info = _trigger_agent(session, project, agent_id, label, instruction)
        run_id = info["run_id"]
        tool_results.append({"type": "run_agent", **info, "project": project.title})
        actions.append(
            AssistantAction(
                type="run_agent",
                label=f"查看运行：{label}",
                agent_id=agent_id,
                project_id=project.id,
                to=f"/studio/{project.format}",
            )
        )
        _log(session, actor="assistant", action="run_agent", summary=f"在「{project.title}」运行 {label}", project_id=project.id, detail=info)
        return f"已在「{project.title}」入队 {label}。", actions, tool_results, run_id

    if name == "create_scheduled_task":
        try:
            cron, job_type, next_run_at = _schedule_spec(args, utcnow())
        except ValueError as exc:
            summary = f"定时任务未创建。{exc}"
            return summary, actions, [{"type": "schedule_error", "summary": summary}], run_id
        if job_type == "assistant.follow_up":
            handoff = _schedule_handoff()
            return handoff.reply, handoff.actions, handoff.tool_results, run_id
        task = ScheduledTask(
            id=f"assistant-{new_id()}",
            name=str(args.get("name") or "定时任务"),
            cron_or_interval=cron,
            next_run_at=next_run_at,
            enabled=True,
            owner_scope="assistant",
            description=str(args.get("name") or ""),
            payload_template={"type": job_type},
        )
        session.add(task)
        session.commit()
        session.refresh(task)
        tool_results.append({"type": "schedule", "taskId": task.id, "name": task.name, "cron": task.cron_or_interval})
        actions.append(AssistantAction(type="schedule", label=f"查看定时任务：{task.name}", task_id=task.id))
        _log(session, actor="assistant", action="schedule_task", summary=f"创建定时任务：{task.name}", detail={"task_id": task.id})
        return f"已创建定时任务「{task.name}」（{task.cron_or_interval}）。", actions, tool_results, run_id

    if name == "crawl_hotspots":
        crawl = await _crawl(session, message)
        tool_results.append({"type": "crawl", **crawl})
        _log(session, actor="assistant", action="crawl", summary="触发爬取热点", detail=crawl)
        return str(crawl["hint"]), actions, tool_results, run_id

    if name == "navigate":
        route = str(args.get("route") or "/")
        actions.append(AssistantAction(type="navigate", label=f"打开 {route}", to=route))
        return f"已准备跳转到 {route}。", actions, tool_results, run_id

    return f"未知工具 {name}", actions, tool_results, run_id


def _summarize_tools(tool_results: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for t in tool_results:
        ttype = str(t.get("type") or "")
        if ttype == "kb_search":
            hits = [h for h in (t.get("hits") or []) if isinstance(h, dict)]
            titles = [str(h.get("title") or "") for h in hits if str(h.get("title") or "")]
            lines.append("知识库命中：" + ("、".join(titles[:4]) if titles else "暂无直接命中，换个关键词试试"))
        elif ttype == "run_agent":
            lines.append(f"已在「{t.get('project') or '项目'}」入队 {t.get('label') or '创作 Agent'}，结果会写进交稿物。")
        elif ttype == "schedule":
            lines.append(f"已创建定时任务「{t.get('name') or '定时任务'}」（{t.get('cron') or ''}）。")
        elif ttype == "crawl":
            lines.append(str(t["hint"]))
        else:
            lines.append(str(t.get("summary") or ttype))
    return "\n".join(lines) if lines else "已执行。"


@router.post("/assistant/llm-chat", response_model=AssistantChatOut)
async def assistant_llm_chat(
    body: AssistantChatIn,
    session: Session = Depends(get_session),
) -> AssistantChatOut:
    """LLM 自由对话 + 自动规划：函数调用决定要不要操作应用。"""
    message = (body.message or "").strip()
    if not message:
        return AssistantChatOut(reply="请告诉我你想做什么。")
    if _is_reminder_request(message):
        return _schedule_handoff()
    schedule_requested = _is_schedule_request(message)

    context = f"当前路径：{body.path or '未知'}；projectId：{body.project_id or '未选择'}。"
    system = (
        "你是 AI 商业写作台的运营助手，负责帮用户完成写作相关操作。"
        "你拥有工具，可以检索知识库、运行创作 Agent、创建定时任务、爬取热点、跳转页面。"
        "规则：用户明确要求定时执行受支持的后台操作时，填写 cron 和 job_type 并调用 create_scheduled_task；"
        "定时请求只调用定时工具，提醒请引导到总编工作台；"
        "对于「生成核心梗」等直接执行的创作请求调用 run_agent，对于「爬取热点」等直接抓取请求调用 crawl_hotspots；"
        "用户要求检索/查询/什么是/怎么/为什么必须调用 search_knowledge。"
        "run_agent 必须使用用户明确选择的 project_id；能执行就执行，不要只口头答应；"
        "拿不准时直接对话询问，不要编造结果。"
        f"{context}"
    )
    try:
        first = await chat_completion(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": message},
            ],
            temperature=0.2,
            max_tokens=800,
            tools=TOOL_SCHEMAS,
            tool_choice="auto",
        )
    except Exception as exc:  # noqa: BLE001
        # 无 key / 网络失败 → 回退规则意图，保证可用
        if isinstance(exc, ValueError):
            raise HTTPException(502, "模型响应格式错误") from exc
        fallback = await assistant_chat(body, session)
        fallback.reply = f"（LLM 未连接，已用规则助手处理）{fallback.reply}"
        return fallback

    record_model_usage(first, agent_id="system.assistant", session=session, project_id=body.project_id)
    try:
        validate_agent_output(first)
    except IncompleteAgentOutput as exc:
        raise HTTPException(502, str(exc)) from exc
    tool_calls = getattr(first, "tool_calls", None) or []
    if not tool_calls and getattr(first, "content", ""):
        tool_calls = _extract_dsml_tool_calls(first.content)
    if not tool_calls:
        if schedule_requested:
            return _schedule_handoff()
        _log(session, actor="assistant", action="chat", summary=f"对话：{message[:60]}")
        return AssistantChatOut(reply=_clean_dsml(first.content or "已收到。"), actions=[], tool_results=[])

    actions: list[AssistantAction] = []
    tool_results: list[dict[str, Any]] = []
    run_id: str | None = None
    try:
        batch = validate_tool_batch(tool_calls, TOOL_SCHEMAS)
    except IncompleteAgentOutput as exc:
        raise HTTPException(502, str(exc)) from exc
    tool_names = {name for name, _ in batch}
    has_schedule_tool = "create_scheduled_task" in tool_names
    if (schedule_requested and not has_schedule_tool) or (
        has_schedule_tool and tool_names.intersection({"crawl_hotspots", "run_agent"})
    ):
        return _schedule_handoff()
    for name, args in batch:
        text, acts, tres, rid = await _execute_tool(name, args, session, body.project_id, message=message)
        actions.extend(acts)
        tool_results.extend(tres)
        run_id = run_id or rid

    return AssistantChatOut(
        reply=_summarize_tools(tool_results),
        actions=actions,
        tool_results=tool_results,
        run_id=run_id,
    )


COWRITE_SYSTEM: dict[str, str] = {
    "continue": (
        "你是商业小说续写助手。严格接续用户给出的文本往下写，保持人称、时态、文风、人物口吻一致；"
        "不要复述上文，不要写总结，直接给出紧接的正文。"
    ),
    "polish": (
        "你是商业小说润色助手。在不改变情节、人物、对话原意的前提下，提升语言表现力："
        "去掉病句与冗余，短句为主，把抽象情感改成动作/神态/细节，保持原有风格。"
    ),
    "deai": (
        "你是去 AI 味润色助手。按 V3.8 规则：禁止改变主题/走向/结局，禁止删除场景人物对话；"
        "清除「像…一样/仿佛/宛如」类比喻与套路化表达，改为具体动作与神态；拆长句为短句（以 20 字内为主）；"
        "增加篇幅但都必须是有效信息。"
    ),
    "expand": (
        "你是商业小说扩写助手。在不改变情节走向的前提下，增加动作、神态、环境与心理外化的细节描写，"
        "拉长篇幅并保持节奏，不注水、不重复。"
    ),
}


async def cowrite_impl(
    session: Session,
    body: CowriteIn,
    conversation_id: str | None = None,
) -> CowriteOut:
    text = (body.text or "").strip()
    if not text:
        return CowriteOut(result="", hint="请先粘贴或写一段正文。")
    mode = body.mode if body.mode in COWRITE_SYSTEM else "polish"
    system = COWRITE_SYSTEM[mode]
    instruction = (body.instruction or "").strip()

    # 注入项目上下文：人设/世界观/决策/最近章摘要 + 已采纳核心梗，避免共写脱离设定。
    context_parts: list[str] = []
    if body.project_id:
        try:
            from ..memory_service import infer_memory_kind, is_context_snapshot, resolve_store_id
            project = session.get(Project, body.project_id)
            if not project:
                return CowriteOut(result="", hint="项目不存在")
            mem_root = f"/memories/projects/{project.id}/"
            allowed_stores = {f"project.{project.id}.bible", f"project.{project.id}.journal"}
            private_segments = {"private", "procedural", "reflections", "bots", "fleet", "agents", "scratch", "context_refs", ".", ".."}
            rows = session.exec(select(MemoryFile).where(
                MemoryFile.path.startswith(mem_root), MemoryFile.user_id == project.user_id,
            ).order_by(MemoryFile.updated_at.desc()))
            rows = [row for row in rows if row.project_id in (None, project.id)
                    and (row.store_id or resolve_store_id(row.path)) in allowed_stores
                    and not row.is_hypothesis and "hypothesis:" not in row.path.lower()
                    and not is_context_snapshot(row.path)
                    and (row.memory_kind not in {"episodic", "journal"} or row.path.startswith((mem_root+"journal/", mem_root+"episodes/")))
                    and not private_segments.intersection(row.path[len(mem_root):].lower().split("/"))
                    and not {row.memory_kind, infer_memory_kind(row.path)}.intersection({"scratch","reflection","procedural"})]
            for row in rows[:8]:
                snippet = (row.content or "").strip()
                if snippet:
                    context_parts.append(f"[{row.path.rsplit('/', 1)[-1]}]\n{snippet[:800]}")
            hook = session.exec(
                select(Artifact).where(
                    Artifact.project_id == body.project_id,
                    Artifact.type == "core_hook",
                    Artifact.status == "adopted",
                )
            ).first()
            if hook and hook.body_markdown:
                context_parts.append(f"[核心梗]\n{hook.body_markdown[:800]}")
            # 注入已采纳的大纲 / 人设 / 世界观产物，避免共写脱离设定。
            ctx_types = ("episode_outline", "master_outline", "bible", "bio")
            adopted = list(
                session.exec(
                    select(Artifact).where(
                        Artifact.project_id == body.project_id,
                        Artifact.status == "adopted",
                        Artifact.type.in_(ctx_types),
                    )
                ).all()
            )
            adopted.sort(key=lambda a: a.updated_at, reverse=True)
            for art in adopted[:6]:
                md = (art.body_markdown or "").strip()
                if md:
                    context_parts.append(f"[{art.type} · {art.title}]\n{md[:800]}")
        except Exception:
            context_parts = []

    context_block = (
        "\n\n## 项目上下文（仅作设定/前情参考，禁止复述）\n" + "\n\n".join(context_parts)
        if context_parts
        else ""
    )
    user = f"原文：\n{text}" + context_block + (f"\n\n额外要求：{instruction}" if instruction else "")
    try:
        r = await chat_completion(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0.7,
            max_tokens=2400,
        )
        record_model_usage(r, agent_id="system.cowrite", session=session, project_id=body.project_id)
        validate_agent_output(r)
        if getattr(r, "tool_calls", None) or _extract_dsml_tool_calls(r.content):
            raise IncompleteAgentOutput("共写未返回正文")
        result = r.content.strip()
    except Exception as exc:  # noqa: BLE001
        _log(session, actor="assistant", action="cowrite", summary=f"共写失败：{mode}", conversation_id=conversation_id, detail={"error": str(exc)})
        return CowriteOut(result="", hint=f"共写失败：{exc}")
    _log(
        session,
        actor="assistant",
        action="cowrite",
        summary=f"共写：{mode}",
        project_id=body.project_id,
        conversation_id=conversation_id,
        detail={"mode": mode, "inputLen": len(text), "outputLen": len(result)},
    )
    return CowriteOut(result=result, hint="")


@router.post("/assistant/cowrite", response_model=CowriteOut)
async def cowrite(body: CowriteIn, session: Session = Depends(get_session)) -> CowriteOut:
    return await cowrite_impl(session, body)


def _trigger_agent(
    session: Session,
    project: Project,
    agent_id: str,
    label: str,
    message: str,
    conversation_id: str | None = None,
    *,
    parent_run_id: str | None = None,
    speculative: bool = False,
    run_input: dict | None = None,
    bind_dispatch=None,
    selected_refs=None,
) -> dict[str, Any]:
    from ..knowledge_colleague import resolve_agent, validate_knowledge_input
    role = resolve_agent(session, agent_id, project.id if project else None, _user())
    validate_knowledge_input(role, run_input)
    agent_id = role["id"]
    input_json: dict[str, Any] = {**(run_input or {}), "assistantPrompt": message, "label": label}
    if speculative:
        input_json["speculative"] = True
    run = AgentRun(
        project_id=project.id,
        conversation_id=conversation_id,
        agent_id=agent_id,
        status="queued",
        input_json=input_json,
        model=resolve_default_model(),
        parent_run_id=parent_run_id,
    )
    payload = {"runId": run.id, "agentId": agent_id, "input": {"assistantPrompt": message}}
    if role.get("custom"):
        from ..context_refs import current_turn_refs
        from ..knowledge_colleague import selected_references
        from ..models import Bot
        refs = current_turn_refs(conversation_id) if selected_refs is None else selected_refs
        if refs:
            payload["selectedReferences"] = selected_references(session, session.get(Bot, agent_id), project.id, refs)
    if speculative:
        payload["speculative"] = True
    job = Job(
        type="agent.run",
        payload=payload,
        project_id=project.id,
        conversation_id=conversation_id,
        user_id=_user(),
        result_ref=run.id,
    )
    session.add(run)
    session.add(job)
    if bind_dispatch:
        bind_dispatch(run, job)
    session.commit()
    session.refresh(run)
    session.refresh(job)
    if bind_dispatch:
        from ..agent_inbox import check_owner
        check_owner(session, conversation_id)
    enqueue_job(job.id, {"type": job.type, "payload": job.payload, "runId": run.id})
    publish_job_event(
        job.id,
        {"type": "status", "status": "queued", "jobId": job.id, "runId": run.id},
    )
    # Pipeline subscriptions are bound in the job/checkpoint transaction.
    if conversation_id and not bind_dispatch:
        try:
            from ..thread_router import project_thread_key, upsert_subscription

            upsert_subscription(
                session,
                thread_key=project_thread_key(project.id),
                conversation_id=conversation_id,
                run_id=run.id,
                agent_id=agent_id,
                project_id=project.id,
                mode="observe" if speculative else "wake",
            )
        except Exception:  # noqa: BLE001
            pass
    return {"run_id": run.id, "job_id": job.id, "agent_id": agent_id, "label": label}


def _list_sources(session: Session) -> list[dict[str, Any]]:
    rows = list(session.exec(select(CrawlerSource)))
    return [
        {
            "id": r.id,
            "name": r.name,
            "enabled": r.enabled,
            "robots_ack": r.robots_ack,
            "status": r.status,
            "last_item_count": int(getattr(r, "last_item_count", 0) or 0),
        }
        for r in rows
    ]


def _mentioned_crawler_sources(message: str, sources: list[tuple[str, str]]) -> dict[str, list[str]]:
    if not message:
        return {}
    ids_by_name: dict[str, list[str]] = {}
    for source_id, name in sources:
        if name:
            ids_by_name.setdefault(name, []).append(source_id)
    if not ids_by_name:
        return {}
    # Match the longest literal name at each position before moving past it.
    names = sorted(ids_by_name, key=len, reverse=True)
    pattern = "|".join(re.escape(name) for name in names)
    return {match[0]: ids_by_name[match[0]] for match in re.finditer(pattern, message)}


async def _crawl(session: Session, message: str) -> dict[str, Any]:
    from ..crawler.fetchers import FETCHERS
    from ..crawler.service import run_and_persist
    from .crawler import _decrypt_cookie

    sources = list(session.exec(select(CrawlerSource.id, CrawlerSource.name, CrawlerSource.enabled)))
    mentioned = _mentioned_crawler_sources(message, [(source_id, name) for source_id, name, _ in sources])
    results: list[dict[str, Any]] = []
    targets: list[tuple[str, str]] = []
    if mentioned:
        for name, source_ids in mentioned.items():
            if len(source_ids) == 1:
                targets.append((source_ids[0], name))
            else:
                results.append({
                    "name": name,
                    "sourceIds": source_ids,
                    "status": "blocked",
                    "items": 0,
                    "error": "存在多个同名数据源，请在 /kb/crawler 使用不同名称后再选择。",
                })
    else:
        targets = [
            (source_id, name)
            for source_id, name, enabled in sources
            if enabled and not source_id.startswith("manual")
        ]
    if not targets and not results:
        return {
            "status": "noop",
            "hint": "没有可采集的公开榜单源，请在 /kb/crawler 启用支持的源并确认 robots。",
            "sources": _list_sources(session),
        }

    for source_id, name in targets:
        source = {"id": source_id, "name": name}
        row = session.get(CrawlerSource, source_id, populate_existing=True)
        if row is None:
            reason = "数据源已移除，请在 /kb/crawler 核对配置。"
        elif not row.enabled:
            reason = "数据源已停用，请在 /kb/crawler 启用。"
        elif not row.robots_ack:
            reason = "请在 /kb/crawler 确认该源的 robots 与服务条款。"
        elif row.id.startswith("manual"):
            reason = "手动源请在热点页录入。实时刷新请选择公开榜单数据源。"
        elif row.id not in FETCHERS:
            reason = "该源缺少抓取适配器，请在 /kb/crawler 选择已支持的源。"
        else:
            reason = None
        if reason:
            results.append({**source, "status": "blocked", "items": 0, "error": reason})
            continue

        try:
            row, report, result = await run_and_persist(session, row, cookie=_decrypt_cookie(row))
        except Exception:  # noqa: BLE001
            session.rollback()
            error = "采集或报告保存中断，请检查数据源与数据库状态后重试。"
            current = session.get(CrawlerSource, source_id)
            if current and current.status == "running":
                current.status = "failed"
                current.last_error = error
                current.last_item_count = 0
                current.last_run_at = utcnow()
                session.add(current)
                session.commit()
            results.append({**source, "status": "failed", "items": 0, "error": error})
            continue

        entry = {
            **source,
            "status": row.status,
            "items": len(result.items),
            "reportId": report.id if report else None,
            "needsCookie": result.needs_cookie,
        }
        if result.cookie_hint:
            entry["cookieHint"] = result.cookie_hint
        if not result.items:
            entry["error"] = result.error or "榜单没有可用条目，请检查数据源或稍后重试。"
        results.append(entry)

    item_count = sum(entry["items"] for entry in results)
    successful = sum(entry["items"] > 0 for entry in results)
    if item_count:
        status = "done" if successful == len(results) else "partial"
        hint = f"已从 {successful}/{len(results)} 个数据源采集 {item_count} 条公开榜单条目。"
        if status == "partial":
            hint += "其余数据源的状态与处理提示见详情。"
    else:
        if any(entry["status"] == "failed" for entry in results):
            status = "failed"
        else:
            status = "blocked" if mentioned else "noop"
        reasons = [
            f"{entry['name']}：{entry['error']}"
            + (f"。{entry['cookieHint']}" if entry.get("cookieHint") else "")
            for entry in results
        ]
        hint = "未采集到公开榜单条目。" + "；".join(reasons)
    return {"status": status, "itemCount": item_count, "results": results, "hint": hint}


@router.post("/assistant/chat", response_model=AssistantChatOut)
async def assistant_chat(
    body: AssistantChatIn,
    session: Session = Depends(get_session),
) -> AssistantChatOut:
    message = (body.message or "").strip()
    if not message:
        return AssistantChatOut(reply="请告诉我你想让我做什么，例如「搜索换元法」「爬取热点」「生成核心梗」。")
    if _is_reminder_request(message) or _is_schedule_request(message):
        return _schedule_handoff()

    actions: list[AssistantAction] = []
    tool_results: list[dict[str, Any]] = []
    run_id: str | None = None
    reply_parts: list[str] = []

    # 1) 知识库检索（问答型）
    if re.search(r"搜|查|什么是|怎么|为什么|如何|桥段|拆书|换元|去.?ai.?味|知识库|公式|套路", message):
        clean_query = re.sub(
            r"搜索|帮我|查一下|查查|查找|什么是|怎么回事|为什么|如何|请问|一下|知识库|里|的|内容",
            "",
            message,
        ).strip()
        hits = _search_distilled(clean_query or message)
        tool_results.append({"type": "kb_search", "hits": hits})
        _log(session, actor="assistant", action="kb_search", summary=f"检索知识库：{message[:60]}", detail={"query": message})
        if hits:
            lines = [f"- {h.get('title', '')}：{str(h.get('snippet') or h.get('summary') or '')[:120]}" for h in hits[:5]]
            reply_parts.append("知识库命中：\n" + "\n".join(lines))
        else:
            reply_parts.append("知识库里暂时没有直接命中的内容，换个关键词试试。")

    # 2) 爬虫
    if re.search(r"爬|抓取|热点|榜单|扫榜", message):
        crawl = await _crawl(session, message)
        tool_results.append({"type": "crawl", **crawl})
        _log(session, actor="assistant", action="crawl", summary=f"触发爬虫：{message[:60]}", detail=crawl)
        reply_parts.append(str(crawl["hint"]))

    # 3) 运行 agent
    detected = _detect_agent(message)
    if detected:
        project = session.get(Project, body.project_id) if body.project_id else None
        if not project:
            reply_parts.append("要运行 Agent 需要先有一个项目，先建项目或告诉我项目名。")
        else:
            agent_id, label = detected
            info = _trigger_agent(session, project, agent_id, label, message)
            run_id = info["run_id"]
            tool_results.append({"type": "run_agent", **info, "project": project.title})
            actions.append(
                AssistantAction(
                    type="run_agent",
                    label=f"查看运行：{label}",
                    agent_id=agent_id,
                    project_id=project.id,
                    to=f"/studio/{project.format}",
                )
            )
            _log(
                session,
                actor="assistant",
                action="run_agent",
                summary=f"在「{project.title}」运行 {label}",
                project_id=project.id,
                detail=info,
            )
            reply_parts.append(f"已在「{project.title}」入队 {label}，结果会写进交稿物并留下运行痕迹。")

    # 4) 导航
    if re.search(r"打开|进入|跳转|去|页面|首页|创作台", message):
        route = _route_for(body.path, message)
        if route:
            actions.append(AssistantAction(type="navigate", label=f"打开 {route}", to=route))
            reply_parts.append(f"已准备好跳转到 {route}。")

    # 5) 兜底
    if not tool_results and not actions:
        reply_parts.append(
            "我能做这些：①知识库问答（搜「换元法」）②运行创作 Agent（说「生成核心梗/大纲/人设/正文」）"
            "③爬取热点（说「爬取热点」）④跳转页面（说「打开知识库」）。定时提醒请在总编工作台设置。"
        )
        _log(session, actor="assistant", action="chat", summary=f"对话：{message[:60]}")

    return AssistantChatOut(
        reply="\n".join(reply_parts) if reply_parts else "已收到。",
        actions=actions,
        tool_results=tool_results,
        run_id=run_id,
    )


@router.get("/assistant/context")
def assistant_context(session: Session = Depends(get_session)) -> dict[str, Any]:
    projects = list(session.exec(select(Project).order_by(Project.last_opened_at.desc())).all())
    tasks = list(session.exec(select(ScheduledTask)).all())
    sources = list(session.exec(select(CrawlerSource)).all())
    recent = list(session.exec(select(ActivityLog).order_by(ActivityLog.created_at.desc()).limit(10)).all())
    return {
        "projects": [{"id": p.id, "title": p.title, "format": p.format, "stage": p.stage} for p in projects[:8]],
        "scheduledTasks": [{"id": t.id, "name": t.name, "enabled": t.enabled, "nextRunAt": t.next_run_at} for t in tasks],
        "crawlerSources": [
            {"id": s.id, "name": s.name, "status": s.status, "enabled": s.enabled} for s in sources
        ],
        "recentActivity": [
            ActivityLogOut.model_validate(r).model_dump(mode="json") for r in recent
        ],
    }


@router.get("/activity", response_model=list[ActivityLogOut])
def list_activity(
    project_id: str | None = None,
    limit: int = 50,
    session: Session = Depends(get_session),
) -> list[ActivityLog]:
    rows = list(session.exec(select(ActivityLog).order_by(ActivityLog.created_at.desc()).limit(limit)).all())
    if project_id:
        rows = [r for r in rows if r.project_id == project_id]
    return rows


@router.get("/projects/{project_id}/artifacts/{artifact_id}/versions", response_model=list[ArtifactVersionOut])
def artifact_versions(
    project_id: str,
    artifact_id: str,
    session: Session = Depends(get_session),
) -> list[ArtifactVersion]:
    if not session.get(Project, project_id):
        raise HTTPException(404, "project not found")
    rows = list(
        session.exec(
            select(ArtifactVersion)
            .where(ArtifactVersion.artifact_id == artifact_id)
            .order_by(ArtifactVersion.version.desc())
        ).all()
    )
    return rows


@router.post("/projects/{project_id}/artifacts/{artifact_id}/versions/{version_id}/rollback")
def artifact_rollback(
    project_id: str,
    artifact_id: str,
    version_id: str,
    body: dict[str, Any],
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    if not session.get(Project, project_id):
        raise HTTPException(404, "project not found")
    art = session.get(Artifact, artifact_id)
    if not art or art.project_id != project_id:
        raise HTTPException(404, "artifact not found")
    expected = body.get("expectedVersion", body.get("expected_version"))
    if isinstance(expected, bool) or not isinstance(expected, int) or expected < 1:
        raise HTTPException(422, "expectedVersion 必须是正整数")
    if expected != art.version:
        raise HTTPException(409, detail={"code": "version_conflict", "currentVersion": art.version,
                                         "message": "稿件已更新，请重新比较后再回滚"})
    snap = session.get(ArtifactVersion, version_id)
    if not snap or snap.artifact_id != artifact_id:
        raise HTTPException(404, "version not found")
    from .projects import _capture_baseline, _snapshot_version, _record_content_edit
    from ..ontology.runtime import sync_artifact_to_object

    previous_version = art.version
    content_changed = art.body_markdown != snap.body_markdown or art.body_json != snap.body_json
    changes = {"version": previous_version + 1, "title": snap.title,
               "body_markdown": snap.body_markdown, "body_json": snap.body_json,
               "updated_at": utcnow()}
    # A historical adoption is evidence about that old version, not approval
    # of a newly restored draft. Preserve current approval only for identical content.
    if content_changed:
        changes["adopted_at"] = None
        if art.status == "adopted":
            changes["status"] = "draft"
    _capture_baseline(session, art, "before rollback")
    result = session.execute(update(Artifact).where(
        Artifact.id == artifact_id, Artifact.version == expected,
    ).values(**changes).execution_options(synchronize_session=False))
    if result.rowcount != 1:
        session.rollback()
        raise HTTPException(409, detail={"code": "version_conflict", "message": "稿件已被其他操作更新"})
    session.refresh(art)
    _record_content_edit(session, art, previous_version, content_changed)
    _snapshot_version(session, art)
    sync_artifact_to_object(session, artifact=art, via_action=True)
    session.commit()
    session.refresh(art)
    _log(
        session,
        actor="user",
        action="rollback",
        summary=f"回滚 {art.title} 到 v{snap.version}",
        project_id=project_id,
        detail={"artifact_id": artifact_id, "from_version": previous_version, "to_version": snap.version},
    )
    try:
        from ..eval.online import on_artifact_rollback

        on_artifact_rollback(
            session,
            artifact_id=artifact_id,
            project_id=project_id,
            version=snap.version,
        )
    except Exception:  # noqa: BLE001
        pass
    return {"ok": True, "version": art.version, "artifact_id": art.id}
