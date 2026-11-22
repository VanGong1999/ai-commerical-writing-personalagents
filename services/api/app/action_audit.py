"""统一操作审计 + 通知：Personal Agent / eggbot / Bot 代用户操作系统时留痕并通知。

不新建表：复用 ActivityLog（detail.audit=true 标记）。
通知通道复用：任务 SSE（publish_task_event）+ 飞书（announce_text，无凭据时静默）。
"""

from __future__ import annotations

import logging
from datetime import timedelta, timezone
from typing import Any

from sqlmodel import Session, select

from .models import ActivityLog, utcnow
from .queue import publish_task_event

logger = logging.getLogger(__name__)

# 这些 actor 视为「代理人」：替用户做事 → 默认通知用户
PROXY_ACTOR_PREFIXES = ("assistant", "chief", "eggbot", "bot:", "agent:")


def is_proxy_actor(actor: str) -> bool:
    return any((actor or "").startswith(p) for p in PROXY_ACTOR_PREFIXES)


def record_action(
    session: Session,
    *,
    actor: str,
    action: str,
    summary: str,
    target: str = "",
    project_id: str | None = None,
    conversation_id: str | None = None,
    bot_id: str | None = None,
    detail: dict[str, Any] | None = None,
    undo: dict[str, Any] | None = None,
    notify: bool | None = None,
) -> ActivityLog:
    """写一条审计记录；代理人操作默认通知用户（站内 SSE + 飞书）。

    - actor：user / assistant / chief / eggbot / bot:<id> / agent:<id> / system
    - target：被操作对象（run:<id> / memory:<path> / group:<id> / bot:<id> …）
    - undo：可撤销描述（如 {"action":"resume_run","runId":"…"}），供 UI 一键撤销
    """
    on_behalf = is_proxy_actor(actor)
    payload = {
        **(detail or {}),
        "audit": True,
        "target": target,
        "onBehalfOfUser": on_behalf,
        "botId": bot_id,
        "undo": undo,
    }
    row = ActivityLog(
        actor=actor,
        action=action,
        summary=summary,
        project_id=project_id,
        conversation_id=conversation_id,
        detail=payload,
    )
    session.add(row)
    session.commit()
    session.refresh(row)

    do_notify = on_behalf if notify is None else notify
    if do_notify:
        _announce(session, row, undo=undo)
    return row


def _announce(session: Session, row: ActivityLog, *, undo: dict[str, Any] | None = None) -> None:
    """站内（任务 SSE）+ 飞书；任何通道失败都不影响主流程。"""
    d = row.detail or {}
    try:
        publish_task_event(
            {
                "type": "action_audit",
                "auditId": row.id,
                "actor": row.actor,
                "action": row.action,
                "summary": row.summary,
                "target": d.get("target"),
                "projectId": row.project_id,
                "conversationId": row.conversation_id,
                "undo": undo or d.get("undo"),
            }
        )
    except Exception:  # noqa: BLE001
        logger.debug("audit publish skipped", exc_info=True)
    if row.conversation_id:
        try:
            from .feishu_notify import announce_text

            announce_text(
                session,
                f"📝 {row.actor} 已代你操作：{row.summary}",
                conversation_id=row.conversation_id,
            )
        except Exception:  # noqa: BLE001
            logger.debug("audit announce skipped", exc_info=True)


# —— PA / Bot 工具调用的统一审计钩子 ——

_META_TOOLS = frozenset(
    {"tool_search", "tool_invoke", "search_tools", "invoke_tool", "tool_schema_get", "restate_intent", "catch_up", "show_memories", "learn_correction", "plan"}
)

# 「重要」操作：即使 notify_policy=important 也会推送（不可逆 + 生命周期干预）
IMPORTANT_EXTRA = frozenset(
    {"stop_agent", "cancel_async_task", "agent_pause", "agent_resume", "update_async_task", "steer_agent", "write_memory"}
)


def _is_important(name: str) -> bool:
    from .trust_policy import IRREVERSIBLE_TOOLS

    return name in IRREVERSIBLE_TOOLS or name in (IMPORTANT_EXTRA - {"write_memory"})


def tool_requires_audit(name: str) -> bool:
    from .trust_policy import READONLY_TOOLS

    return name not in READONLY_TOOLS and name not in _META_TOOLS


def should_notify(notify_policy: str, name: str) -> bool:
    if notify_policy == "none":
        return False
    if notify_policy == "all":
        return True
    return _is_important(name)


def audit_tool_call(
    session: Session,
    *,
    name: str,
    args: dict[str, Any],
    text: str,
    detail: dict[str, Any],
    conversation_id: str | None,
    project_id: str | None = None,
    bot: Any | None = None,
) -> ActivityLog | None:
    """代主人执行了一个写类工具 → 审计留痕（并按 Bot.notify_policy 通知）。

    复用 ActivityLog：若该工具刚在同会话里自己写过一条 ActivityLog（15s 内），
    则把审计字段合并进去，避免出现两条重复记录。
    """
    if not tool_requires_audit(name):
        return None
    if str(text).startswith(("未知工具", "工具参数")) or (detail or {}).get("error"):
        return None
    actor = f"bot:{bot.id}" if bot is not None and getattr(bot, "id", None) else "assistant"
    policy = getattr(bot, "notify_policy", None) or "important"
    target = ""
    for key in ("run_id", "task_group_id", "bot_id", "artifact_id", "path"):
        v = (detail or {}).get(key) or (args or {}).get(key)
        if v:
            target = f"{key.split('_')[0]}:{v}"
            break
    summary = f"{name}：{str(text).strip().splitlines()[0][:100] if str(text).strip() else ''}"
    undo = None
    if name in {"agent_pause"} and target.startswith("run:"):
        undo = {"action": "agent_resume", "runId": target[4:]}
    elif name == "agent_resume" and target.startswith("run:"):
        undo = {"action": "agent_pause", "runId": target[4:]}
    notify = should_notify(policy, name)

    recent = None
    if conversation_id:
        cutoff = utcnow() - timedelta(seconds=15)
        rows = session.exec(
            select(ActivityLog)
            .where(ActivityLog.conversation_id == conversation_id, ActivityLog.action == name)
            .order_by(ActivityLog.created_at.desc())
            .limit(3)
        ).all()
        for r in rows:
            ts = r.created_at if r.created_at.tzinfo else r.created_at.replace(tzinfo=timezone.utc)
            if ts >= cutoff and not (r.detail or {}).get("audit"):
                recent = r
                break
    if recent is not None:
        recent.actor = actor if actor != "assistant" else recent.actor
        recent.detail = {
            **(recent.detail or {}),
            "audit": True,
            "target": target,
            "onBehalfOfUser": True,
            "botId": getattr(bot, "id", None),
            "undo": undo,
        }
        session.add(recent)
        session.commit()
        session.refresh(recent)
        if notify:
            _announce(session, recent, undo=undo)
        return recent
    return record_action(
        session,
        actor=actor,
        action=name,
        summary=summary,
        target=target,
        project_id=project_id,
        conversation_id=conversation_id,
        bot_id=getattr(bot, "id", None),
        undo=undo,
        notify=notify,
    )


def list_audit(
    session: Session,
    *,
    project_id: str | None = None,
    actor: str | None = None,
    on_behalf_only: bool = False,
    limit: int = 50,
) -> list[dict[str, Any]]:
    rows = list(session.exec(select(ActivityLog).order_by(ActivityLog.created_at.desc()).limit(500)))
    out: list[dict[str, Any]] = []
    for r in rows:
        d = r.detail or {}
        if not d.get("audit"):
            continue
        if project_id and r.project_id != project_id:
            continue
        if actor and r.actor != actor:
            continue
        if on_behalf_only and not d.get("onBehalfOfUser"):
            continue
        out.append(
            {
                "id": r.id,
                "actor": r.actor,
                "action": r.action,
                "summary": r.summary,
                "target": d.get("target"),
                "onBehalfOfUser": bool(d.get("onBehalfOfUser")),
                "botId": d.get("botId"),
                "undo": d.get("undo"),
                "projectId": r.project_id,
                "conversationId": r.conversation_id,
                "createdAt": r.created_at,
            }
        )
        if len(out) >= limit:
            break
    return out
