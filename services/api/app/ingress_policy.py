"""统一 Ingress Fast Path：确定性规则筛噪音，再决定是否入总编收件箱。"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Literal

PolicyAction = Literal["ignore", "candidate", "must", "control"]

# 群聊未 @ 时的写作触发词（与 feishu/ingress 对齐）
WRITING_TRIGGERS = (
    "帮我写",
    "生成核心梗",
    "写大纲",
    "写正文",
    "去ai味",
    "去 AI 味",
    "缺大纲",
    "缺人设",
    "一键写",
    "扫缺口",
    "提案",
    "@写作",
    "personal agent",
)

_MENTION_RE = re.compile(r"@_user_\d+")
_CONTROL_RE = re.compile(
    r"^/(status|reset|followup|project|help|bots|team)(?:\s+(.*))?$",
    re.IGNORECASE | re.DOTALL,
)
_BOT_AT_RE = re.compile(r"@([^\s@，,。.!！？?：:；;]+)")


@dataclass
class PolicyDecision:
    action: PolicyAction
    text: str = ""
    command: str | None = None
    command_arg: str | None = None
    reason: str = ""
    target_bot_id: str | None = None
    mention_bot_ids: list[str] | None = None


def strip_mentions(text: str) -> str:
    return _MENTION_RE.sub("", text or "").strip()


def parse_control(text: str) -> tuple[str, str] | None:
    m = _CONTROL_RE.match((text or "").strip())
    if not m:
        return None
    return m.group(1).lower(), (m.group(2) or "").strip()


def should_trigger_silent(text: str) -> bool:
    t = (text or "").lower()
    for kw in WRITING_TRIGGERS:
        if kw.lower() in t:
            return True
    return False


def resolve_feishu_bot_targets(text: str) -> tuple[str, list[str]]:
    """解析 @Bot名 / Bot名：，返回 (cleaned_text, bot_ids)。

    依赖 bot_registry；失败时返回原文与空列表。
    """
    try:
        from .bot_registry import list_bots, resolve_mentions
        from .db import engine
        from sqlmodel import Session

        with Session(engine) as session:
            bots = list_bots(session)
            ids = resolve_mentions(text or "", bots)
            cleaned = text or ""
            # 去掉已识别的 @Bot名，保留人类可读正文
            for b in bots:
                for label in [b.name, *(b.aliases or [])]:
                    cleaned = cleaned.replace(f"@{label}", "").replace(f"{label}：", "").replace(f"{label}:", "")
            return cleaned.strip(), ids
    except Exception:  # noqa: BLE001
        return (text or "").strip(), []


def decide(
    *,
    source: str,
    text: str = "",
    chat_type: str = "p2p",
    mentioned: bool = False,
    group_policy: str = "mention",
    is_bot: bool = False,
    candidate_review: bool = False,
) -> PolicyDecision:
    """规则表：source × chat_type × mentioned × 关键词 → ignore|candidate|must|control。"""
    if is_bot:
        return PolicyDecision(action="ignore", reason="bot_sender")

    src = (source or "web").lower()
    cleaned = strip_mentions(text) if src in {"feishu", "web"} else (text or "").strip()
    bot_ids: list[str] = []
    if src == "feishu":
        cleaned, bot_ids = resolve_feishu_bot_targets(cleaned)

    if src in {"timer", "job_done", "routine", "bot_delegate", "bot_reply"}:
        return PolicyDecision(
            action="must",
            text=cleaned,
            reason=f"{src}_must",
            target_bot_id=bot_ids[0] if bot_ids else None,
            mention_bot_ids=bot_ids or None,
        )

    if src == "web":
        if not cleaned:
            return PolicyDecision(action="ignore", reason="empty")
        return PolicyDecision(action="must", text=cleaned, reason="web_user")

    if src == "feishu":
        if not cleaned and not bot_ids:
            return PolicyDecision(action="ignore", reason="empty")
        ctrl = parse_control(cleaned or (text or "").strip())
        if ctrl:
            return PolicyDecision(
                action="control",
                text=cleaned,
                command=ctrl[0],
                command_arg=ctrl[1],
                reason="control_command",
            )
        ct = (chat_type or "p2p").lower()
        if ct in {"p2p", "private", "dm"}:
            return PolicyDecision(
                action="must",
                text=cleaned,
                reason="p2p",
                target_bot_id=bot_ids[0] if bot_ids else None,
                mention_bot_ids=bot_ids or None,
            )
        policy = (group_policy or "mention").lower()
        # @Bot名 也视为触发
        if bot_ids:
            return PolicyDecision(
                action="must",
                text=cleaned,
                reason="group_bot_alias",
                target_bot_id=bot_ids[0],
                mention_bot_ids=bot_ids,
            )
        if policy == "always" or mentioned:
            return PolicyDecision(action="must", text=cleaned, reason="group_allowed")
        if should_trigger_silent(cleaned):
            return PolicyDecision(action="must", text=cleaned, reason="silent_writing_trigger")
        # 群聊未 @：候选；未开 candidate_review 时仍标记 candidate（由调用方入箱或缓冲）
        return PolicyDecision(
            action="candidate" if candidate_review else "ignore",
            text=cleaned,
            reason="group_no_mention" if not candidate_review else "group_candidate",
        )

    if src == "feishu_candidate":
        return PolicyDecision(action="candidate", text=cleaned, reason="explicit_candidate")

    if src == "gap_scan":
        return PolicyDecision(action="must", text=cleaned, reason="gap_scan")

    # 默认：有文本则 must
    if cleaned:
        return PolicyDecision(action="must", text=cleaned, reason="default_must")
    return PolicyDecision(action="ignore", reason="default_empty")


def to_feishu_action(decision: PolicyDecision) -> str:
    """映射到飞书 handler 的 action 名，保持兼容。"""
    if decision.action == "ignore":
        # 旧路径用 silent_buffer 表示群聊未触发
        if decision.reason == "group_no_mention":
            return "silent_buffer"
        return "ignore"
    if decision.action == "candidate":
        return "candidate"
    if decision.action == "control":
        return "control"
    return "process"


def as_dict(decision: PolicyDecision) -> dict[str, Any]:
    return {
        "action": decision.action,
        "text": decision.text,
        "command": decision.command,
        "commandArg": decision.command_arg,
        "reason": decision.reason,
        "targetBotId": decision.target_bot_id,
        "mentionBotIds": decision.mention_bot_ids or [],
    }
