from types import SimpleNamespace

import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app import bot_registry, bot_runtime
from app.models import Bot, Conversation, UsageEvent
from app.routers import personal_agent as pa
from app.settings import Settings


@pytest.mark.asyncio
@pytest.mark.parametrize('path', ['chief', 'bot'])
@pytest.mark.parametrize('case', ['empty', 'length', 'partial_tool', 'reasoning_only', 'hidden_comment', 'inline_then_comment', '<invoke name', '<tool_call', '<invoke/>', '<minimax:tool_call></minimax:tool_call>', 'valid'])
async def test_supervisor_requires_complete_output_and_records_actual_usage(monkeypatch, path, case):
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    events, messages, budgets = [], [], []
    content = '实际回复' if case in ('valid', 'length', 'reasoning_only') else ''
    if case.startswith("<"):
        content = case
    if case == "hidden_comment":
        content = "摘要正文<!--未完成的更正"
    if case == "inline_then_comment":
        content = "```示例 <!--```\n摘要<!--隐藏更正"
    calls = [{'id': 'partial', 'function': {'name': 'run_agent', 'arguments': '{'}}] if case == 'partial_tool' else []
    response = SimpleNamespace(content=content, tool_calls=calls, model='MiniMax-M3.1-Flash',
        prompt_tokens=311, completion_tokens=1600, cache_hit_tokens=101, cache_miss_tokens=210,
        raw={'choices': [{'finish_reason': 'length' if case in ('length', 'partial_tool') else 'stop',
            **({'message': {'reasoning': 'hidden reasoning'}} if case == 'reasoning_only' else {})}]})
    async def chat(*args, **kwargs):
        budgets.append(kwargs['max_tokens'])
        return response
    async def emit(event, data):
        events.append((event, data))
    monkeypatch.setattr(pa, 'chat_completion', chat)
    monkeypatch.setattr(bot_runtime, 'chat_completion', chat)
    monkeypatch.setattr(bot_registry, 'seed_system_bots', lambda *args: [])
    monkeypatch.setattr(bot_registry, 'get_bot', lambda *args: None)
    monkeypatch.setattr(pa, '_load_history', lambda *args, **scope: [])
    monkeypatch.setattr(pa, '_core_facts_block', lambda *args: '')
    monkeypatch.setattr(pa, '_tools_for_loaded', lambda *args: [])
    monkeypatch.setattr(pa, '_append_run_step', lambda *args, **kwargs: None)
    monkeypatch.setattr(pa, '_append_message', lambda *args, **kwargs: messages.append(args[3]))
    monkeypatch.setattr(bot_runtime, 'build_bot_system_prompt', lambda *args: ('system', []))
    monkeypatch.setattr(bot_runtime, 'tools_for_bot', lambda *args: [])
    with Session(engine) as session:
        conv = Conversation(user_id='test', source='assistant')
        session.add(conv); session.commit()
        if path == 'chief':
            reply = await pa._run_supervisor_impl(session, conv, emit)
        else:
            reply = await bot_runtime._run_bot_turn_impl(session, conv, Bot(id='test-bot', name='Test'), emit, skip_inbox=True)
        assert budgets == [8192]
        usages = session.exec(select(UsageEvent)).all()
        assert len(usages) == 1
        assert (usages[0].prompt_tokens, usages[0].completion_tokens, usages[0].cache_hit_tokens) == (311,1600,101)
        assert usages[0].model == 'MiniMax-M3.1-Flash'
        assert usages[0].cost_est == 0
    if case in ('valid', 'hidden_comment', 'inline_then_comment', '<invoke/>'):
        assert reply == content
        assert any(e == 'done' for e, _ in events)
    else:
        assert '重试' in reply
        assert '已完成' not in reply
        assert not any(e in ('done', 'tool_call') for e, _ in events)
        assert messages == []


def test_personal_agent_output_budget_bounds():
    assert Settings().personal_agent_max_output_tokens == 8192
    for value in (1023, 32769):
        with pytest.raises(ValueError):
            Settings(personal_agent_max_output_tokens=value)


@pytest.mark.parametrize('content', ['```示例 <!--```', '行内 `<!--` 示例', '~~~html\n<!--\n~~~', '正文<!--说明-->继续', '他在日记里写下 <!--，然后关掉屏幕。', '<invoke> 是本节讲解的标签。'])
def test_comment_examples_are_preserved(content):
    from app.personal_agent_output import validate_agent_output
    validate_agent_output(SimpleNamespace(content=content))


def test_native_call_with_literal_dsml_uses_only_native_batch():
    from app.personal_agent_output import validate_agent_output, validate_tool_batch
    call = {'id': 'native', 'function': {'name': 'save', 'arguments': '{}'}}
    response = SimpleNamespace(content='<｜DSML｜function_calls>', tool_calls=[call])
    validate_agent_output(response)
    assert validate_tool_batch(response.tool_calls, [
        {'function': {'name': 'save', 'parameters': {'type': 'object'}}},
    ]) == [('save', {})]
