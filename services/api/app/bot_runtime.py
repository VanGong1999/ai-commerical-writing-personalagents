"""Bot 运行时：分段 system prompt、工具收窄、Bot 专属工具、run_bot_turn。"""

from __future__ import annotations

from .agent_inbox import KNOWLEDGE_REQUEST_SOURCES, check_owner, owned_turn

from fastapi import HTTPException

import hashlib
import json
import logging
import re
from typing import Any, Awaitable, Callable

from sqlmodel import Session, select

from .agent_colleagues import agent_id_from_bot_id, bot_id_aliases, is_agent_colleague_id
from .bot_registry import (
    private_memory_files,
    CHIEF_BOT_ID,
    EGG_BOT_ID,
    create_bot,
    get_bot,
    interview_to_draft,
    list_bots,
    patch_bot,
    resolve_mentions,
    slash_to_skill,
)
from .disturb_policy import build_catch_up_summary, decide_disturb, mark_reported
from .llm_service import chat_completion
from .personal_agent_output import validate_tool_batch, IncompleteAgentOutput, actual_usage, validate_agent_output
from .settings import get_settings
from .models import (
    Bot,
    BotSkill,
    Conversation,
    Message,
    ScheduledTask,
    TaskProposal,
    UsageEvent,
    new_id,
    utcnow,
)
from .trust_policy import (
    IRREVERSIBLE_TOOLS,
    requires_confirm,
    tools_allowed_for_trust,
    trust_label,
    veto_window_applies,
)

logger = logging.getLogger(__name__)

EmitFn = Callable[[str, dict[str, Any]], Awaitable[None]]
MAX_TURNS = 20

# —— Bot 专属工具定义 ——
BOT_EXTRA_TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "ask_bot",
            "description": "同步咨询另一位同事：在隐藏会话中跑一轮，返回其回答。",
            "parameters": {
                "type": "object",
                "properties": {
                    "bot_id": {"type": "string"},
                    "bot_name": {"type": "string"},
                    "question": {"type": "string"},
                },
                "required": ["question"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delegate_to_bot",
            "description": "异步委派任务给另一位同事；完成后以 bot_reply 回到本会话。",
            "parameters": {
                "type": "object",
                "properties": {
                    "bot_id": {"type": "string"},
                    "bot_name": {"type": "string"},
                    "task": {"type": "string"},
                    "context": {"type": "string"},
                },
                "required": ["task"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "report_to",
            "description": "向幕僚长或指定 Bot 汇报结果。",
            "parameters": {
                "type": "object",
                "properties": {
                    "bot_id": {"type": "string"},
                    "summary": {"type": "string"},
                    "evidence": {"type": "array", "items": {"type": "object"}},
                },
                "required": ["summary"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "skill_save",
            "description": "把刚才的做法沉淀为可复用技能。",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "slash": {"type": "string"},
                    "when_to_use": {"type": "string"},
                    "steps_md": {"type": "string"},
                    "evidence_required": {"type": "boolean"},
                    "confirm_when": {"type": "string"},
                },
                "required": ["name", "steps_md"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "skill_run",
            "description": "按技能名或 slash 执行已保存技能。",
            "parameters": {
                "type": "object",
                "properties": {
                    "slash": {"type": "string"},
                    "name": {"type": "string"},
                    "inputs": {"type": "object"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "skill_update",
            "description": "更新已有技能步骤或信任阶段。",
            "parameters": {
                "type": "object",
                "properties": {
                    "skill_id": {"type": "string"},
                    "slash": {"type": "string"},
                    "steps_md": {"type": "string"},
                    "trust_stage": {"type": "string"},
                    "clean_runs_delta": {"type": "integer"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "routine_create",
            "description": "创建例程（默认最频繁每小时一次）；trigger_type=event 时按 event_filter 匹配事件唤醒。",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "cron": {"type": "string"},
                    "prompt": {"type": "string"},
                    "quiet_policy": {"type": "string"},
                    "confirm_high_freq": {"type": "boolean"},
                    "active_window": {"type": "object"},
                    "trigger_type": {"type": "string"},
                    "event_filter": {"type": "object"},
                },
                "required": ["name", "cron", "prompt"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "routine_list",
            "description": "列出本 Bot 的例程。",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "routine_update",
            "description": "启停或修改例程。",
            "parameters": {
                "type": "object",
                "properties": {
                    "routine_id": {"type": "string"},
                    "enabled": {"type": "boolean"},
                    "cron": {"type": "string"},
                    "prompt": {"type": "string"},
                    "quiet_policy": {"type": "string"},
                },
                "required": ["routine_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "learn_correction",
            "description": "把用户纠正写入私有 corrections 记忆。",
            "parameters": {
                "type": "object",
                "properties": {
                    "correction": {"type": "string"},
                    "context": {"type": "string"},
                },
                "required": ["correction"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "show_memories",
            "description": "展示本 Bot 的私有记忆摘要。",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "restate_intent",
            "description": "用自己的话复述目标、问题与不确定点，供主人确认。",
            "parameters": {
                "type": "object",
                "properties": {
                    "goal": {"type": "string"},
                    "problem": {"type": "string"},
                    "uncertainties": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["goal"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "catch_up",
            "description": "汇总自上条用户消息以来的进展与待拍板事项。",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "deliver_result",
            "description": "交付结果，必须附证据（artifact/gate/diff）。",
            "parameters": {
                "type": "object",
                "properties": {
                    "summary": {"type": "string"},
                    "evidence": {"type": "array", "items": {"type": "object"}},
                },
                "required": ["summary", "evidence"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "halt_pipeline",
            "description": "拉停流水线，把决定交还给主人。",
            "parameters": {
                "type": "object",
                "properties": {
                    "reason": {"type": "string"},
                    "run_id": {"type": "string"},
                    "task_group_id": {"type": "string"},
                },
                "required": ["reason"],
            },
        },
    },
    # 蛋博士专属
    {
        "type": "function",
        "function": {
            "name": "bot_create",
            "description": "按配置创建新同事 Bot。",
            "parameters": {
                "type": "object",
                "properties": {
                    "config": {"type": "object"},
                    "from_interview": {"type": "object"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "bot_update",
            "description": "更新现有 Bot 配置。",
            "parameters": {
                "type": "object",
                "properties": {
                    "bot_id": {"type": "string"},
                    "patch": {"type": "object"},
                },
                "required": ["bot_id", "patch"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "bot_list",
            "description": "列出所有同事 Bot。",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "bot_inspect",
            "description": "检查某 Bot 的人设、技能、例程与纠错。",
            "parameters": {
                "type": "object",
                "properties": {"bot_id": {"type": "string"}, "bot_name": {"type": "string"}},
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "routine_audit",
            "description": "体检例程：未使用、过勤、过贵。",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "chat_audit",
            "description": "扫描各 Bot 近期对话，摘录主人纠正/误解的片段，供审计改进。",
            "parameters": {
                "type": "object",
                "properties": {
                    "bot_id": {"type": "string"},
                    "bot_name": {"type": "string"},
                    "since_days": {"type": "integer"},
                    "limit": {"type": "integer"},
                },
                "required": [],
            },
        },
    },
]

BOT_EXTRA_NAMES = {((t.get("function") or {}).get("name")) for t in BOT_EXTRA_TOOLS}

EGG_ONLY = {"bot_create", "bot_update", "bot_list", "bot_inspect", "routine_audit", "chat_audit"}


def agent_id_allowed(agent_id: str, patterns: list[str] | None) -> bool:
    """判断 agent_id 是否在 Bot 的可派列表内。

    支持前缀通配 `prefix.*`（如 `qc.*` 匹配 `qc.de_ai`），与 agent-catalog.json 的 id 命名一致。
    列表为空表示不限制。
    """
    if not patterns:
        return True
    for p in patterns:
        if p == agent_id:
            return True
        if p.endswith(".*") and agent_id.startswith(p[:-1]):
            return True
    return False


def _correction_path(bot_id: str, conv: Conversation) -> str:
    scope = f"projects/{conv.project_id}" if conv.project_id else f"conversations/{conv.id}"
    return f"/memories/bots/{bot_id}/{scope}/corrections.md"


def _hash_section(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()[:12]


def _truth_source_block(session: Session, conv: Conversation, rules: dict[str, Any]) -> str:
    """把群组的「真相源」记忆文件注入 system prompt，让每个 bot 知道当前计划/任务状态存在哪。

    优先级：group_rules.truth_source_path / truthSourcePath → 回退 BotTeam.truth_source_path。
    对应 grokbot「一个地方存真相，明确告诉每个 bot 真相存在哪」。
    """
    path = rules.get("truth_source_path") or rules.get("truthSourcePath")
    if not path and getattr(conv, "team_id", None):
        from .models import BotTeam

        team = session.get(BotTeam, conv.team_id)
        if team:
            path = getattr(team, "truth_source_path", None)
    if not path:
        return ""
    from .models import MemoryFile

    row = session.get(MemoryFile, str(path))
    content = str(row.content).strip() if row and row.content else ""
    if not content or row.user_id != conv.user_id:
        return ""
    from .routers.personal_agent import _memory_context_block, _shared_memory_eligible
    if not _shared_memory_eligible(row, conv, allow_user_truth=True):
        return ""
    return "\n" + _memory_context_block(row, "本组真相源", limit=1800) + "\n"



def build_bot_system_prompt(
    session: Session,
    bot: Bot,
    conv: Conversation,
    *,
    skills: list[BotSkill] | None = None,
) -> tuple[str, list[dict[str, Any]]]:
    """分段 system prompt（顺序固定，利于缓存）。返回 (full_text, sections)。"""
    from .routers.personal_agent import APPROVAL_STATE_AUTHORITY, FEISHU_IM_HINT, SUPERVISOR_SYSTEM, _core_facts_block, _memory_context_block

    sections: list[dict[str, Any]] = []
    memory_sources = []

    # 1. 静态平台规则
    platform = SUPERVISOR_SYSTEM if bot.id == CHIEF_BOT_ID else (
        "你是写作漫剧产品的 AI 同事（具名 Bot）。"
        "具体写作交给 run_agent / start_async_task / create_fleet / subagent_spawn。"
        "成本阶梯：历史与记忆 → 检索 → 派 Agent → 才问用户。"
        "能执行就立刻调工具。回复简洁 Markdown 中文。\n"
        f"{APPROVAL_STATE_AUTHORITY}\n"
    )
    sections.append({"name": "platform", "hash": _hash_section(platform), "text": platform})

    # 2. 身份
    identity = (
        f"## 身份\n"
        f"你是「{bot.name}」（id={bot.id}，角色={bot.role_kind}）。\n"
        f"人设：{bot.persona or '（无）'}\n"
        f"语气：{bot.tone or '默认'}\n"
        f"职责：{'; '.join(bot.duties) or '（未设）'}\n"
        f"禁止：{'; '.join(bot.never_do) or '（未设）'}\n"
        f"delegate_only={bot.delegate_only}\n"
    )
    sections.append({"name": "identity", "hash": _hash_section(identity), "text": identity})

    # 2b. 虚拟同事（agent-catalog）专属：绑定本人 agent、上下游建议
    from .agent_colleagues import (
        agent_id_from_bot_id,
        is_agent_colleague_id,
        load_catalog_by_id,
        _neighbors,
    )

    if is_agent_colleague_id(bot.id):
        aid = agent_id_from_bot_id(bot.id)
        cat = load_catalog_by_id().get(aid) or {}
        up, down = _neighbors(aid)
        up_txt = "、".join(f"{x['name']}" for x in up) or "—"
        down_txt = "、".join(f"{x['name']}" for x in down) or "—"
        agent_block = (
            "## 专职绑定\n"
            f"你对应目录 Agent `{aid}`（{cat.get('persona') or bot.name}）。\n"
            f"摘要：{cat.get('summary') or '—'}\n"
            f"时机：{cat.get('when') or '—'}\n"
            f"阶段：{cat.get('stage') or '—'}\n"
            f"适用体裁：{', '.join(cat.get('formats') or ['*'])}\n"
            f"上游同事：{up_txt}\n"
            f"下游同事：{down_txt}\n"
            "调用 run_agent 时若未指定 agent_id，默认就是你本人。"
            "完成后用一句话建议下一位该接力的同事（可 @ 其名字）。\n"
        )
        sections.append({"name": "agent_bind", "hash": _hash_section(agent_block), "text": agent_block})

    # 3. 信任
    trust = (
        f"## 信任等级\n"
        f"当前：{bot.trust_level}（{trust_label(bot.trust_level)}）。"
        f"否决窗口 {bot.veto_window_min} 分钟。"
        f"restate_before_act={bot.restate_before_act}。\n"
        "交活必须附证据（deliver_result）；必要时 halt_pipeline 交还给主人。\n"
    )
    sections.append({"name": "trust", "hash": _hash_section(trust), "text": trust})

    # 4. 技能目录（仅名）
    skills = skills if skills is not None else list(
        session.exec(select(BotSkill).where((BotSkill.bot_id.in_(bot_id_aliases(bot.id))) | (BotSkill.bot_id == None)))  # noqa: E711
    )
    skill_lines = [
        f"- /{s.slash} · {s.name}（{s.trust_stage}）"
        for s in sorted(skills, key=lambda item: (item.slash, item.name, item.id))
        if s.bot_id is None or s.bot_id in bot_id_aliases(bot.id)
    ]
    visible_skills = []
    for line in skill_lines:
        if sum(len(item) + 1 for item in visible_skills) + len(line) > 2400:
            break
        visible_skills.append(line)
    skill_block = "## 技能目录\n" + ("\n".join(visible_skills) if skill_lines else "（暂无技能；可用 skill_save）\n")
    if len(visible_skills) < len(skill_lines):
        skill_block += "\n其余技能未注入；需要时通过 skill_run 按用户指定 slash 读取，不猜测技能内容。"

    sections.append({"name": "skills", "hash": _hash_section(skill_block), "text": skill_block})

    if conv.source == "feishu":
        sections.append({"name": "feishu", "hash": _hash_section(FEISHU_IM_HINT), "text": FEISHU_IM_HINT})

    # 6. 群聊规则
    group = ""
    if getattr(conv, "kind", "dm") == "group":
        members = list(getattr(conv, "member_bot_ids", None) or [])
        names = []
        for mid in members:
            m = get_bot(session, mid)
            names.append(f"{m.name}({mid})" if m else mid)
        rules = getattr(conv, "group_rules", None) or {}
        group = (
            "## 群聊规则\n"
            f"成员：{', '.join(names) or '—'}\n"
            f"发言策略：{rules.get('speak_policy') or 'orchestrated'}\n"
            f"群规则：{rules.get('rules_md') or getattr(conv, 'group_rules', {})}\n"
            "有 @ 时只回应被提及者；回复里 @ 其他 Bot 会触发接力。\n"
        )
        group += _truth_source_block(session, conv, rules)
        sections.append({"name": "group", "hash": _hash_section(group), "text": group})

    # 5. 核心事实（Bot 私有 + 通用）
    bot_facts = ""
    for path, label, limit in (
        (f"/memories/bots/{bot.id}/profile.md", "Bot 画像", 600),
        (_correction_path(bot.id, conv), "纠错", 800),
    ):
        from .models import MemoryFile

        row = None
        for identity in bot_id_aliases(bot.id) if bot.id != CHIEF_BOT_ID else ():
            candidate = session.get(MemoryFile, path.replace(f"/bots/{bot.id}/", f"/bots/{identity}/", 1))
            if candidate and candidate.user_id == conv.user_id and candidate.project_id in (None, conv.project_id):
                row = candidate
                break
        if row and row.user_id == conv.user_id and row.content:
            bot_facts += _memory_context_block(row, "本人私有·" + label, limit=limit + 500, sources=memory_sources) + "\n\n"
    core = _core_facts_block(session, conv, memory_sources)
    facts = (bot_facts + (core or "")).strip() or "（无额外核心事实）"
    sections.append({"name": "facts", "hash": _hash_section(facts), "text": facts, "memorySources": memory_sources})

    full = "\n\n".join(s["text"] for s in sections)
    from .feedback_loop import conversation_context
    preferences = conversation_context(session, conv.project_id)
    if preferences:
        sections.append({"name":"user_preferences","hash":_hash_section(preferences),"text":preferences})
        full += "\n\n" + preferences
    return full, sections


def discussion_system_prompt(bot: Bot) -> str:
    """固定交接讨论提示；不授予工具权限，但保留审批状态判定边界。"""
    from .routers.personal_agent import APPROVAL_STATE_AUTHORITY

    return (
        f"你是{bot.name}。{bot.persona}。仅讨论当前交接，不执行工具。\n"
        f"{APPROVAL_STATE_AUTHORITY}\n"
    )


def studio_tool_denial(bot: Bot, name: str, args: dict) -> str:
    if bot.tool_allowlist and name not in bot.tool_allowlist:
        return "该工具不在本 Bot 的授权列表"
    steps = args.get("steps")
    if name == "start_studio_batch" and bot.allowed_agent_ids and isinstance(steps, list):
        for step in steps:
            if isinstance(step, dict) and not agent_id_allowed(
                str(step.get("agentId") or step.get("agent_id") or ""), bot.allowed_agent_ids
            ):
                return "批量计划包含未授权 Agent"
    return ""


def tools_for_bot(bot: Bot, core_tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """按信任等级与 allowlist 收窄工具，并附加 Bot 专属工具。"""
    allow = tools_allowed_for_trust(bot.trust_level, bot.tool_allowlist or None)
    out: list[dict[str, Any]] = []
    for t in core_tools:
        name = (t.get("function") or {}).get("name")
        if not name:
            continue
        if bot.delegate_only and name in {"cowrite"}:
            continue
        if allow is not None and name not in allow and name not in {
            "record_writing_feedback",
            "tool_search",
            "search_tools",
            "tool_invoke",
            "invoke_tool",
            "run_agent",
            "start_async_task",
            "create_fleet",
            "subagent_spawn",
            "plan",
            "steer_agent",
            "stop_agent",
            "agent_status",
            "check_async_task",
            "update_async_task",
            "cancel_async_task",
            "list_async_tasks",
            "follow_up",
            "write_memory",
            "read_memory",
            "scratchpad",
            "approve_proposal",
            "list_proposals",
        }:
            # 幕僚长 / 空 allowlist：不过滤核心调度工具
            if bot.tool_allowlist:
                continue
        out.append(t)

    for t in BOT_EXTRA_TOOLS:
        name = (t.get("function") or {}).get("name")
        if name in EGG_ONLY and bot.id != EGG_BOT_ID and bot.role_kind != "designer":
            continue
        if allow is not None and bot.tool_allowlist and name not in allow and name not in EGG_ONLY:
            # 有显式 allowlist 时仍放出通用协作/技能工具
            if name not in {
                "ask_bot",
                "delegate_to_bot",
                "report_to",
                "skill_save",
                "skill_run",
                "skill_update",
                "routine_create",
                "routine_list",
                "routine_update",
                "learn_correction",
                "show_memories",
                "restate_intent",
                "catch_up",
                "deliver_result",
                "halt_pipeline",
            }:
                continue
        out.append(t)
    return out


def _resolve_bot_ref(session: Session, bot_id: str | None, bot_name: str | None) -> Bot | None:
    if bot_id:
        return get_bot(session, bot_id)
    if bot_name:
        for b in list_bots(session):
            if b.name == bot_name or bot_name in (b.aliases or []):
                return b
    return None


def _min_interval_seconds(cron_or_interval: str) -> int | None:
    s = (cron_or_interval or "").strip().lower()
    m = re.fullmatch(r"(\d+)\s*([smhdw])", s)
    if m:
        n, u = int(m.group(1)), m.group(2)
        return n * {"s": 1, "m": 60, "h": 3600, "d": 86400, "w": 604800}[u]
    # cron：粗略认为可能很频繁，交给调用方用 confirm_high_freq
    return None


async def execute_bot_tool(
    name: str,
    args: dict[str, Any],
    session: Session,
    conv: Conversation,
    bot: Bot,
) -> tuple[str, dict[str, Any]] | None:
    """执行 Bot 专属工具；非专属返回 None。"""
    if name not in BOT_EXTRA_NAMES:
        return None
    from .knowledge_colleague import colleague, owns_bot
    detail: dict[str, Any] = {"tool": name, "bot_id": bot.id}

    if name == "ask_bot":
        target = _resolve_bot_ref(session, args.get("bot_id"), args.get("bot_name"))
        if not target:
            return "找不到要咨询的同事。", detail
        target = colleague(session, target.id, conv.user_id, conv.project_id)
        question = str(args.get("question") or "").strip()
        # 隐藏 bot_dm 会话
        dm = Conversation(
            source=conv.source,
            user_id=conv.user_id,
            project_id=conv.project_id,
            title=f"bot_dm:{bot.id}->{target.id}",
            kind="bot_dm",
            bot_id=target.id,
            member_bot_ids=[bot.id, target.id],
        )
        session.add(dm)
        session.commit()
        session.refresh(dm)
        from .routers.personal_agent import _append_message

        _append_message(session, dm.id, "user", f"[来自 {bot.name}] {question}", bot_id=bot.id)
        reply_holder: list[str] = []

        async def _noop_emit(event: str, data: dict[str, Any]) -> None:
            if event == "done" and data.get("reply"):
                reply_holder.append(str(data["reply"]))

        events = None
        if (target.execution or {}).get("enabled"):
            from .models import AgentEvent
            from .knowledge_colleague import knowledge_admission
            from .context_refs import current_turn_refs
            payload = {"message":question, "contextRefs":current_turn_refs(conv.id)}
            admission = knowledge_admission(session, dm, target.id, payload, [target.id])
            events = [AgentEvent(conversation_id=dm.id, source="bot_delegate",
                                 payload={**payload, "knowledgeAdmission":admission})]
        await run_bot_turn(session, dm, target, _noop_emit, claimed_events=events, skip_inbox=True)
        answer = reply_holder[-1] if reply_holder else "（对方无回复）"
        detail["target_bot_id"] = target.id
        detail["answer"] = answer[:2000]
        # 也在原会话留下可见痕迹
        _append_message(
            session,
            conv.id,
            "assistant",
            f"【{bot.name} → {target.name}】问：{question}\n答：{answer}",
            bot_id=bot.id,
            actions=[{"type": "bot_ask", "from": bot.id, "to": target.id}],
        )
        return f"{target.name} 回答：{answer}", detail

    if name == "delegate_to_bot":
        target = _resolve_bot_ref(session, args.get("bot_id"), args.get("bot_name"))
        if not target:
            return "找不到要委派的同事。", detail
        target = colleague(session, target.id, conv.user_id, conv.project_id)
        admitted_ids = [target.id] if (target.execution or {}).get("enabled") else []
        task = str(args.get("task") or "")
        context = str(args.get("context") or "")
        # 目标 Bot 的 dm 或专用会话
        target_conv = session.exec(
            select(Conversation).where(
                Conversation.bot_id.in_(bot_id_aliases(target.id)),
                Conversation.project_id == conv.project_id,
                Conversation.kind == "dm",
                Conversation.user_id == conv.user_id,
            )
        ).first()
        if not target_conv:
            target_conv = Conversation(
                source=conv.source,
                user_id=conv.user_id,
                project_id=conv.project_id,
                title=f"与{target.name}",
                kind="dm",
                bot_id=target.id,
            )
            session.add(target_conv)
            session.commit()
            session.refresh(target_conv)
        from .agent_inbox import submit_event
        from .context_refs import current_turn_refs

        submit_event(
            session,
            conversation_id=target_conv.id,
            source="bot_delegate",
            admitted_knowledge_ids=admitted_ids,
            payload={
                "message": f"[委派自 {bot.name}] {task}\n上下文：{context}",
                **({"contextRefs": current_turn_refs(conv.id)} if admitted_ids else {}),
                "from_bot_id": bot.id,
                "from_conversation_id": conv.id,
                "reply_to_conversation_id": conv.id,
            },
            dedupe_key=None,
            priority=20,
            target_bot_id=target.id,
        )
        detail["target_bot_id"] = target.id
        detail["target_conversation_id"] = target_conv.id
        return f"已委派给「{target.name}」，完成后会回到本会话。", detail

    if name == "report_to":
        target_id = agent_id_from_bot_id(str(args.get("bot_id") or CHIEF_BOT_ID))
        colleague(session, target_id, conv.user_id, conv.project_id)
        summary = str(args.get("summary") or "")
        evidence = list(args.get("evidence") or [])
        from .agent_inbox import submit_event
        from .routers.personal_agent import _append_message

        chief_conv = session.exec(
            select(Conversation).where(
                Conversation.bot_id.in_(bot_id_aliases(target_id)),
                Conversation.project_id == conv.project_id,
                Conversation.kind == "dm",
                Conversation.user_id == conv.user_id,
            )
        ).first()
        if not chief_conv:
            chief_conv = Conversation(
                source="assistant",
                project_id=conv.project_id,
                user_id=conv.user_id,
                title="与幕僚长",
                kind="dm",
                bot_id=target_id,
            )
            session.add(chief_conv)
            session.commit()
            session.refresh(chief_conv)
        submit_event(
            session,
            conversation_id=chief_conv.id,
            source="bot_reply",
            payload={"message": f"[汇报自 {bot.name}] {summary}", "evidence": evidence},
            priority=10,
            target_bot_id=target_id,
        )
        _append_message(
            session,
            conv.id,
            "assistant",
            f"已向 {target_id} 汇报：{summary}",
            bot_id=bot.id,
            evidence=evidence,
        )
        return "已汇报。", detail

    if name == "skill_save":
        nm = str(args.get("name") or "未命名技能")
        slash = str(args.get("slash") or nm).lower().replace(" ", "-")
        skill = BotSkill(
            bot_id=bot.id,
            name=nm,
            slash=slash,
            when_to_use=str(args.get("when_to_use") or ""),
            steps_md=str(args.get("steps_md") or ""),
            evidence_required=bool(args.get("evidence_required")),
            confirm_when=str(args.get("confirm_when") or ""),
            source_conversation_id=conv.id,
            trust_stage="saved",
        )
        session.add(skill)
        session.commit()
        session.refresh(skill)
        detail["skill_id"] = skill.id
        detail["slash"] = skill.slash
        return f"已保存技能「{nm}」，可用 /{slash} 调用。信任阶段=saved。", detail

    if name == "skill_run":
        token = str(args.get("slash") or args.get("name") or "").strip()
        skill = slash_to_skill(session, f"/{token}" if not token.startswith("/") else token, bot_id=bot.id)
        if not skill:
            return "找不到该技能。", detail
        inputs = args.get("inputs") if isinstance(args.get("inputs"), dict) else {}
        detail["skill_id"] = skill.id
        detail["trust_stage"] = skill.trust_stage
        return (
            f"执行技能「{skill.name}」(/{skill.slash})，阶段={skill.trust_stage}。\n"
            f"适用：{skill.when_to_use}\n"
            f"步骤：\n{skill.steps_md}\n"
            f"输入：{json.dumps(inputs, ensure_ascii=False)}\n"
            f"请按步骤调用其他工具完成；完成后若无纠正可 skill_update 增加 clean_runs。"
        ), detail

    if name == "skill_update":
        skill = None
        if args.get("skill_id"):
            skill = session.get(BotSkill, str(args["skill_id"]))
        elif args.get("slash"):
            skill = slash_to_skill(session, f"/{args['slash']}", bot_id=bot.id)
        if not skill or (skill.bot_id and skill.bot_id not in bot_id_aliases(bot.id)):
            return "找不到技能。", detail
        if args.get("steps_md"):
            skill.steps_md = str(args["steps_md"])
        if args.get("trust_stage"):
            skill.trust_stage = str(args["trust_stage"])
        delta = int(args.get("clean_runs_delta") or 0)
        skill.clean_runs = max(0, skill.clean_runs + delta)
        # 信任四步推进
        if skill.clean_runs >= 3 and skill.trust_stage == "saved":
            skill.trust_stage = "one_shot"
        if skill.clean_runs >= 5 and skill.trust_stage == "one_shot":
            skill.trust_stage = "routine"
        skill.updated_at = utcnow()
        session.add(skill)
        session.commit()
        detail["trust_stage"] = skill.trust_stage
        detail["clean_runs"] = skill.clean_runs
        hint = ""
        if skill.trust_stage == "one_shot":
            hint = " 已达一次做对，可建议设为例程。"
        if skill.trust_stage == "routine":
            hint = " 建议 routine_create 固化。"
        return f"技能已更新：stage={skill.trust_stage}, clean_runs={skill.clean_runs}。{hint}", detail

    if name == "routine_create":
        cron = str(args.get("cron") or "1h")
        trigger_type = str(args.get("trigger_type") or "schedule")
        event_filter = args.get("event_filter") if isinstance(args.get("event_filter"), dict) else None
        # 频率护栏只约束 schedule 型；event 型按事件触发，不按时钟
        if trigger_type != "event":
            secs = _min_interval_seconds(cron)
            if secs is not None and secs < 3600 and not args.get("confirm_high_freq"):
                return (
                    f"例程频率 {cron} 低于每小时一次，成本高。若确认请设 confirm_high_freq=true。",
                    detail,
                )
        rid = f"bot.{bot.id}.{new_id()[:8]}"
        row = ScheduledTask(
            id=rid,
            name=str(args.get("name") or f"{bot.name}例程"),
            cron_or_interval=cron,
            enabled=True,
            owner_scope="bot",
            payload_template={"type": "bot.routine", "bot_id": bot.id, "project_id": conv.project_id},
            bot_id=bot.id,
            prompt=str(args.get("prompt") or ""),
            quiet_policy=str(args.get("quiet_policy") or "silent_if_nothing"),
            active_window=args.get("active_window") if isinstance(args.get("active_window"), dict) else None,
            trigger_type=trigger_type,
            event_filter=event_filter or {},
        )
        session.add(row)
        session.commit()
        detail["routine_id"] = rid
        detail["trigger_type"] = trigger_type
        if trigger_type == "event":
            return f"已创建事件触发例程 {rid}（命中 {event_filter or {}} 时唤醒）。", detail
        return f"已创建例程 {rid}（{cron}）。", detail

    if name == "routine_list":
        rows = list(session.exec(select(ScheduledTask).where(ScheduledTask.bot_id.in_(bot_id_aliases(bot.id)))))
        if not rows:
            return "暂无例程。", detail
        lines = [
            f"- {r.id} {r.name} cron={r.cron_or_interval} enabled={r.enabled} runs={r.run_count} cost={r.last_cost_tokens}"
            for r in rows
        ]
        detail["routines"] = [r.id for r in rows]
        return "例程：\n" + "\n".join(lines), detail

    if name == "routine_update":
        row = session.get(ScheduledTask, str(args.get("routine_id")))
        if not row or row.bot_id not in bot_id_aliases(bot.id):
            return "找不到例程。", detail
        if "enabled" in args:
            row.enabled = bool(args["enabled"])
        if args.get("cron"):
            row.cron_or_interval = str(args["cron"])
        if args.get("prompt") is not None:
            row.prompt = str(args["prompt"])
        if args.get("quiet_policy"):
            row.quiet_policy = str(args["quiet_policy"])
        session.add(row)
        session.commit()
        return f"例程 {row.id} 已更新。", detail

    if name == "learn_correction":
        from .memory_service import cas_write_memory
        from .models import MemoryFile

        path = _correction_path(bot.id, conv)
        existing = session.get(MemoryFile, path)
        previous = existing
        if not previous and is_agent_colleague_id(bot.id):
            previous = session.get(MemoryFile, _correction_path("agent:" + bot.id, conv))
        if previous and (previous.user_id != conv.user_id or previous.project_id not in (None, conv.project_id)):
            return "该记忆不属于当前会话。", detail
        prev = (previous.content if previous else "") or f"# {bot.name} 纠错记录\n\n"
        line = f"- [{utcnow().isoformat()}] {args.get('correction')}"
        if args.get("context"):
            line += f"（上下文：{str(args['context'])[:120]}）"
        new_content = prev.rstrip() + "\n" + line + "\n"
        receipt = cas_write_memory(
            session,
            path=path,
            content=new_content,
            expected_hash=existing.hash if existing else None,
            check_cas=True,
            actor=f"bot:{bot.id}",
            allow_create=True,
            source_conversation_id=conv.id,
            project_id=conv.project_id,
        )
        detail.update(path=receipt.row.path, hash=receipt.row.hash, versionId=receipt.version_id)
        return "已写入纠错记忆。", detail

    if name == "show_memories":
        from .models import MemoryFile

        rows = private_memory_files(session, bot.id, conv.user_id, conv.project_id, conv.id)
        if not rows:
            return "暂无私有记忆。", detail
        chunks = []
        for r in rows:
            chunks.append(f"### {r.path}\n{(r.content or '')[:800]}")
        return "我的记忆：\n\n" + "\n\n".join(chunks), detail

    if name == "restate_intent":
        goal = str(args.get("goal") or "")
        problem = str(args.get("problem") or "")
        uncertainties = list(args.get("uncertainties") or [])
        text = (
            f"## 我理解的目标\n{goal}\n\n"
            f"## 要解决的问题\n{problem or '（未说明）'}\n\n"
            f"## 仍不确定\n"
            + ("\n".join(f"- {u}" for u in uncertainties) if uncertainties else "- （无）")
            + "\n\n请确认后我再动手。"
        )
        detail["restate"] = {"goal": goal, "problem": problem, "uncertainties": uncertainties}
        detail["needs_confirm"] = True
        return text, detail

    if name == "catch_up":
        from .models import RunStep

        # 找最近一条用户消息
        msgs = list(
            session.exec(
                select(Message)
                .where(Message.conversation_id == conv.id)
                .order_by(Message.created_at.desc())
                .limit(40)
            )
        )
        last_user = next((m for m in msgs if m.role == "user"), None)
        since = last_user.content if last_user else ""
        steps = list(
            session.exec(
                select(RunStep)
                .where(RunStep.conversation_id == conv.id)
                .order_by(RunStep.seq.desc())
                .limit(20)
            )
        )
        events = [
            {"title": s.kind, "detail": json.dumps(s.payload, ensure_ascii=False)[:160]}
            for s in reversed(steps)
        ]
        action_items = []
        for m in msgs:
            for a in m.actions or []:
                if a.get("type") in {"confirm_required", "restate_confirm", "halt"}:
                    action_items.append({"title": a.get("type"), "context": m.content[:120]})
        summary = build_catch_up_summary(since_text=since, events=events, action_items=action_items)
        return summary, detail

    if name == "deliver_result":
        summary = str(args.get("summary") or "")
        evidence = list(args.get("evidence") or [])
        if not evidence:
            return "交付必须附证据（artifact 链接 / gate 结果 / 前后对比）。请补充 evidence。", detail
        from .routers.personal_agent import _append_message

        _append_message(
            session,
            conv.id,
            "assistant",
            summary,
            bot_id=bot.id,
            evidence=evidence,
            actions=[{"type": "delivery", "evidence_count": len(evidence)}],
        )
        mark_reported(session, summary[:120], bot_id=bot.id)
        detail["evidence"] = evidence
        return f"已交付（{len(evidence)} 条证据）。\n{summary}", detail

    if name == "halt_pipeline":
        reason = str(args.get("reason") or "")
        run_id = args.get("run_id")
        tg = args.get("task_group_id")
        if run_id:
            try:
                from .models import AgentRun
                from .queue import request_interrupt

                run = session.get(AgentRun, str(run_id))
                if run and run.status in {"queued", "running"}:
                    run.status = "cancelled"
                    run.approval_state = "rejected"
                    session.add(run)
                    session.commit()
                try:
                    request_interrupt(str(run_id))
                except Exception:  # noqa: BLE001
                    pass
            except Exception:  # noqa: BLE001
                pass
        if tg:
            try:
                from .task_daemon import cancel_group

                cancel_group(session, str(tg))
            except Exception:  # noqa: BLE001
                pass
        detail["halt"] = True
        detail["reason"] = reason
        return f"已拉停：{reason}。请主人决定下一步。", detail

    # —— 蛋博士 ——
    if name == "bot_create":
        cfg = args.get("config") if isinstance(args.get("config"), dict) else {}
        if args.get("from_interview") and isinstance(args["from_interview"], dict):
            cfg = {**interview_to_draft(args["from_interview"]), **cfg}
        if not cfg.get("name"):
            return "需要 name 或 from_interview。", detail
        created = create_bot(session, cfg, owner_user_id=conv.user_id)
        detail["created_bot_id"] = created.id
        return f"已创建同事「{created.name}」（id={created.id}）。", detail

    if name == "bot_update":
        target = get_bot(session, str(args.get("bot_id")))
        if not owns_bot(target, conv.user_id):
            return "Bot 不存在。", detail
        patch = args.get("patch") if isinstance(args.get("patch"), dict) else {}
        try:
            updated = patch_bot(session, target, patch)
        except ValueError as e:
            return str(e), detail
        return f"已更新「{updated.name}」。", detail

    if name == "bot_list":
        rows = [b for b in list_bots(session) if owns_bot(b, conv.user_id)]
        lines = [
            f"- {b.name} ({b.id}) role={b.role_kind} trust={b.trust_level} pinned={b.pinned}"
            for b in rows
        ]
        return "同事列表：\n" + "\n".join(lines), detail

    if name == "bot_inspect":
        target = _resolve_bot_ref(session, args.get("bot_id"), args.get("bot_name"))
        if not owns_bot(target, conv.user_id):
            return "找不到 Bot。", detail
        skills = list(session.exec(select(BotSkill).where(BotSkill.bot_id.in_(bot_id_aliases(target.id)))))
        routines = list(session.exec(select(ScheduledTask).where(ScheduledTask.bot_id.in_(bot_id_aliases(target.id)))))
        from .models import MemoryFile

        corr = session.get(MemoryFile, _correction_path(target.id, conv))
        return (
            f"# {target.name}\n"
            f"职责：{target.duties}\n禁止：{target.never_do}\n信任：{target.trust_level}\n"
            f"技能数：{len(skills)}；例程数：{len(routines)}\n"
            f"纠错摘录：\n{(corr.content if corr else '（无）')[:800]}"
        ), detail

    if name == "routine_audit":
        rows = list(session.exec(select(ScheduledTask).where(ScheduledTask.bot_id != None)))  # noqa: E711
        findings = []
        for r in rows:
            secs = _min_interval_seconds(r.cron_or_interval)
            if r.enabled and secs is not None and secs < 3600:
                findings.append({"id": r.id, "issue": "too_frequent", "cron": r.cron_or_interval})
            if r.enabled and r.run_count == 0 and r.last_run_at is None:
                findings.append({"id": r.id, "issue": "unused", "name": r.name})
            if r.last_cost_tokens and r.last_cost_tokens > 50000:
                findings.append({"id": r.id, "issue": "expensive", "tokens": r.last_cost_tokens})
        # 写提案
        for f in findings[:10]:
            session.add(
                TaskProposal(
                    type="bot_improvement",
                    message=f"例程体检：{f}",
                    actions=[{"type": "routine_patch", **f}],
                    status="pending",
                    priority=1,
                )
            )
        session.commit()
        detail["findings"] = findings
        if not findings:
            return "例程体检：未发现明显问题。", detail
        return "例程体检发现问题：\n" + "\n".join(json.dumps(f, ensure_ascii=False) for f in findings), detail

    if name == "chat_audit":
        from datetime import timedelta

        since_days = max(1, int(args.get("since_days") or 7))
        limit = max(5, min(200, int(args.get("limit") or 40)))
        target = _resolve_bot_ref(session, args.get("bot_id"), args.get("bot_name"))
        cutoff = utcnow() - timedelta(days=since_days)

        convs = list(session.exec(select(Conversation).where(Conversation.bot_id != None)))  # noqa: E711
        if target:
            convs = [c for c in convs if c.bot_id in bot_id_aliases(target.id)]

        lines: list[str] = []
        total = 0
        scanned = 0
        for c in convs:
            msgs = list(
                session.exec(
                    select(Message)
                    .where(Message.conversation_id == c.id)
                    .order_by(Message.created_at.desc())
                    .limit(limit)
                )
            )
            msgs = [m for m in msgs if m.created_at and m.created_at >= cutoff]
            if not msgs:
                continue
            scanned += 1
            b = get_bot(session, c.bot_id)
            bname = b.name if b else c.bot_id
            lines.append(f"### {bname}（{c.kind}）")
            for m in reversed(msgs):
                content = (m.content or "").replace("\n", " ").strip()
                if not content:
                    continue
                prefix = "主人" if m.role == "user" else bname
                lines.append(f"- {prefix}: {content[:200]}")
                total += 1
                if total >= limit * 4:
                    break
            if total >= limit * 4:
                break
        detail["bots_scanned"] = scanned
        if not lines:
            return f"近 {since_days} 天没有可审计的对话。", detail
        return "近期对话摘录（供审计被纠正/误解之处）：\n\n" + "\n".join(lines), detail

    return f"未实现的 Bot 工具：{name}", detail


def record_bot_usage(
    session: Session,
    *,
    bot_id: str,
    user_id: str,
    model: str,
    prompt_tokens: int,
    completion_tokens: int,
    project_id: str | None = None,
    conversation_id: str | None = None,
    cache_hit_tokens: int = 0,
    cache_miss_tokens: int = 0,
) -> str:
    bot_id = agent_id_from_bot_id(bot_id)
    event = UsageEvent(
        agent_id=bot_id if is_agent_colleague_id(bot_id) else None,
        user_id=user_id,
        project_id=project_id,
        bot_id=bot_id,
        model=model or "default",
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        cache_hit_tokens=cache_hit_tokens,
        cache_miss_tokens=cache_miss_tokens,
        cost_est=0,
    )
    event_id = event.id
    session.add(event)
    session.commit()
    # 周预算熔断：暂停例程
    bot = get_bot(session, bot_id)
    if not bot or not bot.weekly_token_budget:
        return event_id
    from datetime import timedelta

    week_ago = utcnow() - timedelta(days=7)
    rows = list(session.exec(select(UsageEvent).where(UsageEvent.bot_id.in_(bot_id_aliases(bot_id)))))
    used = sum(
        (r.prompt_tokens + r.completion_tokens)
        for r in rows
        if r.created_at and r.created_at >= week_ago
    )
    if used >= bot.weekly_token_budget:
        for r in session.exec(select(ScheduledTask).where(ScheduledTask.bot_id.in_(bot_id_aliases(bot_id)))):
            if r.enabled:
                r.enabled = False
                session.add(r)
        session.commit()
        logger.warning("bot %s weekly budget exceeded (%s/%s); routines paused", bot_id, used, bot.weekly_token_budget)
    return event_id


def expand_slash_message(session: Session, text: str, bot: Bot) -> str:
    skill = slash_to_skill(session, text, bot_id=bot.id)
    if not skill:
        return text
    rest = text.strip().split(None, 1)
    extra = rest[1] if len(rest) > 1 else ""
    return (
        f"请按技能「{skill.name}」(/{skill.slash}) 执行。\n"
        f"适用：{skill.when_to_use}\n步骤：\n{skill.steps_md}\n"
        f"额外输入：{extra}\n"
        f"evidence_required={skill.evidence_required} confirm_when={skill.confirm_when}"
    )


def knowledge_request(session, bot, project_id, batch):
    from .knowledge_colleague import selected_references
    tasks, refs = [], []
    for event in batch:
        if event.source in KNOWLEDGE_REQUEST_SOURCES:
            payload = event.payload or {}
            if payload.get("message"):
                tasks.append(str(payload["message"]))
            refs.extend(payload.get("contextRefs") or [])
    selected = selected_references(session, bot, project_id, refs) if refs else []
    return "\n".join(tasks) or ("请核查选中原文" if selected else ""), selected


async def run_bot_turn(
    session: Session, conv: Conversation, bot: Bot, emit: EmitFn, *,
    claimed_events: list | None = None, skip_inbox: bool = False, discussion_prompt: str | None = None, discussion_id: str | None = None,
) -> str | None:
    from .knowledge_colleague import colleague, validate_knowledge_delivery
    validate_knowledge_delivery(session, conv, [ev.payload for ev in claimed_events or []], bot.id)
    bot = colleague(session, bot.id, conv.user_id, conv.project_id)
    from .context_refs import reference_turn, reference_emitter
    with reference_turn(conv.id, claimed_events):
        from .feishu_outbox import ReplyTurn
        turn = ReplyTurn.current(session, conv.id)
        previous = turn.row if turn else None
        reply = await _run_bot_turn_impl(session, conv, bot, reference_emitter(conv.id, emit),
                                        claimed_events=claimed_events, skip_inbox=skip_inbox, discussion_prompt=discussion_prompt, discussion_id=discussion_id)
        if turn and reply and not discussion_id and turn.row is previous:
            # Context/budget and tool errors can return text without an ordinary
            # final row. Capture the speaker before leaving its reference scope.
            from .routers.personal_agent import _append_message
            _append_message(session, conv.id, "assistant", reply, bot_id=bot.id, final_reply=True)
        return reply


@owned_turn
async def _run_bot_turn_impl(
    session: Session,
    conv: Conversation,
    bot: Bot,
    emit: EmitFn,
    *,
    claimed_events: list | None = None,
    skip_inbox: bool = False,
    discussion_prompt: str | None = None,
    discussion_id: str | None = None,
) -> str | None:
    """泛化 Supervisor 循环：按 Bot 身份跑一轮。"""
    from .routers import personal_agent as pa

    turn_id = new_id()
    batch = list(claimed_events or [])

    async def emit_and_log(event: str, data: dict[str, Any]) -> None:
        if event == "error":
            from .context_refs import current_turn_refs
            data = {**data, "botId": bot.id, "contextRefs": current_turn_refs(conv.id)}
        kind_map = {
            "tool_call": "tool_call",
            "tool_result": "tool_result",
            "plan": "dispatch",
            "confirm": "confirm",
            "done": "reply",
            "error": "error",
            "restate": "confirm",
        }
        kind = kind_map.get(event)
        if event == "tool_result" and (data.get("detail") or {}).get("error"):
            kind = "error"
        if kind:
            pa._append_run_step(
                session,
                conv.id,
                kind,
                {"event": event, "bot_id": bot.id, **data},
                actor=bot.id,
                turn_id=turn_id,
                run_id=data.get("run_id") or data.get("runId"),
            )
        await emit(event, data)

    from .knowledge_colleague import validate_knowledge_delivery
    pinned = validate_knowledge_delivery(session, conv, [ev.payload for ev in batch], bot.id)
    if bot.id in pinned or (bot.execution or {}).get("enabled"):
        if discussion_prompt:
            await emit_and_log("error", {"message": "请在编组中将知识同事设为产物执行岗位"})
            return None
        # Knowledge conversations dispatch directly into the normal worker. Only user
        # requests and scheduled prompts start work; completion notifications do not.
        instruction, selected = knowledge_request(session, bot, conv.project_id, batch)
        if not instruction:
            await emit_and_log("done", {"reply": "", "noop": True, "conversationId": conv.id})
            return ""
        from .models import Project
        check_owner(session, conv.id)
        args = {"project_id":conv.project_id, "agent_id":bot.id, "instruction":instruction}
        need, reason = requires_confirm(tool_name="run_agent", trust_level=bot.trust_level, args=args,
                                        restate_before_act=bot.restate_before_act)
        if need or bot.restate_before_act:
            message = f"请确认由{bot.name}核查本项目资料：{instruction}"
            action = dict(type="confirm_required", tool="run_agent", args=args, message=message,
                          bot_id=bot.id, knowledgeDispatch=True, knowledgeSources=list(dict.fromkeys(r["sourceId"] for r in selected)), editable=False)
            pa._append_message(session, conv.id, "assistant", message, bot_id=bot.id, actions=[action], final_reply=True)
            await emit_and_log("confirm", dict(message=message,tool="run_agent",args=args,botId=bot.id,editable=False))
            return message
        info = pa._trigger_agent(session, session.get(Project, conv.project_id), bot.id, bot.name,
                                 instruction, conversation_id=conv.id, selected_refs=selected)
        reply = f"已安排{bot.name}核查本项目授权资料。运行 ID {info['run_id']}"
        pa._append_message(session, conv.id, "assistant", reply, bot_id=bot.id, actions=[{"type":"run_agent", **info}], final_reply=True)
        await emit_and_log("tool_result", {"tool":"run_agent", "detail":info})
        await emit_and_log("done", {"reply":reply, "conversationId":conv.id, "botId":bot.id})
        return reply

    # 斜杠技能展开：改写 batch / 最近用户消息
    if not skip_inbox:
        for ev in batch:
            msg = str((ev.payload or {}).get("message") or "")
            if msg.strip().startswith("/"):
                expanded = expand_slash_message(session, msg, bot)
                ev.payload = {**(ev.payload or {}), "message": expanded}

    memory_sources = []
    try:
        if discussion_prompt:
            system = discussion_system_prompt(bot)
            _sections = [{"name": "identity", "text": system}]
        else:
            system, _sections = build_bot_system_prompt(session, bot, conv)
            memory_sources = [source for section in _sections for source in section.get("memorySources", [])]
    except pa.ContextSourceUnavailable as exc:
        await emit_and_log("error", {"message": str(exc), "code": "context_source_unavailable"})
        return str(exc)
    base_tools = tools_for_bot(bot, pa.CORE_SUPERVISOR_TOOLS)
    read_project_query = (
        bot.id == CHIEF_BOT_ID and conv.kind == "dm"
        and not (skip_inbox or discussion_prompt or discussion_id)
        and any(tool["function"]["name"] == "list_projects" for tool in base_tools)
    )
    scanned_project_events = 0
    loaded_extra: set[str] = set()
    loaded_extra_order: list[str] = []
    error_sig = ""
    error_sig_hits = 0

    def _active_tools() -> list[dict[str, Any]]:
        if not loaded_extra:
            return base_tools
        by_name = {
            (t.get("function") or {}).get("name"): t
            for t in pa.SUPERVISOR_TOOLS_ALL
            if (t.get("function") or {}).get("name")
        }
        out = list(base_tools)
        seen = {(t.get("function") or {}).get("name") for t in out}
        known = set(loaded_extra_order)
        loaded_extra_order.extend(n for n in sorted(loaded_extra) if n not in known)
        for n in loaded_extra_order:
            if n in seen or n not in by_name:
                continue
            if n in {"search_tools", "invoke_tool", "tool_invoke"}:
                continue
            out.append(by_name[n])
            seen.add(n)
        return out

    history_scope = {} if bot.is_system else {"ordinary_bot_id":bot.id}
    for _ in range(MAX_TURNS):
        if not skip_inbox:
            try:
                from .agent_inbox import claim_additional, inbox_event_actions, merge_user_messages

                extra = claim_additional(session, conv.id)
                if extra:
                    batch.extend(extra)
                    merged_extra = merge_user_messages(extra)
                    if merged_extra:
                        pa._append_message(
                            session,
                            conv.id,
                            "user",
                            merged_extra,
                            actions=inbox_event_actions(extra),
                            bot_id=None,
                        )
            except Exception:  # noqa: BLE001
                pass

        try:
            # meta/skip_inbox：更激进压缩，避免长会话里元操作空转烧尽 MAX_TURNS
            # Additional events can arrive while an ordinary supervisor is running.
            # A later knowledge admission cannot be consumed by its ordinary prompt.
            if bot.id in validate_knowledge_delivery(session, conv, [ev.payload for ev in batch], bot.id):
                raise HTTPException(409, "本批包含知识岗位派单，请按当前知识岗位重新发起")
            if read_project_query:
                from .thread_router import project_list_query

                # Coalesced user messages share a reply. Read each distinct query once per new inbox batch.
                project_queries: dict[tuple[tuple[str, Any], ...], list[str]] = {}
                for request in batch[scanned_project_events:]:
                    if request.source not in {"web", "feishu"}:
                        continue
                    payload = request.payload or {}
                    if payload.get("contextRefs") or payload.get("force_continue"):
                        continue
                    args = project_list_query(str(payload.get("message") or ""))
                    if args is not None:
                        project_queries.setdefault(tuple(sorted(args.items())), []).append(request.id)
                scanned_project_events = len(batch)
                for query, event_ids in project_queries.items():
                    name, tool_call_id = "list_projects", new_id()
                    args = dict(query)
                    origin = {"source": "user_route", "inboxEventId": event_ids[-1],
                              "inboxEventIds": event_ids, "toolCallId": tool_call_id}
                    await emit_and_log("tool_call", {"tool": name, "args": args, "botId": bot.id, **origin})
                    text, detail = await pa._execute_supervisor_tool(name, args, session, conv)
                    pa._audit_safe(session, conv, name, args, text, detail, bot=bot)
                    pa._append_message(session, conv.id, "assistant", "", bot_id=bot.id,
                        tool_calls=[{"id": tool_call_id, "type": "function",
                                     "function": {"name": name, "arguments": json.dumps(args, ensure_ascii=False)}}],
                        actions=[{"type": "tool_route", **origin}])
                    pa._append_message(session, conv.id, "tool", text, bot_id=bot.id,
                        actions=[{"tool_call_id": tool_call_id, "name": name, "detail": detail, **origin}])
                    await emit_and_log("tool_result", {"tool": name, "detail": detail, "botId": bot.id, **origin})
            if discussion_prompt:
                history = [{"role": "user", "content": discussion_prompt}]
                original_history = history
            else:
                original_history = pa._load_history(session, conv.id, **history_scope)
                options = {"trigger_chars": 8000, "keep_tail": 10, "keep_head_users": 1} if skip_inbox else {}
                history = pa._compact_history(original_history, **options)
        except pa.ContextBudgetExceeded as exc:
            await emit_and_log("error", {"message": str(exc), "code": "context_budget_exceeded"})
            return str(exc)
        # 候选静默
        sys = system
        if any(getattr(e, "source", "") == "feishu_candidate" for e in batch):
            sys += (
                "\n## 候选事件\n"
                "本批含群聊候选消息：若不需要行动，请只回复 [NOOP]，不要调用工具。\n"
            )
        messages, call_sections = pa._personal_model_context(sys, history, _sections, include_clock=not discussion_prompt)
        try:
            check_owner(session, conv.id)
            active_tools = None if discussion_prompt else _active_tools()
            call_id = new_id()
            pa._append_run_step(session, conv.id, "model_call", {
                "manifest": pa.context_manifest(messages, original_history, active_tools, call_sections, memory_sources,
                                                discussion=bool(discussion_prompt))
            }, actor=bot.id, turn_id=turn_id, step_id=call_id)
            resp = await chat_completion(
                messages,
                temperature=0.2,
                max_tokens=get_settings().personal_agent_max_output_tokens,
                tools=active_tools,
                tool_choice=None if discussion_prompt else "auto",
            )
        except Exception as exc:  # noqa: BLE001
            await emit_and_log("error", {"message": str(exc)})
            return f"LLM 调用失败：{exc}。"

        check_owner(session, conv.id)
        # Record actual provider usage even when the response is truncated.
        try:
            usage_id = record_bot_usage(session, bot_id=bot.id, user_id=conv.user_id,
                             project_id=conv.project_id, **actual_usage(resp))
        except Exception:  # noqa: BLE001
            usage_id = None
        pa._append_run_step(session, conv.id, "usage", {"callId": call_id, "usageEventId": usage_id,
                            **actual_usage(resp)}, actor=bot.id, turn_id=turn_id)
        try:
            validate_agent_output(resp)
        except IncompleteAgentOutput as exc:
            await emit_and_log("error", {"message": str(exc), "code": exc.code})
            return str(exc)

        tool_calls = list(getattr(resp, "tool_calls", None) or [])
        content = getattr(resp, "content", "") or ""
        try:
            if not tool_calls and content:
                tool_calls = pa._extract_dsml_tool_calls(content)
            if discussion_prompt and tool_calls:
                raise IncompleteAgentOutput("讨论岗位不能派单")
            validate_tool_batch(tool_calls, pa.SUPERVISOR_TOOLS_ALL + base_tools)
        except (IncompleteAgentOutput, HTTPException) as exc:
            await emit_and_log("error", {"message": str(exc), "code": "incomplete_model_output"})
            return str(exc)

        if not tool_calls:
            reply = pa._clean_dsml(content)
            if not reply.strip():
                msg = "模型未返回有效回复，本轮未执行工具。请重试。"
                await emit_and_log("error", {"message": msg, "code": "incomplete_model_output"})
                return msg
            if reply.strip().upper() in {"[NOOP]", "NOOP"}:
                pa._append_message(session, conv.id, "assistant", "[NOOP]", bot_id=bot.id, final_reply=True)
                await emit_and_log("done", {"reply": "", "noop": True, "conversationId": conv.id, "botId": bot.id})
                return ""
            # 飞书前缀
            if conv.source == "feishu" and bot.id != CHIEF_BOT_ID:
                reply = f"【{bot.name}】{reply}"
            actions = [{"type": "pipeline_discussion", "discussionId": discussion_id}] if discussion_id else []
            pa._append_message(session, conv.id, "assistant", reply, bot_id=bot.id, actions=actions, final_reply=not discussion_id)
            await emit_and_log("done", {"reply": reply, "conversationId": conv.id, "botId": bot.id})
            return reply

        for tc in tool_calls:
            if not tc.get("id"):
                tc["id"] = new_id()

        pa._route_collaboration_calls(tool_calls, history, conv.project_id)

        pa._append_message(
            session, conv.id, "assistant", content, tool_calls=tool_calls, bot_id=bot.id
        )

        # 确认预扫描（信任策略）
        confirm_idx: int | None = None
        confirm_name = ""
        confirm_args: dict[str, Any] = {}
        confirm_text = ""
        confirm_reason = ""
        for i, tc in enumerate(tool_calls):
            fn = (tc.get("function") or {}) if isinstance(tc, dict) else {}
            name = str(fn.get("name") or "")
            try:
                args = pa._parse_tool_args(tc)
            except Exception:  # noqa: BLE001
                args = {}
            if not isinstance(args, dict):
                continue
            target = args.get("name") if name in {"invoke_tool", "tool_invoke"} else name
            if isinstance(target, str) and target in pa.studio_tools.NAMES:
                if name != target:
                    name = target
                    args = args.get("args") if isinstance(args.get("args"), dict) else {}
                    fn.update(name=name, arguments=json.dumps(args, ensure_ascii=False))
                reason = studio_tool_denial(bot, name, args)
                if reason:
                    args["__blocked"] = reason
                    fn["arguments"] = json.dumps(args, ensure_ascii=False)
                    continue
            if args.get("_routing_error") and name not in pa.studio_tools.NAMES:
                continue
            # 虚拟同事：run_agent 缺省绑定本人；allowed_agent_ids 限制
            if name == "run_agent":
                from .agent_colleagues import agent_id_from_bot_id, is_agent_colleague_id

                aid = str(args.get("agent_id") or "")
                if not aid and is_agent_colleague_id(bot.id):
                    aid = agent_id_from_bot_id(bot.id)
                    args["agent_id"] = aid
                    fn["arguments"] = json.dumps(args, ensure_ascii=False)
                if bot.allowed_agent_ids and aid and not agent_id_allowed(aid, bot.allowed_agent_ids):
                    args["__blocked"] = f"Agent {aid} 不在本 Bot 可派列表"
            need, reason = requires_confirm(
                tool_name=name,
                trust_level=bot.trust_level,
                args=args,
                restate_before_act=bot.restate_before_act,
            )
            # 空参数调用直接执行，让工具返回纠错提示，不做一次无意义的确认
            if name == "start_async_task":
                tasks = list(args.get("tasks") or [])
                if not tasks and not args.get("instruction") and not args.get("agent_id") and not args.get("goal"):
                    need, reason = False, ""
            # restate 优先
            if bot.restate_before_act and name not in {
                "restate_intent",
                "catch_up",
                "show_memories",
                "tool_search",
                "search_tools",
                "search_agents",
                "read_memory",
                "ls",
                "read",
            }:
                # 若本轮还没 restate，则要求先确认意图
                if name != "restate_intent" and not any(
                    ((x.get("function") or {}).get("name") == "restate_intent") for x in tool_calls
                ):
                    # 不强制拦截只读
                    if need or name in IRREVERSIBLE_TOOLS or name in {"run_agent", "cowrite", "create_fleet"}:
                        need, reason = True, "restate_before_act"
            if need:
                confirm_idx = i
                confirm_name = name
                confirm_args = args
                confirm_reason = reason
                if reason == "restate_before_act":
                    confirm_text = "执行前请先确认我理解的目标（可先让我 restate_intent）。是否继续？"
                else:
                    confirm_text = pa._requires_confirm(name, args) or f"即将执行「{name}」（{reason}），是否继续？"
                break

        if confirm_idx is not None:
            for tc in tool_calls:
                fn = tc.get("function") or {}
                tcid = tc.get("id")
                nm = str(fn.get("name") or "")
                pa._append_message(
                    session,
                    conv.id,
                    "tool",
                    "等待用户确认" if nm == confirm_name else "同轮其他调用已挂起",
                    actions=[
                        {
                            "type": "confirm_pending",
                            "tool_call_id": tcid,
                            "name": nm,
                            "bot_id": bot.id,
                            "veto_window": veto_window_applies(confirm_reason, bot.trust_level),
                            "veto_window_min": bot.veto_window_min if veto_window_applies(confirm_reason, bot.trust_level) else None,
                        }
                    ],
                    bot_id=bot.id,
                )
            actions = [
                {
                    "type": "confirm_required",
                    "tool": confirm_name,
                    "args": confirm_args,
                    "message": confirm_text,
                    "bot_id": bot.id,
                    "veto_window": veto_window_applies(confirm_reason, bot.trust_level),
                    "veto_window_min": bot.veto_window_min,
                    "editable": True,
                }
            ]
            pa._append_message(
                session, conv.id, "assistant", confirm_text, actions=actions, bot_id=bot.id, final_reply=True
            )
            await emit_and_log(
                "confirm",
                {
                    "message": confirm_text,
                    "tool": confirm_name,
                    "args": confirm_args,
                    "botId": bot.id,
                    "vetoWindow": veto_window_applies(confirm_reason, bot.trust_level),
                    "vetoWindowMin": bot.veto_window_min,
                    "editable": True,
                },
            )
            return confirm_text

        # 执行工具
        for tc in tool_calls:
            fn = tc.get("function") or {}
            name = str(fn.get("name") or "")
            tcid = str(tc.get("id") or "")
            parse_err = None
            try:
                args = pa._parse_tool_args(tc)
                if not isinstance(args, dict):
                    parse_err = "arguments 必须是 JSON 对象"
                    args = {}
            except Exception as exc:  # noqa: BLE001
                parse_err = f"invalid_args_json: {exc}"
                args = {}
            await emit_and_log("tool_call", {"tool": name, "args": args, "botId": bot.id})
            if parse_err:
                text, detail = (
                    f"工具参数不是合法 JSON：{parse_err}。请重发合法 JSON 对象。",
                    {"tool": name, "error": "invalid_args_json"},
                )
                err_code = "invalid_args_json"
            elif args.get("__blocked"):
                text, detail = str(args["__blocked"]), {"tool": name, "blocked": True}
                err_code = "blocked"
            else:
                # 自动加载目录内工具
                if name in pa._TOOL_INDEX:
                    loaded_extra.add(name)
                check_owner(session, conv.id)
                bot_result = await execute_bot_tool(name, args, session, conv, bot)
                if bot_result is not None:
                    text, detail = bot_result
                else:
                    check_owner(session, conv.id)
                    text, detail = await pa._execute_supervisor_tool(name, args, session, conv)
                pa._audit_safe(session, conv, name, args, text, detail, bot=bot)
                if name in {"tool_search", "search_tools"}:
                    for n in detail.get("load") or []:
                        loaded_extra.add(str(n))
                err_code = "unknown_tool" if str(text).startswith("未知工具") else ""

            if err_code:
                sig = f"{name}|{err_code}"
                if sig == error_sig:
                    error_sig_hits += 1
                else:
                    error_sig, error_sig_hits = sig, 1
                if error_sig_hits >= 3:
                    await emit_and_log("error", {"message": f"熔断：{sig}", "botId": bot.id})
                    return f"工具调用熔断（{sig}），请换指令后重试。"
            else:
                error_sig, error_sig_hits = "", 0

            pa._append_message(
                session,
                conv.id,
                "tool",
                text,
                actions=[{"tool_call_id": tcid, "name": name, "detail": detail}],
                bot_id=bot.id,
            )
            await emit_and_log("tool_result", {"tool": name, "detail": detail, "botId": bot.id})
            if name == "restate_intent" and detail.get("needs_confirm"):
                await emit_and_log(
                    "restate",
                    {"message": text, "restate": detail.get("restate"), "botId": bot.id, "editable": False},
                )
            if name == "plan":
                await emit_and_log("plan", detail)

        # 继续下一轮推理
        continue

    reply = "已达最大步数，请继续发消息。"
    pa._append_message(session, conv.id, "assistant", reply, bot_id=bot.id, final_reply=True)
    await emit_and_log("done", {"reply": reply, "conversationId": conv.id, "botId": bot.id})
    return reply
