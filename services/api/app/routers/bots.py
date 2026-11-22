"""AI 同事 API：Bot / Team / Skill / Template。"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from ..bot_registry import (
    CHIEF_BOT_ID,
    create_bot,
    delete_bot,
    export_bot,
    get_bot,
    import_from_template,
    interview_to_draft,
    list_bots,
    list_templates,
    patch_bot,
    private_memory_files,
    seed_system_bots,
)
from ..agent_colleagues import agent_id_from_bot_id, bot_id_aliases, canonical_members, is_agent_colleague_id
from ..knowledge_colleague import bot_owner_ids, owns_bot
from ..seed import DEMO_USER
from ..db import get_session
from ..models import Bot, BotSkill, BotTeam, MemoryFile, ScheduledTask, UsageEvent, utcnow
from ..pricing import build_pricing_map, cost_for_model
from ..schemas import (
    BotCreateIn,
    BotImportIn,
    BotInterviewIn,
    BotOut,
    BotPatchIn,
    BotSkillCreateIn,
    BotSkillOut,
    BotTeamCreateIn,
    BotTeamOut,
    BotTeamPatchIn,
    BotTemplateOut,
)

router = APIRouter(prefix="/bots", tags=["bots"])


def _bot_out(b: Bot) -> BotOut:
    return BotOut.model_validate(b, from_attributes=True)


def _skill_out(s: BotSkill) -> BotSkillOut:
    return BotSkillOut.model_validate(s, from_attributes=True).model_copy(update={"bot_id": agent_id_from_bot_id(s.bot_id)})


def _team_out(t: BotTeam) -> BotTeamOut:
    return BotTeamOut.model_validate(t, from_attributes=True).model_copy(update={
        "member_bot_ids": canonical_members(t.member_bot_ids),
        "lead_bot_id": agent_id_from_bot_id(t.lead_bot_id),
    })


def _interview_questions() -> list[dict[str, Any]]:
    return [
        {"key": "role", "prompt": "这个同事主要负责什么工作？", "type": "text"},
        {"key": "duties", "prompt": "具体要做的 2–3 件事？", "type": "text"},
        {"key": "never_do", "prompt": "绝对不能做的事？", "type": "text"},
        {"key": "tone", "prompt": "希望它用什么语气说话？", "type": "text"},
        {"key": "name", "prompt": "起个有趣的名字（可选）？", "type": "text"},
        {"key": "trust_level", "prompt": "初始信任等级 0–3？", "type": "number", "default": 1},
    ]


@router.get("", response_model=list[BotOut])
def api_list_bots(
    include_archived: bool = False,
    session: Session = Depends(get_session),
) -> list[BotOut]:
    seed_system_bots(session)
    return [_bot_out(b) for b in list_bots(session, include_archived=include_archived) if owns_bot(b, DEMO_USER)]


@router.post("", response_model=BotOut)
def api_create_bot(body: BotCreateIn, session: Session = Depends(get_session)) -> BotOut:
    data = body.model_dump()
    bot = create_bot(session, data, owner_user_id=DEMO_USER)
    return _bot_out(bot)


@router.get("/interview/questions")
def api_interview_questions() -> dict[str, Any]:
    return {"questions": _interview_questions()}


@router.get("/templates", response_model=list[BotTemplateOut])
def api_list_templates() -> list[BotTemplateOut]:
    return [BotTemplateOut(**t) for t in list_templates()]


@router.post("/import", response_model=dict[str, Any])
def api_import_template(body: BotImportIn, session: Session = Depends(get_session)) -> dict[str, Any]:
    try:
        obj = import_from_template(
            session,
            template_id=body.template_id,
            payload=body.payload,
            name_override=body.name_override,
            owner_user_id=DEMO_USER,
        )
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    if isinstance(obj, BotTeam):
        return {"kind": "team", "team": _team_out(obj).model_dump()}
    return {"kind": "bot", "bot": _bot_out(obj).model_dump()}


@router.get("/roster")
def api_roster(
    format: str | None = Query(default=None),
    team: str | None = Query(default=None),
    project_id: str | None = None,
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """现有 agents 花名册（按 team 分组），含白话职责与上下游。"""
    from ..agent_colleagues import roster

    from ..knowledge_colleague import catalog
    return roster(format_filter=format, team_filter=team, agents=catalog(session, project_id, DEMO_USER, directory=True))


@router.get("/squads")
def api_squads() -> dict[str, Any]:
    """编组预设：体裁工作流 + 按 team。"""
    from ..agent_colleagues import squads

    return {"squads": squads()}


@router.post("/coverage")
def api_coverage(body: dict[str, Any]) -> dict[str, Any]:
    """编组覆盖 / 缺口报告。"""
    from ..agent_colleagues import coverage_report

    members = list(body.get("memberBotIds") or body.get("member_bot_ids") or [])
    fmt = body.get("format")
    return coverage_report(members, format=fmt)


@router.get("/teams", response_model=list[BotTeamOut])
def api_list_teams(session: Session = Depends(get_session)) -> list[BotTeamOut]:
    rows = list(session.exec(select(BotTeam).where(BotTeam.owner_user_id.in_(bot_owner_ids(DEMO_USER)))))
    rows.sort(key=lambda t: t.name)
    return [_team_out(t) for t in rows]


def _validate_team_members(session: Session, member_ids: list[str]) -> None:
    missing: list[str] = []
    for mid in member_ids:
        member = get_bot(session, mid)
        if not owns_bot(member, DEMO_USER) or member.status != "active":
            missing.append(mid)
    if missing:
        raise HTTPException(400, f"成员不存在：{', '.join(missing[:8])}")


@router.post("/teams", response_model=BotTeamOut)
def api_create_team(body: BotTeamCreateIn, session: Session = Depends(get_session)) -> BotTeamOut:
    data = body.model_dump()
    members = list(data.get("member_bot_ids") or [])
    # 总编默认带上，便于 pipeline 统筹
    if data.get("speak_policy") == "pipeline" and "chief" not in members:
        members = ["chief", *members]
        data["member_bot_ids"] = members
        if not data.get("lead_bot_id"):
            data["lead_bot_id"] = "chief"
    data["member_bot_ids"] = canonical_members(members)
    data["lead_bot_id"] = agent_id_from_bot_id(data.get("lead_bot_id"))
    _validate_team_members(session, members)
    if data["lead_bot_id"]:
        _validate_team_members(session, [data["lead_bot_id"]])
    team = BotTeam(owner_user_id=DEMO_USER, **data)
    session.add(team)
    session.commit()
    session.refresh(team)
    return _team_out(team)


@router.get("/teams/{team_id}", response_model=BotTeamOut)
def api_get_team(team_id: str, session: Session = Depends(get_session)) -> BotTeamOut:
    team = session.get(BotTeam, team_id)
    if not team or team.owner_user_id not in bot_owner_ids(DEMO_USER):
        raise HTTPException(404, "team not found")
    return _team_out(team)


@router.patch("/teams/{team_id}", response_model=BotTeamOut)
def api_patch_team(
    team_id: str, body: BotTeamPatchIn, session: Session = Depends(get_session)
) -> BotTeamOut:
    team = session.get(BotTeam, team_id)
    if not team or team.owner_user_id not in bot_owner_ids(DEMO_USER):
        raise HTTPException(404, "team not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        if k == "member_bot_ids":
            v = canonical_members(v)
            _validate_team_members(session, v)
        elif k == "lead_bot_id":
            v = agent_id_from_bot_id(v)
            if v:
                _validate_team_members(session, [v])
        setattr(team, k, v)
    team.updated_at = utcnow()
    session.add(team)
    session.commit()
    session.refresh(team)
    return _team_out(team)


@router.delete("/teams/{team_id}")
def api_delete_team(team_id: str, session: Session = Depends(get_session)) -> dict[str, Any]:
    team = session.get(BotTeam, team_id)
    if not team or team.owner_user_id not in bot_owner_ids(DEMO_USER):
        raise HTTPException(404, "team not found")
    session.delete(team)
    session.commit()
    return {"ok": True}


@router.get("/{bot_id}", response_model=BotOut)
def api_get_bot(bot_id: str, session: Session = Depends(get_session)) -> BotOut:
    seed_system_bots(session)
    bot = get_bot(session, bot_id)
    if not owns_bot(bot, DEMO_USER):
        raise HTTPException(404, "bot not found")
    return _bot_out(bot)


@router.patch("/{bot_id}", response_model=BotOut)
def api_patch_bot(
    bot_id: str, body: BotPatchIn, session: Session = Depends(get_session)
) -> BotOut:

    if is_agent_colleague_id(bot_id):
        raise HTTPException(400, "目录同事不可直接修改；如需定制请走「高级 → 自定义同事」")
    bot = get_bot(session, bot_id)
    if not owns_bot(bot, DEMO_USER):
        raise HTTPException(404, "bot not found")
    try:
        bot = patch_bot(session, bot, body.model_dump(exclude_unset=True))
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    return _bot_out(bot)


@router.delete("/{bot_id}")
def api_delete_bot(bot_id: str, session: Session = Depends(get_session)) -> dict[str, Any]:

    if is_agent_colleague_id(bot_id):
        raise HTTPException(400, "目录同事不可删除")
    bot = get_bot(session, bot_id)
    if not owns_bot(bot, DEMO_USER):
        raise HTTPException(404, "bot not found")
    try:
        delete_bot(session, bot)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    return {"ok": True, "status": "archived"}


@router.post("/{bot_id}/pin", response_model=BotOut)
def api_pin_bot(
    bot_id: str,
    pinned: bool = True,
    session: Session = Depends(get_session),
) -> BotOut:

    if is_agent_colleague_id(bot_id):
        raise HTTPException(400, "目录同事暂不支持置顶落库；可在左侧花名册按组浏览")
    bot = get_bot(session, bot_id)
    if not owns_bot(bot, DEMO_USER):
        raise HTTPException(404, "bot not found")
    bot = patch_bot(session, bot, {"pinned": pinned})
    return _bot_out(bot)


@router.get("/{bot_id}/memories")
def api_bot_memories(bot_id: str, session: Session = Depends(get_session), project_id: str | None = None) -> dict[str, Any]:
    bot = get_bot(session, bot_id)
    if not owns_bot(bot, DEMO_USER):
        raise HTTPException(404, "bot not found")
    rows = private_memory_files(session, bot.id, DEMO_USER, project_id)
    return {
        "botId": bot.id,
        "files": [
            {"path": r.path, "content": r.content or "", "hash": r.hash, "updatedAt": r.updated_at}
            for r in rows
        ],
    }


@router.get("/{bot_id}/skills", response_model=list[BotSkillOut])
def api_bot_skills(bot_id: str, session: Session = Depends(get_session)) -> list[BotSkillOut]:
    if not owns_bot(get_bot(session, bot_id), DEMO_USER):
        raise HTTPException(404, "bot not found")
    rows = list(
        session.exec(
            select(BotSkill).where((BotSkill.bot_id.in_(bot_id_aliases(bot_id))) | (BotSkill.bot_id == None))  # noqa: E711
        )
    )
    return [_skill_out(r) for r in rows]


@router.post("/{bot_id}/skills", response_model=BotSkillOut)
def api_create_skill(
    bot_id: str, body: BotSkillCreateIn, session: Session = Depends(get_session)
) -> BotSkillOut:
    bot = get_bot(session, bot_id)
    if not owns_bot(bot, DEMO_USER):
        raise HTTPException(404, "bot not found")
    slash = (body.slash or body.name).lower().replace(" ", "-")
    skill = BotSkill(
        bot_id=bot.id,
        name=body.name,
        slash=slash,
        when_to_use=body.when_to_use,
        inputs=body.inputs,
        steps_md=body.steps_md,
        evidence_required=body.evidence_required,
        confirm_when=body.confirm_when,
        source_conversation_id=body.source_conversation_id,
        trust_stage="saved",
    )
    session.add(skill)
    session.commit()
    session.refresh(skill)
    return _skill_out(skill)


@router.get("/{bot_id}/routines")
def api_bot_routines(bot_id: str, session: Session = Depends(get_session)) -> list[dict[str, Any]]:
    if not owns_bot(get_bot(session, bot_id), DEMO_USER):
        raise HTTPException(404, "bot not found")
    rows = list(session.exec(select(ScheduledTask).where(ScheduledTask.bot_id.in_(bot_id_aliases(bot_id)))))
    return [
        {
            "id": r.id,
            "name": r.name,
            "cronOrInterval": r.cron_or_interval,
            "enabled": r.enabled,
            "prompt": r.prompt,
            "triggerType": r.trigger_type,
            "quietPolicy": r.quiet_policy,
            "runCount": r.run_count,
            "lastCostTokens": r.last_cost_tokens,
            "activeWindow": r.active_window,
            "eventFilter": r.event_filter,
            "description": r.description,
        }
        for r in rows
    ]


@router.get("/{bot_id}/usage")
def api_bot_usage(
    bot_id: str,
    days: int = Query(7, ge=1, le=90),
    session: Session = Depends(get_session),
    project_id: str | None = None,
) -> dict[str, Any]:
    bot = get_bot(session, bot_id)
    if not owns_bot(bot, DEMO_USER):
        raise HTTPException(404, "bot not found")
    from ..usage_attribution import usage_actor
    from datetime import timedelta

    query = select(UsageEvent).where(
        UsageEvent.user_id == DEMO_USER, UsageEvent.created_at >= utcnow() - timedelta(days=days)
    )
    if project_id:
        query = query.where(UsageEvent.project_id == project_id)
    rows = [event for event in session.exec(query) if usage_actor(session, event)[1] == bot.id]
    pricing_map = build_pricing_map(session)
    prompt = sum(r.prompt_tokens for r in rows)
    completion = sum(r.completion_tokens for r in rows)
    cost = sum(
        (
            cost_for_model(
                session,
                pricing_map,
                r.model,
                r.prompt_tokens,
                r.completion_tokens,
                r.cache_hit_tokens or 0,
                r.cache_miss_tokens or 0,
            )
            or 0.0
        )
        for r in rows
    )
    budget = bot.weekly_token_budget
    used = prompt + completion
    return {
        "botId": bot.id,
        "days": days,
        "promptTokens": prompt,
        "completionTokens": completion,
        "totalTokens": used,
        "costEst": cost,
        "weeklyTokenBudget": budget,
        "budgetRatio": (used / budget) if budget else None,
        "events": len(rows),
    }


@router.post("/{bot_id}/interview")
def api_interview(
    bot_id: str, body: BotInterviewIn, session: Session = Depends(get_session)
) -> dict[str, Any]:
    """入职访谈：若 bot_id=new 则只返回草案；否则可应用到现有 Bot。"""
    draft = interview_to_draft(body.answers, body.free_text)
    if bot_id in {"new", "_new", "draft"}:
        return {"draft": draft, "questions": _interview_questions()}
    bot = get_bot(session, bot_id)
    if not owns_bot(bot, DEMO_USER):
        raise HTTPException(404, "bot not found")
    if bot.is_system and bot.id == CHIEF_BOT_ID:
        # 允许微调人设，但不改 role
        draft.pop("role_kind", None)
        draft.pop("is_system", None)
    if is_agent_colleague_id(bot.id):
        raise HTTPException(403, "内置同事不可编辑")
    bot = patch_bot(session, bot, draft)
    return {"bot": _bot_out(bot).model_dump(), "draft": draft}


@router.get("/{bot_id}/export")
def api_export_bot(bot_id: str, session: Session = Depends(get_session)) -> dict[str, Any]:
    bot = get_bot(session, bot_id)
    if not owns_bot(bot, DEMO_USER):
        raise HTTPException(404, "bot not found")
    return export_bot(session, bot)
