"""Bot 信任分级与不可逆操作审批策略。"""

from __future__ import annotations

from typing import Any

# 0=只读 1=只能提方案 2=可执行可逆 3=岗位+否决窗口
TRUST_READONLY = 0
TRUST_PROPOSE = 1
TRUST_REVERSIBLE = 2
TRUST_OWN_ROLE = 3

# 不可逆 / 高风险工具（执行前需审批，除非信任等级足够且否决窗口生效）
IRREVERSIBLE_TOOLS = frozenset(
    {
        "adopt_artifact",
        "start_studio_batch",
        "create_fleet",
        "start_async_task",
        "schedule_task",
        "routine_create",
        "bot_create",
        "bot_update",
        "delegate_to_bot",
        "halt_pipeline",
    }
)

# 正文类 agent 前缀：写产物需确认
PROSE_AGENT_PREFIXES = ("prose.", "orch.batch", "qc.bible_guard")

# 只读工具（信任 0 也可用）
READONLY_TOOLS = frozenset(
    {
        "search_tools",
        "search_agents",
        "search_knowledge",
        "list_projects",
        "get_project",
        "list_artifacts",
        "read_artifact",
        "list_artifact_versions",
        "list_agents",
        "get_stage_graph",
        "list_proposals",
        "read_memory",
        "scratchpad",
        "ls",
        "read",
        "grep",
        "find",
        "agent_status",
        "agent_ps",
        "agent_inspect",
        "check_async_task",
        "list_async_tasks",
        "show_memories",
        "catch_up",
        "restate_intent",
        "skill_list",
        "routine_list",
        "bot_list",
        "bot_inspect",
        "navigate",
        "plan",
    }
)


def trust_label(level: int) -> str:
    return {
        0: "只读观察",
        1: "提方案待批",
        2: "可执行可逆操作",
        3: "拥有岗位（否决窗口）",
    }.get(level, f"level-{level}")


def tools_allowed_for_trust(level: int, allowlist: list[str] | None = None) -> set[str] | None:
    """返回允许的工具集合；None 表示不额外限制（由 allowlist 决定）。"""
    if allowlist:
        base = set(allowlist)
    else:
        base = None
    if level <= TRUST_READONLY:
        allowed = set(READONLY_TOOLS)
        return allowed if base is None else allowed & base
    return base


def requires_confirm(
    *,
    tool_name: str,
    trust_level: int,
    args: dict[str, Any] | None = None,
    restate_before_act: bool = False,
) -> tuple[bool, str]:
    """返回 (是否需要确认, 原因)。

    信任 3：不可逆工具走否决窗口（仍发确认卡，但可超时自动放行）。
    信任 0/1：几乎所有写操作都需确认。
    """
    args = args or {}
    if tool_name in ("restate_intent", "catch_up", "show_memories", "learn_correction"):
        return False, ""

    if trust_level <= TRUST_READONLY:
        if tool_name not in READONLY_TOOLS:
            return True, f"信任等级 {trust_level}（只读）：{tool_name} 需审批"
        return False, ""

    if tool_name == "run_agent":
        agent_id = str(args.get("agent_id") or "")
        if any(agent_id.startswith(p) for p in PROSE_AGENT_PREFIXES):
            if trust_level < TRUST_OWN_ROLE:
                return True, f"正文类 Agent {agent_id} 需审批"
        if trust_level <= TRUST_PROPOSE:
            return True, "信任等级 1：执行前需审批"
        return False, ""

    if tool_name == "cowrite" and trust_level < TRUST_REVERSIBLE:
        return True, "共写需审批"

    if tool_name in IRREVERSIBLE_TOOLS:
        if trust_level >= TRUST_OWN_ROLE:
            return True, "veto_window"  # 仍弹卡，但 confirm_autoresponder 可自动放行
        return True, f"不可逆操作 {tool_name} 需审批"

    if trust_level <= TRUST_PROPOSE and tool_name not in READONLY_TOOLS:
        # 提方案模式：写操作需批
        writeish = {
            "write_memory",
            "save_artifact",
            "rollback_artifact",
            "write",
            "edit",
            "approve_proposal",
            "create_project",
            "skill_save",
            "skill_update",
            "routine_update",
            "deliver_result",
            "steer_agent",
            "stop_agent",
            "agent_pause",
            "agent_resume",
            "update_async_task",
            "cancel_async_task",
            "invoke_tool",
            "ask_bot",
            "report_to",
        }
        if tool_name in writeish:
            return True, f"信任等级 1：{tool_name} 需审批"

    return False, ""


def veto_window_applies(confirm_reason: str, trust_level: int) -> bool:
    return trust_level >= TRUST_OWN_ROLE and confirm_reason == "veto_window"
