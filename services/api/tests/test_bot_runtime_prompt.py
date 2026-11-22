"""Bot system prompt 分段与工具收窄。"""

from __future__ import annotations

from app.bot_registry import CHIEF_BOT_ID, seed_system_bots
from app.bot_runtime import BOT_EXTRA_NAMES, build_bot_system_prompt, tools_for_bot
from app.db import engine, init_db
from app.models import Conversation
from app.routers.personal_agent import CORE_SUPERVISOR_TOOLS
from sqlmodel import Session


def test_build_prompt_sections():
    init_db()
    with Session(engine) as session:
        bots = seed_system_bots(session)
        chief = next(b for b in bots if b.id == CHIEF_BOT_ID)
        conv = Conversation(user_id="demo", source="assistant", kind="dm", bot_id=chief.id)
        session.add(conv)
        session.commit()
        text, sections = build_bot_system_prompt(session, chief, conv)
        names = [s["name"] for s in sections]
        assert "platform" in names
        assert "identity" in names
        assert "trust" in names
        assert "skills" in names
        assert chief.name in text


def test_approval_state_authority_is_injected_for_chief_and_colleague():
    from app.routers.personal_agent import APPROVAL_STATE_AUTHORITY

    init_db()
    with Session(engine) as session:
        bots = seed_system_bots(session)
        conv = Conversation(user_id="demo", source="assistant", kind="dm")
        session.add(conv)
        session.commit()
        for bot in bots:
            text, sections = build_bot_system_prompt(session, bot, conv, skills=[])
            platform = next(section["text"] for section in sections if section["name"] == "platform")
            assert APPROVAL_STATE_AUTHORITY in platform
            assert "查不到、范围或版本不匹配时仍为待确认" in text


def test_discussion_prompt_keeps_approval_rule(monkeypatch):
    """Discussion handoffs must not turn historical prose into current approval."""
    from app import bot_runtime
    from app.models import Bot
    from app.routers.personal_agent import APPROVAL_STATE_AUTHORITY
    bot = Bot(id="discussion-bot", name="讨论同事", persona="核对交接")
    prompt = bot_runtime.discussion_system_prompt(bot)
    assert APPROVAL_STATE_AUTHORITY in prompt
    assert "仅讨论当前交接，不执行工具" in prompt


def test_tools_for_bot_includes_extras():
    init_db()
    with Session(engine) as session:
        bots = seed_system_bots(session)
        chief = next(b for b in bots if b.id == CHIEF_BOT_ID)
        tools = tools_for_bot(chief, CORE_SUPERVISOR_TOOLS)
        names = {(t.get("function") or {}).get("name") for t in tools}
        assert "ask_bot" in names
        assert "skill_save" in names
        assert names & BOT_EXTRA_NAMES


def test_eggbot_gets_chat_audit_tool():
    from app.bot_registry import EGG_BOT_ID

    init_db()
    with Session(engine) as session:
        bots = seed_system_bots(session)
        egg = next(b for b in bots if b.id == EGG_BOT_ID)
        tools = tools_for_bot(egg, CORE_SUPERVISOR_TOOLS)
        names = {(t.get("function") or {}).get("name") for t in tools}
        assert "chat_audit" in names
        assert "routine_audit" in names


def test_truth_source_injected_into_group_prompt():
    from app.models import BotTeam, MemoryFile

    init_db()
    with Session(engine) as session:
        bots = seed_system_bots(session)
        chief = next(b for b in bots if b.id == CHIEF_BOT_ID)
        session.add(
            MemoryFile(
                path="/memories/user/truth.md",
                user_id="demo",
                content="# 真相\n当前阶段=S2",
            )
        )
        session.commit()
        team = BotTeam(
            name="测试群",
            member_bot_ids=[chief.id],
            lead_bot_id=chief.id,
            speak_policy="orchestrated",
            truth_source_path="/memories/user/truth.md",
        )
        session.add(team)
        session.commit()
        session.refresh(team)
        conv = Conversation(
            user_id="demo",
            source="assistant",
            kind="group",
            team_id=team.id,
            member_bot_ids=[chief.id],
        )
        session.add(conv)
        session.commit()
        text, _ = build_bot_system_prompt(session, chief, conv)
        assert "真相源" in text
        assert "当前阶段=S2" in text


def test_agent_id_allowed_supports_prefix_wildcard():
    from app.bot_runtime import agent_id_allowed

    assert agent_id_allowed("qc.de_ai", ["qc.*"])
    assert agent_id_allowed("qc.de_ai", ["qc.de_ai"])
    assert not agent_id_allowed("prose.write", ["qc.*"])
    assert agent_id_allowed("anything", [])  # 空列表 = 不限制


def test_bot_templates_reference_real_catalog_agents():
    import json
    from pathlib import Path

    root = Path(__file__).resolve().parents[3]
    catalog = json.loads((root / "packages/agent-runtime/agent-catalog.json").read_text("utf-8"))
    ids = {a["id"] for a in catalog["agents"]}
    for p in (root / "packages/agent-runtime/bot-templates").glob("*.json"):
        data = json.loads(p.read_text("utf-8"))
        cfg = data.get("bot", data)
        for ref in cfg.get("allowed_agent_ids") or []:
            if ref.endswith(".*"):
                assert any(i.startswith(ref[:-1]) for i in ids), f"{p.name}: {ref} 无匹配 Agent"
            else:
                assert ref in ids, f"{p.name}: {ref} 不在 agent-catalog.json"


def test_prompt_cache_prefix_is_stable_and_chief_never_reads_private_bot_memory(monkeypatch):
    from datetime import datetime, timezone
    from sqlalchemy.pool import StaticPool
    from sqlmodel import SQLModel, create_engine
    from app.models import Bot, BotSkill, MemoryFile, Project
    from app.routers import personal_agent as pa

    isolated = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(isolated)
    with Session(isolated) as session:
        chief = Bot(id=CHIEF_BOT_ID, name='Chief')
        project = Project(user_id='u', title='Bound', format='manju', stage='S0_SETUP')
        session.add(project)
        session.commit()
        conv = Conversation(user_id='u', project_id=project.id, source='feishu')
        for owner in [CHIEF_BOT_ID, 'colleague-other']:
            session.add(MemoryFile(path=f'/memories/bots/{owner}/profile.md', user_id='u', content='PRIVATE_SECRET'))
        shared = MemoryFile(path=f'/memories/projects/{project.id}/decisions.md', user_id='u',
                            project_id=project.id, content='CANON_ONE', source_run_id='provenance-run')
        session.add(shared)
        session.commit()
        skills = [BotSkill(id='b', name='B', slash='b'), BotSkill(id='a', name='A', slash='a')]
        monkeypatch.setattr(pa, 'utcnow', lambda: datetime(2026, 1, 1, tzinfo=timezone.utc))
        text, first = build_bot_system_prompt(session, chief, conv, skills=skills)
        shared.content = 'CANON_TWO'
        monkeypatch.setattr(pa, 'utcnow', lambda: datetime(2026, 1, 2, tzinfo=timezone.utc))
        other_text, second = build_bot_system_prompt(session, chief, conv, skills=list(reversed(skills)))
        boundary = next(i for i, item in enumerate(first) if item['name'] == 'facts')
        assert first[:boundary] == second[:boundary]
        assert 'PRIVATE_SECRET' not in text + other_text
        assert 'CANON_ONE' in text and 'CANON_TWO' in other_text
        assert 'provenance-run' in text
        assert text.index('飞书简洁模式') < text.index('当前时间')


def test_group_truth_source_cannot_override_private_memory_boundary():
    from sqlalchemy.pool import StaticPool
    from sqlmodel import SQLModel, create_engine
    from app.models import MemoryFile
    from app.bot_runtime import _truth_source_block

    isolated = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(isolated)
    with Session(isolated) as session:
        private_path = '/memories/bots/other/profile.md'
        other_project_path = '/memories/projects/other/decisions.md'
        forbidden = [private_path, other_project_path,
                     '/memories/projects/current/procedural/other-agent/lessons.md',
                     '/memories/projects/current/reflections/notes.md',
                     '/memories/projects/current/private/secret.md',
                     '/memories/projects/current/fleet/f/member/notes.md',
                     '/memories/user/index.md', '/memories/user/reported.md']
        for path in forbidden:
            session.add(MemoryFile(path=path, user_id='u', content='SECRET'))
        session.commit()
        conv = Conversation(user_id='u', project_id='current')
        for path in forbidden:
            assert _truth_source_block(session, conv, {'truth_source_path': path}) == ''


def test_bot_tool_discoveries_preserve_prior_prefix(monkeypatch):
    import asyncio
    from types import SimpleNamespace
    from sqlalchemy.pool import StaticPool
    from sqlmodel import SQLModel, create_engine
    from app import bot_runtime
    from app.models import Bot
    from app.routers import personal_agent as pa

    extras = sorted(set(pa._TOOL_INDEX) - pa._CORE_NAMES - {'search_tools', 'invoke_tool', 'tool_invoke'})
    discovered = [extras[-1], extras[0]]
    snapshots = []
    async def chat(*args, **kwargs):
        snapshots.append(kwargs['tools'])
        turn = len(snapshots)
        calls = [{'id': f'call-{turn}', 'type': 'function', 'function': {'name': 'tool_search', 'arguments': '{"query":"knowledge"}'}}] if turn <= 2 else []
        return SimpleNamespace(content='' if calls else '完成', tool_calls=calls, model='test',
                               prompt_tokens=0, completion_tokens=0, raw={'choices': [{'finish_reason': 'stop'}]})
    async def tool(*args, **kwargs):
        return 'discovered', {'load': [discovered.pop(0)]}
    async def emit(*args):
        pass
    monkeypatch.setattr(bot_runtime, 'chat_completion', chat)
    monkeypatch.setattr(bot_runtime, 'execute_bot_tool', tool)
    monkeypatch.setattr(bot_runtime, 'build_bot_system_prompt', lambda *args: ('static', []))
    monkeypatch.setattr(bot_runtime, 'tools_for_bot', lambda *args: pa.CORE_SUPERVISOR_TOOLS)
    monkeypatch.setattr(pa, '_load_history', lambda *args, **scope: [])
    monkeypatch.setattr(pa, '_append_message', lambda *args, **kwargs: None)
    monkeypatch.setattr(pa, '_append_run_step', lambda *args, **kwargs: None)
    monkeypatch.setattr(pa, '_audit_safe', lambda *args, **kwargs: None)
    isolated = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(isolated)
    with Session(isolated) as session:
        conv = Conversation(user_id='u')
        session.add(conv); session.commit()
        asyncio.run(bot_runtime._run_bot_turn_impl(session, conv, Bot(id='b', name='B'), emit, skip_inbox=True))
    assert len(snapshots) == 3
    assert snapshots[1][:len(snapshots[0])] == snapshots[0]
    assert snapshots[2][:len(snapshots[1])] == snapshots[1]
    assert snapshots[2][-1]['function']['name'] == extras[0]
