"""Resolve the executing actor from recorded evidence; never charge a dispatcher."""
from __future__ import annotations

import logging

from sqlalchemy import func, update
from sqlmodel import Session, select

from .agent_colleagues import is_agent_colleague_id, agent_id_from_bot_id, bot_id_for_agent, load_catalog_by_id
from .models import AgentRun, Bot, Project, UsageEvent, utcnow

logger = logging.getLogger(__name__)
DIGEST_EVENT_PREFIX = 'run.digest:'
UNATTRIBUTED = 'unattributed'


def usage_actor(session: Session, event: UsageEvent, runs: dict | None = None) -> tuple[str | None, str]:
    agent_id = event.agent_id
    bot_id = event.bot_id
    if not agent_id and is_agent_colleague_id(bot_id):
        agent_id = agent_id_from_bot_id(bot_id)
    if not agent_id and not bot_id and event.run_id:
        run = runs.get(event.run_id) if runs is not None else session.get(AgentRun, event.run_id)
        agent_id = run.agent_id if run else None
    if agent_id:
        agent_id = agent_id_from_bot_id(agent_id)
        if agent_id in load_catalog_by_id():
            return agent_id, bot_id_for_agent(agent_id)
        from .knowledge_colleague import owns_bot
        if owns_bot(session.get(Bot, agent_id), event.user_id):
            return agent_id, agent_id
        return agent_id, f'system:{agent_id}' 
    return None, bot_id or UNATTRIBUTED


def usage_roster(session: Session) -> dict[str, str]:
    from .bot_registry import SYSTEM_BOTS

    names = {bot_id_for_agent(aid): row['name'] for aid, row in load_catalog_by_id().items()}
    names.update({row['id']: row['name'] for row in SYSTEM_BOTS})
    names.update({row.id: row.name for row in session.exec(select(Bot)) if not is_agent_colleague_id(row.id)})
    names[UNATTRIBUTED] = '未归属（历史记录缺少执行者）'
    return names


def increment_project_tokens(session: Session, project_id: str, delta: int) -> None:
    session.execute(update(Project).where(Project.id == project_id).values(
        token_used=func.coalesce(Project.token_used, 0) + delta, updated_at=utcnow(),
    ))


def record_model_usage(response, *, agent_id: str, session: Session | None = None,
                       project_id: str | None = None, user_id: str | None = None,
                       event_id: str | None = None, run_id: str | None = None,
                       commit: bool = True) -> None:
    """Record one returned model response, including unusable/truncated output.

    Only callers without an existing usage recorder use this function.
    """
    from .personal_agent_output import actual_usage
    from .pricing import build_pricing_map, cost_for_model
    from .settings import get_settings

    if session is None:
        if not commit:
            raise ValueError('Staging model usage requires a caller-owned session')
        from .db import engine
        with Session(engine) as owned_session:
            record_model_usage(response, agent_id=agent_id, session=owned_session,
                               project_id=project_id, user_id=user_id, event_id=event_id, run_id=run_id)
        return
    event = UsageEvent(user_id=user_id or get_settings().demo_user_id,
        project_id=project_id, agent_id=agent_id, run_id=run_id, **actual_usage(response))
    if event_id is not None:
        event.id = event_id
    event.agent_id, event.bot_id = usage_actor(session, event)
    cost = cost_for_model(session, build_pricing_map(session), event.model,
                          event.prompt_tokens, event.completion_tokens,
                          event.cache_hit_tokens, event.cache_miss_tokens)
    if cost is None:
        logger.warning("Missing model price for usage event %s model=%s", event.id, event.model)
    else:
        event.cost_est = cost
    session.add(event)
    if project_id:
        increment_project_tokens(session, project_id, event.prompt_tokens + event.completion_tokens)
    if commit:
        session.commit()
