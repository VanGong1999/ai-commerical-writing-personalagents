"""Actual model turns belong to the executing colleague, never its dispatcher."""
import asyncio
from types import SimpleNamespace

import pytest
from sqlmodel import Session, SQLModel, create_engine, select

from app.models import AgentRun, UsageEvent
from app.routers import llm, misc
from app.agent_colleagues import load_catalog_by_id


@pytest.fixture
def session():
    engine = create_engine('sqlite://')
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    engine.dispose()


def test_summary_reconciles_workers_bots_legacy_runs_and_unknown_without_mutating(session):
    session.add(AgentRun(id='legacy-run', agent_id='char.bio_manju', status='succeeded'))
    for fields in [
        dict(agent_id='prose.episode_body', prompt_tokens=100, completion_tokens=20),
        dict(bot_id='agent:prose.episode_body', prompt_tokens=30, completion_tokens=5),
        dict(bot_id='chief', prompt_tokens=10, completion_tokens=2),
        dict(run_id='legacy-run', prompt_tokens=40, completion_tokens=3),
        dict(agent_id='eval.judge', prompt_tokens=7, completion_tokens=1),
        dict(prompt_tokens=4, completion_tokens=1),
    ]:
        session.add(UsageEvent(user_id='test', model='unknown-price', **fields))
    session.commit()
    summary = misc.usage_summary(session)
    bots = {r['botId']: r for r in summary['byBot']}
    agents = {r['agentId']: r for r in summary['byAgent']}
    assert bots['prose.episode_body']['tokens'] == 155
    assert bots['char.bio_manju']['tokens'] == 43
    assert bots['chief']['tokens'] == 12
    assert bots['system:eval.judge']['tokens'] == 8
    assert bots['unattributed']['tokens'] == 5
    assert bots['prose.episode_body']['name'] == load_catalog_by_id()['prose.episode_body']['name']
    assert all(aid in bots for aid in load_catalog_by_id())
    assert agents['prose.episode_body']['tokens'] == 155
    assert sum(row['tokens'] for row in summary['byBot']) == summary['used'] == 223
    assert session.exec(select(UsageEvent).where(UsageEvent.run_id == 'legacy-run')).one().agent_id is None
    details = misc.list_usage(session=session)
    legacy = next(row for row in details if row.run_id == 'legacy-run')
    assert (legacy.agent_id, legacy.bot_id) == ('char.bio_manju', 'char.bio_manju')


def test_nested_worker_turn_keeps_child_actor_and_parent_run_link(session, monkeypatch):
    session.add(AgentRun(id='parent', agent_id='orch.writing', status='running'))
    session.commit()
    async def complete(*args, **kwargs):
        return SimpleNamespace(model='actual', content='done', prompt_tokens=9,
            completion_tokens=3, cache_hit_tokens=2, cache_miss_tokens=7,
            tool_calls=[], raw={})
    monkeypatch.setattr(llm, 'chat_completion', complete)
    asyncio.run(llm.agent_chat(llm.AgentChatIn(messages=[{'role':'user','content':'write'}],
        run_id='parent', agent_id='prose.episode_body'), session))
    event = session.exec(select(UsageEvent)).one()
    assert (event.run_id, event.agent_id, event.bot_id) == ('parent', 'prose.episode_body', 'prose.episode_body')
    assert event.prompt_tokens + event.completion_tokens == 12
    summary = misc.usage_summary(session)
    bots = {r['botId']: r['tokens'] for r in summary['byBot']}
    assert bots['prose.episode_body'] == 12
    assert bots['orch.writing'] == 0


def test_system_recorder_preserves_actual_usage_and_unknown_pricing(session):
    from app.usage_attribution import record_model_usage
    record_model_usage(SimpleNamespace(model='real-model', prompt_tokens=17,
        completion_tokens=6, cache_hit_tokens=11, cache_miss_tokens=6),
        agent_id='system.provider_test', session=session)
    event = session.exec(select(UsageEvent)).one()
    assert (event.agent_id, event.bot_id, event.model) == ('system.provider_test', 'system:system.provider_test', 'real-model')
    assert (event.prompt_tokens, event.completion_tokens, event.cache_hit_tokens, event.cost_est) == (17, 6, 11, 0)


def test_inspiration_model_call_is_accounted_even_if_output_cannot_be_parsed(session, monkeypatch):
    from app.models import Inspiration
    from app.routers import workbench
    import app.llm_service as service
    row = Inspiration(user_id='test', id='idea', level='idea', source_text='test')
    session.add(row); session.commit()
    async def complete(*args, **kwargs):
        return SimpleNamespace(model='real-model', content='not json', prompt_tokens=23, completion_tokens=4)
    monkeypatch.setattr(service, 'chat_completion', complete)
    asyncio.run(workbench.expand_inspiration('idea', session))
    event = session.exec(select(UsageEvent)).one()
    assert (event.agent_id, event.bot_id, event.prompt_tokens, event.completion_tokens) == ('inspiration.expand', 'inspiration.expand', 23, 4)


def test_evaluation_attribution_records_gateway_usage_and_actual_model(session, monkeypatch):
    from app.eval import attribution
    from app.models import EvalCaseCandidate
    row = EvalCaseCandidate(id='case', signal='regenerate')
    session.add(row); session.commit()
    async def complete(*args, **kwargs):
        return SimpleNamespace(model='judge-actual-model', prompt_tokens=31, completion_tokens=8,
            content='{"attribution":"context_loss","reason":"missing","fixSuggestion":"restore"}')
    monkeypatch.setattr(attribution, 'chat_completion', complete)
    result = asyncio.run(attribution.suggest_attribution(session, 'case'))
    event = session.exec(select(UsageEvent)).one()
    assert (event.prompt_tokens, event.completion_tokens, event.model) == (31, 8, 'judge-actual-model')
    assert result.attribution_suggestion.startswith('context_loss:')


def test_legacy_response_usage_is_preserved_without_estimating(session):
    from app.usage_attribution import record_model_usage
    record_model_usage({'model':'legacy-actual', 'usage':{'prompt_tokens':13,
        'completion_tokens':2, 'prompt_tokens_details':{'cached_tokens':7}}},
        agent_id='eval.judge', session=session)
    event = session.exec(select(UsageEvent)).one()
    assert (event.model, event.prompt_tokens, event.completion_tokens, event.cache_hit_tokens) == ('legacy-actual', 13, 2, 7)


def test_compaction_chat_records_run_actor_once_and_preserves_truncation(session, monkeypatch):
    session.add(AgentRun(id='parent', agent_id='orch.writing', status='running'))
    session.commit()
    async def complete(*args, **kwargs):
        return SimpleNamespace(model='actual', content='partial', prompt_tokens=12,
            completion_tokens=6, cache_hit_tokens=4, cache_miss_tokens=8,
            raw={'choices':[{'finish_reason':'length'}]})
    monkeypatch.setattr(llm, 'chat_completion', complete)
    result = asyncio.run(llm.llm_chat(llm.ChatCompletionIn(messages=[{'role':'user','content':'summarize'}],
        run_id='parent', agent_id='prose.episode_body'), session))
    assert result.finish_reason == 'length'
    event = session.exec(select(UsageEvent)).one()
    assert (event.run_id, event.agent_id, event.bot_id) == ('parent', 'prose.episode_body', 'prose.episode_body')
    assert event.prompt_tokens + event.completion_tokens == 18
