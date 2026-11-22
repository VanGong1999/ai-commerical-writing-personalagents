"""Personal Agent：tool_call 配对 / 确认 / 拒绝 / 历史清洗。"""

from __future__ import annotations

import asyncio

import pytest

from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.models import Conversation, Message, new_id
from app.routers.personal_agent import (
    _load_history,
    _sanitize_history,
    respond_conversation_impl,
)
from app.seed import DEMO_USER

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
SQLModel.metadata.create_all(engine)


def _conv(session: Session) -> Conversation:
    conv = Conversation(user_id=DEMO_USER, source="assistant", title="新对话")
    session.add(conv)
    session.commit()
    session.refresh(conv)
    return conv


def test_current_project_identity_is_injected_even_without_memory():
    from app.models import Project
    from app.routers.personal_agent import _core_facts_block
    with Session(engine) as session:
        project = Project(user_id=DEMO_USER, title='当前漫剧', format='manju', stage='S0_SETUP')
        session.add(project)
        session.commit()
        conv = _conv(session)
        conv.project_id = project.id
        text = _core_facts_block(session, conv)
        assert project.id in text
        assert '当前漫剧' in text
        assert 'manju' in text
        assert 'S0_SETUP' in text
        assert '当前项目' in text


def test_sanitize_drops_orphan_tool_calls():
    history = [
        {"role": "user", "content": "写正文"},
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {"id": "tc1", "function": {"name": "run_agent", "arguments": "{}"}},
                {"id": "tc2", "function": {"name": "list_projects", "arguments": "{}"}},
            ],
        },
        # 只有一个 tool 结果 → 整轮应被丢弃
        {"role": "tool", "content": "ok", "tool_call_id": "tc1"},
        {"role": "user", "content": "换个说法"},
    ]
    out = _sanitize_history(history)
    assert out == [
        {"role": "user", "content": "写正文"},
        {"role": "user", "content": "换个说法"},
    ]


def test_sanitize_keeps_paired_round():
    history = [
        {"role": "user", "content": "hi"},
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [{"id": "a", "function": {"name": "list_projects", "arguments": "{}"}}],
        },
        {"role": "tool", "content": "无项目", "tool_call_id": "a", "name": "list_projects"},
        {"role": "assistant", "content": "还没有项目。"},
    ]
    out = _sanitize_history(history)
    assert len(out) == 4
    assert out[2]["tool_call_id"] == "a"


def test_confirm_placeholders_keep_history_valid():
    with Session(engine) as session:
        conv = _conv(session)
        tc1, tc2 = new_id(), new_id()
        session.add(
            Message(
                conversation_id=conv.id,
                role="user",
                content="写正文并列出项目",
            )
        )
        session.add(
            Message(
                conversation_id=conv.id,
                role="assistant",
                content="",
                tool_calls=[
                    {
                        "id": tc1,
                        "type": "function",
                        "function": {"name": "run_agent", "arguments": '{"instruction":"写正文"}'},
                    },
                    {
                        "id": tc2,
                        "type": "function",
                        "function": {"name": "list_projects", "arguments": "{}"},
                    },
                ],
            )
        )
        session.add(
            Message(
                conversation_id=conv.id,
                role="tool",
                content="等待用户确认：即将写正文",
                actions=[{"type": "confirm_pending", "tool": "run_agent", "tool_call_id": tc1, "name": "run_agent"}],
            )
        )
        session.add(
            Message(
                conversation_id=conv.id,
                role="tool",
                content="已暂停，待确认后再执行。",
                actions=[
                    {"type": "paused_for_confirm", "tool": "list_projects", "tool_call_id": tc2, "name": "list_projects"}
                ],
            )
        )
        session.add(
            Message(
                conversation_id=conv.id,
                role="assistant",
                content="即将写正文，是否继续？",
                actions=[
                    {
                        "type": "confirm_required",
                        "tool": "run_agent",
                        "args": {"instruction": "写正文"},
                        "tool_call_id": tc1,
                    }
                ],
            )
        )
        session.commit()

        history = _load_history(session, conv.id)
        assert any(m.get("role") == "tool" and m.get("tool_call_id") == tc1 for m in history)
        assert any(m.get("role") == "tool" and m.get("tool_call_id") == tc2 for m in history)
        # 配对完整，不应被清洗掉
        assert any(m.get("role") == "assistant" and m.get("tool_calls") for m in history)


def test_reject_updates_placeholder():
    with Session(engine) as session:
        conv = _conv(session)
        tcid = new_id()
        session.add(Message(conversation_id=conv.id, role="user", content="写正文"))
        session.add(
            Message(
                conversation_id=conv.id,
                role="assistant",
                content="",
                tool_calls=[
                    {
                        "id": tcid,
                        "type": "function",
                        "function": {"name": "run_agent", "arguments": '{"instruction":"写正文"}'},
                    }
                ],
            )
        )
        session.add(
            Message(
                conversation_id=conv.id,
                role="tool",
                content="等待用户确认",
                actions=[{"type": "confirm_pending", "tool": "run_agent", "tool_call_id": tcid, "name": "run_agent"}],
            )
        )
        pending = Message(
            conversation_id=conv.id,
            role="assistant",
            content="即将写正文，是否继续？",
            actions=[
                {
                    "type": "confirm_required",
                    "tool": "run_agent",
                    "args": {"instruction": "写正文"},
                    "tool_call_id": tcid,
                }
            ],
        )
        session.add(pending)
        session.commit()
        session.refresh(pending)

        result = asyncio.run(
            respond_conversation_impl(session, conv, approve=False, message_id=pending.id)
        )
        assert result["ok"] is True
        assert result["approved"] is False

        tool_rows = list(
            session.exec(
                select(Message).where(Message.conversation_id == conv.id, Message.role == "tool")
            )
        )
        assert any("拒绝" in (r.content or "") for r in tool_rows)
        history = _load_history(session, conv.id)
        assert any(m.get("tool_call_id") == tcid for m in history)


def test_compaction_preserves_latest_user_refs_and_complete_tool_round():
    from app.routers.personal_agent import _compact_history
    call = {'role': 'assistant', 'content': '', 'tool_calls': [
        {'id': 'a', 'function': {'name': 'read', 'arguments': '{}'}},
        {'id': 'b', 'function': {'name': 'read', 'arguments': '{}'}}]}
    latest = {'role': 'user', 'content': '当前选区' + ' immutable-ref ' * 30}
    history = [{'role': 'user', 'content': 'old' * 100},
               {'role': 'assistant', 'content': 'old reply' * 100}, latest,
               call, {'role': 'tool', 'tool_call_id': 'a', 'content': 'A'},
               {'role': 'tool', 'tool_call_id': 'b', 'content': 'B'}]
    out = _compact_history(history, trigger_chars=100, keep_tail=1)
    assert latest in out
    assert out[-3:] == history[-3:]
    assert _sanitize_history(out) == out


def test_sanitize_removes_incomplete_round_before_next_tool_round():
    first = {'role': 'assistant', 'content': '', 'tool_calls': [{'id': 'missing'}]}
    second = {'role': 'assistant', 'content': '', 'tool_calls': [{'id': 'ok'}]}
    result = {'role': 'tool', 'tool_call_id': 'ok', 'content': 'done'}
    assert _sanitize_history([first, second, result]) == [second, result]


def test_core_facts_never_fall_back_to_another_project_or_global_journal():
    from app.models import Project, MemoryFile
    from app.routers.personal_agent import _core_facts_block
    with Session(engine) as session:
        project = Project(user_id=DEMO_USER, title='other project', format='manju', stage='S0_SETUP')
        session.add(project)
        session.commit()
        paths = [f'/memories/projects/{project.id}/decisions.md',
                 '/memories/reported.md', '/memories/user/index.md']
        for path in paths:
            row = session.get(MemoryFile, path) or MemoryFile(path=path, user_id=DEMO_USER)
            row.content = 'OTHER_PROJECT_SECRET'
            session.add(row)
        session.commit()
        assert 'OTHER_PROJECT_SECRET' not in _core_facts_block(session, _conv(session))


def test_memory_budget_uses_versioned_pointer_instead_of_incomplete_fact():
    from app.models import MemoryFile
    from app.routers.personal_agent import _memory_context_block
    from app.memory_service import memory_hash
    row = MemoryFile(path='/memories/projects/p/decisions.md', user_id=DEMO_USER,
                     content='The culprit is ' + 'x' * 5000 + ' Alice', source_run_id='source-run')
    text = _memory_context_block(row, 'shared', limit=700)
    assert 'The culprit' not in text
    assert memory_hash(row.content) in text
    assert 'source-run' in text
    assert 'read_memory/read' in text
    assert len(text) < 700


def test_tools_order_is_stable_for_different_set_insertion_orders():
    from app.routers.personal_agent import _tools_for_loaded
    names = ['read_memory', 'run_agent', 'list_projects', 'tool_search']
    assert _tools_for_loaded(set(names)) == _tools_for_loaded(set(reversed(names)))


def test_history_budget_drops_optional_turns_without_trimming_latest_refs():
    from app.routers.personal_agent import _compact_history, _estimate_chars
    latest = {'role': 'user', 'content': 'exact immutable selected quote'}
    history = [{'role': 'user', 'content': 'old ' * 100}, latest]
    out = _compact_history(history, trigger_chars=10000, max_chars=100)
    assert out == [latest]
    assert _estimate_chars(out) <= 100


def test_history_budget_fails_closed_when_mandatory_refs_are_oversized():
    import pytest
    from app.routers.personal_agent import _compact_history, ContextBudgetExceeded
    latest = {'role': 'user', 'content': 'immutable-ref' * 100}
    with pytest.raises(ContextBudgetExceeded):
        _compact_history([latest], trigger_chars=10000, max_chars=100)
    assert latest['content'] == 'immutable-ref' * 100


def test_history_budget_rejection_never_calls_provider_in_bot_or_legacy_loop(monkeypatch):
    from app import bot_runtime, bot_registry
    from app.models import Bot
    from app.routers import personal_agent as pa

    async def forbidden_chat(*args, **kwargs):
        raise AssertionError('oversized immutable user context must not reach provider')

    monkeypatch.setattr(pa, 'chat_completion', forbidden_chat)
    monkeypatch.setattr(bot_runtime, 'chat_completion', forbidden_chat)
    monkeypatch.setattr(bot_registry, 'seed_system_bots', lambda *args: [])
    monkeypatch.setattr(bot_registry, 'get_bot', lambda *args: None)
    monkeypatch.setattr(pa, '_load_history', lambda *args, **scope: [{'role': 'user', 'content': 'immutable-ref ' * 6000}])
    monkeypatch.setattr(pa, '_append_run_step', lambda *args, **kwargs: None)
    monkeypatch.setattr(bot_runtime, 'build_bot_system_prompt', lambda *args: ('static system', []))
    monkeypatch.setattr(bot_runtime, 'tools_for_bot', lambda *args: [])
    events = []

    async def emit(event, data):
        events.append((event, data))

    with Session(engine) as session:
        conv = _conv(session)
        replies = [asyncio.run(pa._run_supervisor_impl(session, conv, emit)),
                   asyncio.run(bot_runtime._run_bot_turn_impl(session, conv, Bot(id='b', name='B'), emit, skip_inbox=True))]
    assert all('预算' in reply for reply in replies)
    assert len(events) == 2
    assert all(event == 'error' and data['code'] == 'context_budget_exceeded' for event, data in events)


def test_core_facts_prefer_canonical_bible_and_never_inject_stale_legacy():
    from app.models import Project, MemoryFile
    from app.routers.personal_agent import _core_facts_block
    with Session(engine) as session:
        project = Project(user_id=DEMO_USER, title='Canonical', format='manju', stage='S0_SETUP')
        session.add(project)
        session.commit()
        conv = _conv(session)
        conv.project_id = project.id
        canonical_path = f'/memories/projects/{project.id}/bible/decisions.md'
        canonical = MemoryFile(path=canonical_path, project_id=project.id, user_id=DEMO_USER,
                               content='CANONICAL_LOCK', source_run_id='canonical-source')
        legacy = MemoryFile(path=f'/memories/projects/{project.id}/decisions.md', project_id=project.id,
                            user_id=DEMO_USER, content='STALE_LEGACY_LOCK')
        session.add(canonical); session.add(legacy); session.commit()
        text = _core_facts_block(session, conv)
        assert 'CANONICAL_LOCK' in text and 'canonical-source' in text
        assert 'STALE_LEGACY_LOCK' not in text
        canonical.content = 'CANONICAL_OVERSIZED' * 1000
        text = _core_facts_block(session, conv)
        assert canonical_path in text and '未加载' in text
        assert 'CANONICAL_OVERSIZED' not in text and 'STALE_LEGACY_LOCK' not in text
        canonical.content = '  \n'
        assert 'STALE_LEGACY_LOCK' in _core_facts_block(session, conv)
        session.delete(canonical); session.commit()
        assert 'STALE_LEGACY_LOCK' in _core_facts_block(session, conv)


def test_canonical_memory_read_error_or_wrong_owner_never_falls_back():
    import pytest
    from app.models import MemoryFile
    from app.routers.personal_agent import _project_decisions, ContextSourceUnavailable
    conv = Conversation(user_id='u', project_id='p')
    for response in [RuntimeError('database unavailable'),
                     MemoryFile(path='/memories/projects/p/bible/decisions.md', user_id='other', content='lock')]:
        calls = []
        class FakeSession:
            def get(self, model, path):
                calls.append(path)
                if isinstance(response, Exception):
                    raise response
                return response
        with pytest.raises(ContextSourceUnavailable):
            _project_decisions(FakeSession(), conv)
        assert calls == ['/memories/projects/p/bible/decisions.md']


def test_authoritative_memory_failure_never_calls_provider_in_either_supervisor(monkeypatch):
    from app import bot_runtime, bot_registry
    from app.models import Bot
    from app.routers import personal_agent as pa

    async def forbidden_chat(*args, **kwargs):
        raise AssertionError('unavailable canonical memory must not reach provider')

    def unavailable(*args, **kwargs):
        raise pa.ContextSourceUnavailable('canonical memory unavailable')

    monkeypatch.setattr(pa, 'chat_completion', forbidden_chat)
    monkeypatch.setattr(bot_runtime, 'chat_completion', forbidden_chat)
    monkeypatch.setattr(bot_registry, 'seed_system_bots', lambda *args: [])
    monkeypatch.setattr(bot_registry, 'get_bot', lambda *args: None)
    monkeypatch.setattr(pa, '_load_history', lambda *args, **scope: [])
    monkeypatch.setattr(pa, '_append_run_step', lambda *args, **kwargs: None)
    monkeypatch.setattr(pa, '_core_facts_block', unavailable)
    monkeypatch.setattr(bot_runtime, 'build_bot_system_prompt', unavailable)
    events = []

    async def emit(event, data):
        events.append((event, data))

    with Session(engine) as session:
        conv = _conv(session)
        replies = [asyncio.run(pa._run_supervisor_impl(session, conv, emit)),
                   asyncio.run(bot_runtime._run_bot_turn_impl(session, conv, Bot(id='b', name='B'), emit, skip_inbox=True))]
    assert replies == ['canonical memory unavailable'] * 2
    assert len(events) == 2
    assert all(event == 'error' and data['code'] == 'context_source_unavailable' for event, data in events)


def test_dynamic_tools_append_after_stable_core_and_previous_discoveries():
    from app.routers.personal_agent import _tools_for_loaded, _CORE_NAMES, _TOOL_INDEX
    extras = sorted(set(_TOOL_INDEX) - _CORE_NAMES - {'search_tools', 'invoke_tool', 'tool_invoke'})
    assert len(extras) >= 2
    loaded_order = []
    core = _tools_for_loaded(set(_CORE_NAMES), loaded_order)
    first = _tools_for_loaded(set(_CORE_NAMES) | {extras[-1]}, loaded_order)
    grown = _tools_for_loaded(set(_CORE_NAMES) | {extras[-1], extras[0]}, loaded_order)
    assert first[:len(core)] == core
    assert grown[:len(first)] == first
    assert [tool['function']['name'] for tool in grown[-2:]] == [extras[-1], extras[0]]
    assert _tools_for_loaded(set(_CORE_NAMES) | {extras[-1], extras[0]}, loaded_order) == grown
    # Other turns don't inherit the first turn's discovery order.
    fresh_order = []
    fresh = _tools_for_loaded(set(_CORE_NAMES) | {extras[0]}, fresh_order)
    assert fresh_order == [extras[0]]
    assert fresh[-1]['function']['name'] == extras[0]


def test_tool_discovery_batch_is_deterministic_for_identical_loaded_sets():
    from app.routers.personal_agent import _tools_for_loaded, _CORE_NAMES, _TOOL_INDEX
    names = sorted(set(_TOOL_INDEX) - _CORE_NAMES - {'search_tools', 'invoke_tool', 'tool_invoke'})[:3]
    left_order, right_order = [], []
    assert _tools_for_loaded(set(names), left_order) == _tools_for_loaded(set(reversed(names)), right_order)
    assert left_order == right_order == names


def test_bounded_memory_pages_preserve_exact_content_using_causal_tool_identity():
    from app.routers.personal_agent import _truncate_tool_bodies
    call = {'role': 'assistant', 'tool_calls': [
        {'id': 'read', 'function': {'name': 'read_memory'}},
        {'id': 'other', 'function': {'name': 'other_tool'}}]}
    page = {'role': 'tool', 'tool_call_id': 'read', 'content': 'x' * 5000}
    forged = {'role': 'tool', 'tool_call_id': 'other', 'name': 'read_memory', 'content': 'y' * 5000}
    out = _truncate_tool_bodies([call, page, forged])
    assert out[1] == page
    assert 'truncated' in out[2]['content']
    oversized = {'role': 'tool', 'tool_call_id': 'read', 'content': 'z' * 6001}
    assert 'truncated' in _truncate_tool_bodies([call, oversized])[1]['content']


def test_wrapped_memory_pages_use_authoritative_target_for_both_aliases():
    import json
    from app.routers.personal_agent import _truncate_tool_bodies
    for alias in ('invoke_tool', 'tool_invoke'):
        for raw in ({'name': 'read_memory', 'args': {'path': '/memories/projects/p/decisions.md'}},
                    json.dumps({'name': 'read_memory', 'args': {'limit': 4000}})):
            call = {'role': 'assistant', 'tool_calls': [
                {'id': 'wrapped', 'function': {'name': alias, 'arguments': raw}}]}
            page = {'role': 'tool', 'tool_call_id': 'wrapped', 'content': 'exact-page ' * 400}
            assert _truncate_tool_bodies([call, page])[1] == page
        for raw in ('{invalid', json.dumps({'name': 'other_tool', 'args': {'name': 'read_memory'}}),
                    json.dumps({'name': 'invoke_tool', 'args': {'name': 'read_memory'}})):
            call = {'role': 'assistant', 'tool_calls': [
                {'id': 'wrapped', 'function': {'name': alias, 'arguments': raw}}]}
            forged = {'role': 'tool', 'tool_call_id': 'wrapped', 'name': 'read_memory', 'content': 'x' * 4000}
            assert 'truncated' in _truncate_tool_bodies([call, forged])[1]['content']


def test_model_tools_cannot_use_legacy_wildcard_to_bypass_memory_version_checks():
    from types import SimpleNamespace
    from app.routers.personal_agent import _execute_supervisor_tool
    for name in ('write_memory','write','edit'):
        _, detail = asyncio.run(_execute_supervisor_tool(name, {'path':'/memories/projects/p/world.md','name':'world','content':'stale','expected_hash':'*'}, object(), SimpleNamespace(project_id='p')))
        assert detail.get('error') == 'memory_hash_required'


def test_persisted_receipt_and_older_scoped_instruction_survive_compaction():
    from app.routers.personal_agent import _compact_history
    with Session(engine) as session:
        conv = _conv(session)
        def add(role, content, **fields):
            session.add(Message(conversation_id=conv.id, role=role, content=content, **fields))
            session.flush()
        add('user', '第一条')
        add('user', '第二条')
        add('user', '保留雨声', actions=[{'type':'inbox_event','payloads':[{'projectId':'proj-42','source':'user'}]}])
        add('assistant', '', tool_calls=[{'id':'c','function':{'name':'write','arguments':'{}'}}])
        add('tool', '{"bodyJson":{"characters":[{"name":"fictional","status":"fiction-status"}]}}', actions=[{'tool_call_id':'c','name':'write','detail':{'body':'x'*500,'versionAfter':7,'runId':'receipt-42','requiresVerification':True,'text':'z'*800}}])
        from app.bot_runtime import execute_bot_tool
        from app.models import Bot, MemoryFile
        bot = Bot(id="review-memory-bot", name="校对")
        asyncio.run(execute_bot_tool("learn_correction", {"correction": "保留风声"}, session, conv, bot))
        text, correction = asyncio.run(execute_bot_tool(
            "learn_correction", {"correction": "保留雨声"}, session, conv, bot))
        path = correction["path"]
        assert conv.project_id in path if conv.project_id else conv.id in path
        stored_hash = session.get(MemoryFile, path).hash
        add("assistant", "", tool_calls=[{"id": "correction-call", "function": {"name": "learn_correction", "arguments": "{}"}}])
        add("tool", text, actions=[{"tool_call_id": "correction-call", "name": "learn_correction", "detail": correction}])
        for i in range(500):
            name = ('ls','find','grep','tool_search')[i % 4]
            add('assistant', '', tool_calls=[{'id':str(i),'function':{'name':name,'arguments':'{}'}}])
            add('tool', '旧查询', actions=[{'tool_call_id':str(i),'name':name}])
        add('assistant', '', tool_calls=[{'id':'r','function':{'name':'read','arguments':'{}'}}])
        add('tool', '最近的完整结果', actions=[{'tool_call_id':'r','name':'read'}])
        add('user', '继续')
        compacted = _compact_history(_load_history(session, conv.id), trigger_chars=1, keep_tail=1)
        assert all(set(row) <= {'role','content','tool_call_id','tool_calls','name'} for row in compacted)
        assert _sanitize_history(compacted) == compacted
        result = str(compacted)
        assert 'fiction-status' not in result
        assert len(result) < 5000
        for expected in ('correction-call', path, stored_hash, correction['versionId'], 'versionAfter', 'receipt-42', 'requiresVerification', '保留雨声', 'proj-42', '最近的完整结果'):
            assert expected in result


def test_selected_quote_prompt_projects_only_target_and_provenance():
    from app.context_refs import quoted_context
    ref = dict(id="ref-1", kind="artifact", sourceId="scene", title="章节", quote="选中文字",
               contextBefore="前文不能进入提示", contextAfter="后文不能进入提示",
               start=10, end=14, version=2, snapshotId="immutable", contentHash="sha", projectId="p")
    prompt = quoted_context([ref])
    assert ref['contextBefore'] not in prompt and ref['contextAfter'] not in prompt
    for key in ('quote', 'version', 'snapshotId', 'contentHash', 'start', 'end', 'projectId'):
        assert f'"{key}"' in prompt


def test_bot_corrections_isolated_by_project_and_conversation():
    from app.bot_runtime import execute_bot_tool, _correction_path
    from app.models import Bot, MemoryFile
    bot = Bot(id="scoped", name="校对")
    with Session(engine) as session:
        a, b, c = [_conv(session) for _ in range(3)]
        a.project_id, b.project_id = 'first', 'second'
        for conv, line in ((a, "甲项目纠错"), (b, "乙项目纠错"), (c, "无项目纠错")):
            _, receipt = asyncio.run(execute_bot_tool("learn_correction", {"correction": line}, session, conv, bot))
            assert receipt["path"] == _correction_path(bot.id, conv)
            stored = session.get(MemoryFile, receipt["path"])
            assert stored.hash == receipt["hash"] and "versionId" in receipt
            assert line in stored.content
        from app.bot_runtime import build_bot_system_prompt
        from app.memory_service import cas_write_memory
        cas_write_memory(session, path=f"/memories/bots/{bot.id}/corrections.md", content="旧混合纠错")
        cas_write_memory(session, path=f"/memories/bots/{bot.id}/profile.md", content="保留画像")
        prompt, _ = build_bot_system_prompt(session, bot, a)
        assert "保留画像" in prompt and "甲项目纠错" in prompt
        assert all(excluded not in prompt for excluded in ("乙项目纠错", "无项目纠错", "旧混合纠错"))


def test_second_bad_call_prevents_entire_assistant_batch(monkeypatch):
    import pytest
    from types import SimpleNamespace
    from fastapi import HTTPException
    from app.routers import assistant

    async def response(*args, **kwargs):
        return SimpleNamespace(content="", tool_calls=[
            {"function": {"name": "crawl_hotspots", "arguments": "{}"}},
            {"function": {"name": "navigate", "arguments": '{"route":5}'}},
        ])
    async def unexpected(*args):
        pytest.fail("valid prefix executed")
    monkeypatch.setattr(assistant, 'chat_completion', response)
    monkeypatch.setattr(assistant, '_execute_tool', unexpected)
    with Session(engine) as session, pytest.raises(HTTPException) as error:
        asyncio.run(assistant.assistant_llm_chat(assistant.AssistantChatIn(message="一批请求"), session))
    assert error.value.status_code == 502


def test_dsml_damaged_batch_rejected_and_example_left_intact():
    import pytest
    from fastapi import HTTPException
    from app.routers.assistant import _extract_dsml_tool_calls, _clean_dsml
    invoke = '<｜DSML｜invoke name="crawl_hotspots"></｜DSML｜invoke>'
    with pytest.raises(HTTPException):
        _extract_dsml_tool_calls('<｜DSML｜function_calls>' + invoke)
    example = '示例：`' + invoke + '`'
    assert not _extract_dsml_tool_calls(example)
    assert _clean_dsml(example) == example


def test_batch_validation_honors_existing_studio_version_schema():
    import pytest
    from app.personal_agent_output import validate_tool_batch, IncompleteAgentOutput
    from app.routers.personal_agent import SUPERVISOR_TOOLS_ALL
    calls = [{"function": {"name": "save_artifact", "arguments": {
        "artifact_id": "a", "project_id": "p", "bodyMarkdown": "稿", "expectedVersion": v
    }}} for v in (1, -1)]
    with pytest.raises(IncompleteAgentOutput):
        validate_tool_batch(calls, SUPERVISOR_TOOLS_ALL)


@pytest.mark.parametrize("content,native,accepted", [
    *( (literal, "valid", True) for literal in (
        '<invoke name', '<invoke', '<tool_call', '<minimax:tool_call',
        '<｜DSML｜function_calls', '<tool_call>{"name":"second"',
    )),
    ('<｜DSML｜function_calls', "absent", False),
    ('<tool_call>{"name":"second"', "absent", False),
    ('<invoke name', "invalid_second", False),
])
def test_assistant_dispatches_only_complete_authoritative_batch(monkeypatch, content, native, accepted):
    from types import SimpleNamespace
    from unittest.mock import AsyncMock
    from fastapi import HTTPException
    from app.routers import assistant

    calls = [] if native == "absent" else [{"function": {"name": "crawl_hotspots", "arguments": "{}"}}]
    if native == "invalid_second":
        calls.append({"function": {"name": "crawl_hotspots", "arguments": "{"}})
    response = AsyncMock(side_effect=[SimpleNamespace(content=content, tool_calls=calls)])
    execute = AsyncMock(return_value=("", [], [], None))
    monkeypatch.setattr(assistant, "chat_completion", response)
    monkeypatch.setattr(assistant, "_execute_tool", execute)
    with Session(engine) as session:
        chat = assistant.assistant_llm_chat(assistant.AssistantChatIn(message="一批请求"), session)
        if accepted:
            asyncio.run(chat)
            execute.assert_awaited_once_with("crawl_hotspots", {}, session, None)
        else:
            with pytest.raises(HTTPException) as error:
                asyncio.run(chat)
            assert error.value.status_code == 502
            execute.assert_not_awaited()
    response.assert_awaited_once()
