"""多 Bot 群聊：@提及、发言策略、工作流接力、交接单。"""

from __future__ import annotations

from .feishu_outbox import staged_reply

import logging
from typing import Any, Awaitable, Callable

from sqlmodel import Session, select

from .agent_colleagues import canonical_members, load_stage_graphs
from fastapi import HTTPException
from .knowledge_colleague import colleague, team_members, owns_bot
from .bot_registry import CHIEF_BOT_ID, get_bot, list_bots, resolve_mentions, seed_system_bots
from .bot_runtime import run_bot_turn
from .models import Bot, Conversation, Message

logger = logging.getLogger(__name__)

EmitFn = Callable[[str, dict[str, Any]], Awaitable[None]]
DEFAULT_MAX_ROUNDS = 6


def _member_bots(session: Session, conv: Conversation) -> list[Bot]:
    ids = list(getattr(conv, "member_bot_ids", None) or [])
    if conv.team_id:
        team = team_members(session, conv.team_id, conv.user_id)
        ids = ids or list(team.member_bot_ids or [])
    bots: list[Bot] = []
    for bid in canonical_members(ids):
        b = colleague(session, bid, conv.user_id, conv.project_id)
        if b and b.status == "active":
            bots.append(b)
    if not bots and not ids and _speak_policy(session, conv) != "pipeline" and not (conv.group_rules or {}).get("pipeline_execution"):
        bots = [b for b in list_bots(session) if b.status == "active" and owns_bot(b, conv.user_id) and not (b.execution or {}).get("enabled")]
    return bots


def _speak_policy(session: Session, conv: Conversation) -> str:
    rules = getattr(conv, "group_rules", None) or {}
    if isinstance(rules, dict) and (rules.get("speak_policy") or rules.get("speakPolicy")):
        return str(rules.get("speak_policy") or rules["speakPolicy"])
    if getattr(conv, "team_id", None):
        from .models import BotTeam

        team = session.get(BotTeam, conv.team_id)
        if team and team.speak_policy:
            return team.speak_policy
    return "orchestrated"


def is_preset_pipeline(session: Session, conv: Conversation) -> bool:
    rules = conv.group_rules or {}
    configured = any(rules.get(key) for key in ("format", "workflow_format", "stages"))
    return conv.kind == "group" and (
        bool(rules.get("pipeline_execution")) or (configured and _speak_policy(session, conv) == "pipeline")
    )


def _max_rounds(session: Session, conv: Conversation) -> int:
    rules = getattr(conv, "group_rules", None) or {}
    if isinstance(rules, dict) and (rules.get("max_rounds") or rules.get("maxRounds")):
        try:
            return max(1, min(12, int(rules.get("max_rounds") or rules["maxRounds"])))
        except Exception:  # noqa: BLE001
            pass
    if getattr(conv, "team_id", None):
        from .models import BotTeam

        team = session.get(BotTeam, conv.team_id)
        if team and team.max_rounds:
            return int(team.max_rounds)
    return DEFAULT_MAX_ROUNDS


def _lead_bot_id(session: Session, conv: Conversation, members: list[Bot]) -> str:
    rules = getattr(conv, "group_rules", None) or {}
    if isinstance(rules, dict) and rules.get("lead_bot_id"):
        return str(rules["lead_bot_id"])
    if getattr(conv, "team_id", None):
        from .models import BotTeam

        team = session.get(BotTeam, conv.team_id)
        if team and team.lead_bot_id:
            return team.lead_bot_id
    for b in members:
        if b.role_kind in {"chief", "lead"} or b.id == CHIEF_BOT_ID:
            return b.id
    return members[0].id if members else CHIEF_BOT_ID


def _extract_user_text(claimed_events: list | None) -> str:
    if not claimed_events:
        return ""
    parts = []
    for e in claimed_events:
        msg = str((getattr(e, "payload", None) or {}).get("message") or "")
        if msg:
            parts.append(msg)
    return "\n".join(parts)


def _pipeline_stages(conv: Conversation) -> list[dict[str, Any]]:
    rules = getattr(conv, "group_rules", None) or {}
    if isinstance(rules, dict) and rules.get("stages"):
        return rules["stages"] if isinstance(rules["stages"], list) else []
    fmt = None
    if isinstance(rules, dict):
        fmt = rules.get("format") or rules.get("workflow_format")
    if not fmt:
        return []
    graphs = load_stage_graphs()
    stages = graphs.get(str(fmt)) or []
    out: list[dict[str, Any]] = []
    for st in stages:
        aids = [str(x) for x in (st.get("agentIds") or [])]
        out.append(
            {
                "id": st.get("id"),
                "name": st.get("name") or st.get("id"),
                "requiresUserAck": bool(st.get("requiresUserAck")),
                "mode": st.get("mode") or "ordered",
                "next": list(st.get("next") or []),
                "agentIds": aids,
                "memberBotIds": canonical_members(aids),
            }
        )
    return out


def _build_handoff(
    *,
    from_bot: Bot | None,
    to_bot: Bot,
    stage: dict[str, Any] | None,
    instruction: str,
    context: str,
) -> dict[str, Any]:
    return {
        "type": "handoff",
        "fromBotId": from_bot.id if from_bot else None,
        "fromBotName": from_bot.name if from_bot else "主人",
        "toBotId": to_bot.id,
        "toBotName": to_bot.name,
        "stageId": (stage or {}).get("id"),
        "stageName": (stage or {}).get("name"),
        "instruction": instruction[:500],
        "context": context[:1200],
        "scope": {
            "allowedAgentIds": list(to_bot.allowed_agent_ids or []),
            "toolAllowlist": list(to_bot.tool_allowlist or [])[:20],
        },
        "requiresUserAck": bool((stage or {}).get("requiresUserAck")),
    }


def _append_handoff_message(
    session: Session,
    conv: Conversation,
    handoff: dict[str, Any],
) -> None:
    from .routers.personal_agent import _append_message

    summary = (
        f"交接：{handoff.get('fromBotName')} → {handoff.get('toBotName')}"
        + (f"（阶段 {handoff.get('stageName')}）" if handoff.get("stageName") else "")
    )
    _append_message(
        session,
        conv.id,
        "assistant",
        summary,
        bot_id=handoff.get("fromBotId"),
        evidence=[handoff],
        actions=[{"type": "handoff", "toBotId": handoff.get("toBotId")}],
    )


async def _run_pipeline(
    session: Session,
    conv: Conversation,
    members: list[Bot],
    emit: EmitFn,
    *,
    claimed_events: list | None,
    user_text: str,
    max_rounds: int,
) -> str | None:
    """总编统筹 + 按工作流阶段依次接力；requiresUserAck 阶段暂停。"""
    stages = _pipeline_stages(conv)

    lead_id = _lead_bot_id(session, conv, members)
    lead = next((b for b in members if b.id == lead_id), members[0] if members else None)

    spoken = 0
    last_reply: str | None = None
    prev_bot: Bot | None = lead

    # 若无阶段定义：按成员顺序（去掉 lead）接力
    if members and not stages and not is_preset_pipeline(session, conv):
        queue = [b for b in members if b.id != (lead.id if lead else None)]
        if lead:
            queue = [lead] + queue
        for bot in queue[:max_rounds]:
            handoff = _build_handoff(
                from_bot=prev_bot if prev_bot and prev_bot.id != bot.id else None,
                to_bot=bot,
                stage=None,
                instruction=user_text or "请按职责推进",
                context=last_reply or user_text,
            )
            if prev_bot and prev_bot.id != bot.id:
                _append_handoff_message(session, conv, handoff)
                await emit("handoff", {"handoff": handoff, "conversationId": conv.id})

            replies: list[str] = []

            async def _emit(event: str, data: dict[str, Any], _bot=bot) -> None:
                data = {**data, "botId": _bot.id, "botName": _bot.name}
                if event == "done" and data.get("reply"):
                    replies.append(str(data["reply"]))
                await emit(event, data)

            events = claimed_events
            reply = await run_bot_turn(
                session,
                conv,
                bot,
                _emit,
                claimed_events=events,
                skip_inbox=(spoken > 0),
            )
            spoken += 1
            if reply:
                last_reply = reply
            prev_bot = bot
            latest = staged_reply(session, conv.id) or session.exec(
                select(Message)
                .where(Message.conversation_id == conv.id, Message.role == "assistant")
                .order_by(Message.created_at.desc())
            ).first()
            if latest and latest.actions:
                types = {a.get("type") for a in latest.actions}
                if "halt" in types or "confirm_required" in types:
                    break
        await emit("done", {"reply": last_reply or "", "conversationId": conv.id, "group": True})
        return last_reply

    from .pipeline_checkpoint import advance_pipeline
    return await advance_pipeline(session, conv, stages, members, emit, user_text, max_rounds, claimed_events)


async def run_group_turn(
    session: Session,
    conv: Conversation,
    emit: EmitFn,
    *,
    claimed_events: list | None = None,
) -> str | None:
    """处理一则群聊用户消息：按 @ / 策略让 Bot 依次发言，并处理接力。"""
    try:
        seed_system_bots(session)
    except Exception:  # noqa: BLE001
        pass

    from .knowledge_colleague import validate_knowledge_delivery
    validate_knowledge_delivery(session, conv, [ev.payload for ev in claimed_events or []])
    members = _member_bots(session, conv)
    preset = is_preset_pipeline(session, conv)
    if not members and not preset:
        await emit("done", {"reply": "群聊还没有成员。", "conversationId": conv.id})
        return "群聊还没有成员。"

    if preset and claimed_events:
        accepted = []
        for event in claimed_events:
            payload = event.payload or {}
            event_project = payload.get("project_id") or payload.get("projectId")
            current = (conv.group_rules or {}).get("pipeline_execution") or {}
            execution = payload.get("executionId")
            scoped = event_project == conv.project_id if event_project else bool(execution and execution == current.get("executionId"))
            if not scoped or (execution and execution != current.get("executionId")):
                session.add(Message(conversation_id=conv.id, role="system", content="事件项目与编组绑定不符，已拒绝。",
                                    evidence=[{"eventId": event.id}]))
            else:
                accepted.append(event)
        session.commit()
        if not accepted:
            await emit("done", {"conversationId": conv.id, "reply": "事件项目与编组绑定不符。"})
            return "事件项目与编组绑定不符。"
        claimed_events = accepted
    user_text = _extract_user_text(claimed_events)
    mention_ids: list[str] = []
    for e in claimed_events or []:
        payload = getattr(e, "payload", None) or {}
        for mid in payload.get("mention_bot_ids") or []:
            if mid not in mention_ids:
                mention_ids.append(str(mid))
    if not mention_ids:
        mention_ids = resolve_mentions(user_text, members)

    policy = _speak_policy(session, conv)
    max_rounds = _max_rounds(session, conv)

    # A preset owns its member dispatches. An @mention in the creative brief
    # must not bypass the persisted order, gates, or project binding.
    if preset or (policy == "pipeline" and not mention_ids):
        return await _run_pipeline(
            session,
            conv,
            members,
            emit,
            claimed_events=claimed_events,
            user_text=user_text,
            max_rounds=max_rounds,
        )

    if mention_ids:
        queue = [bid for bid in mention_ids if any(b.id == bid for b in members) or colleague(session, bid, conv.user_id, conv.project_id)]
    elif policy == "mention_only":
        await emit(
            "done",
            {
                "reply": "当前群聊为 mention_only：请 @ 某位同事。",
                "conversationId": conv.id,
            },
        )
        return "当前群聊为 mention_only：请 @ 某位同事。"
    elif policy == "free":
        queue = [b.id for b in members]
    else:
        queue = [_lead_bot_id(session, conv, members)]

    spoken = 0
    last_reply: str | None = None
    seen_in_wave: set[str] = set()
    prev_bot: Bot | None = None

    while queue and spoken < max_rounds:
        bot_id = queue.pop(0)
        if bot_id in seen_in_wave and policy != "free":
            continue
        seen_in_wave.add(bot_id)
        bot = colleague(session, bot_id, conv.user_id, conv.project_id)
        if not bot or bot.status != "active":
            continue

        if prev_bot and prev_bot.id != bot.id:
            handoff = _build_handoff(
                from_bot=prev_bot,
                to_bot=bot,
                stage=None,
                instruction=user_text or "请接力",
                context=last_reply or user_text,
            )
            _append_handoff_message(session, conv, handoff)
            await emit("handoff", {"handoff": handoff, "conversationId": conv.id})

        async def _emit(event: str, data: dict[str, Any], _bot=bot) -> None:
            data = {**data, "botId": _bot.id, "botName": _bot.name}
            await emit(event, data)

        events = claimed_events
        reply = await run_bot_turn(
            session,
            conv,
            bot,
            _emit,
            claimed_events=events,
            skip_inbox=(spoken > 0),
        )
        spoken += 1
        if reply:
            last_reply = reply
        prev_bot = bot

        latest = staged_reply(session, conv.id) or session.exec(
            select(Message)
            .where(Message.conversation_id == conv.id, Message.role == "assistant")
            .order_by(Message.created_at.desc())
        ).first()
        if latest and latest.content:
            next_ids = resolve_mentions(latest.content, members)
            for nid in next_ids:
                if nid != bot_id and nid not in queue:
                    queue.append(nid)
                    seen_in_wave.discard(nid)

        if latest and latest.actions:
            types = {a.get("type") for a in latest.actions}
            if "halt" in types or "confirm_required" in types:
                break

    await emit("done", {"reply": last_reply or "", "conversationId": conv.id, "group": True})
    return last_reply
