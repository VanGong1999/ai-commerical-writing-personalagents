"""飞书入站过滤：委托统一 ingress_policy，保持原签名兼容。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

# 再导出，供测试/旧代码
from app.ingress_policy import (  # noqa: F401
    WRITING_TRIGGERS as _WRITING_TRIGGERS,
    parse_control,
    should_trigger_silent,
    strip_mentions,
)
from app.ingress_policy import decide as policy_decide
from app.settings import get_settings


@dataclass
class IngressDecision:
    action: str  # ignore | process | control | silent_buffer | candidate
    text: str = ""
    command: str | None = None
    command_arg: str | None = None
    reason: str = ""
    target_bot_id: str | None = None
    mention_bot_ids: list[str] | None = None


def message_mentions_bot(message: Any, bot_open_id: str | None = None) -> bool:
    """检查消息是否 @ 了机器人。"""
    mentions = getattr(message, "mentions", None) or []
    if not mentions:
        content = getattr(message, "content", "") or ""
        if "@_user_" in content:
            return True
        return False
    for m in mentions:
        mid = getattr(m, "id", None)
        open_id = None
        if mid is not None:
            open_id = getattr(mid, "open_id", None) or (mid if isinstance(mid, str) else None)
        key = getattr(m, "key", None) or ""
        name = getattr(m, "name", None) or ""
        if bot_open_id and open_id and open_id == bot_open_id:
            return True
        if not bot_open_id and (open_id or key or name):
            return True
    return False


def is_bot_sender(event: Any) -> bool:
    sender = getattr(event, "sender", None)
    if not sender:
        return False
    st = getattr(sender, "sender_type", None) or ""
    return str(st).lower() in {"app", "bot"}


def decide_ingress(
    *,
    chat_type: str,
    text: str,
    mentioned: bool,
    group_policy: str = "mention",
    is_bot: bool = False,
) -> IngressDecision:
    settings = get_settings()
    d = policy_decide(
        source="feishu",
        text=text,
        chat_type=chat_type,
        mentioned=mentioned,
        group_policy=group_policy,
        is_bot=is_bot,
        candidate_review=bool(getattr(settings, "feishu_candidate_review", False)),
    )
    # 映射到飞书 handler 旧 action 名
    if d.action == "ignore":
        action = "silent_buffer" if d.reason == "group_no_mention" else "ignore"
    elif d.action == "candidate":
        action = "candidate"
    elif d.action == "control":
        action = "control"
    else:
        action = "process"
    return IngressDecision(
        action=action,
        text=d.text,
        command=d.command,
        command_arg=d.command_arg,
        reason=d.reason,
        target_bot_id=getattr(d, "target_bot_id", None),
        mention_bot_ids=list(getattr(d, "mention_bot_ids", None) or []),
    )


def help_text() -> str:
    return (
        "写作漫剧 AI 同事（飞书）\n"
        "• 直接发自然语言指挥写作；可用 @同事名 或「同事名：」指定 Bot\n"
        "• /status — 当前会话与待确认\n"
        "• /reset — 重置本 chat 会话（不清项目记忆）\n"
        "• /project — 查看或绑定项目：/project list | /project <id或标题>\n"
        "• /followup <内容> — 当前任务进行中时排队追加指令\n"
        "• /bots — 列出 AI 同事\n"
        "• /team — 列出多智能体团队\n"
        "• 群聊默认需 @ 我；或说「帮我写…」触发\n"
        "• 关键操作会发确认卡片"
    )
