"""agents 花名册：虚拟同事、roster/squads、@persona、pipeline 交接。"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.agent_colleagues import (
    agent_id_from_bot_id,
    bot_id_for_agent,
    coverage_report,
    get_virtual_bot,
    is_agent_colleague_id,
    list_virtual_bots,
    load_catalog_by_id,
    resolve_agent_mentions,
    roster,
    squads,
)
from app.bot_registry import get_bot, resolve_mentions, seed_system_bots
from app.db import get_session, init_db
from app.group_router import _build_handoff
from app.main import app


def test_virtual_bot_ids_and_catalog():
    assert is_agent_colleague_id("agent:topic.hotspot")
    assert agent_id_from_bot_id("agent:topic.hotspot") == "topic.hotspot"
    assert bot_id_for_agent("topic.hotspot") == "topic.hotspot"
    by_id = load_catalog_by_id()
    assert len(by_id) >= 50
    aid = next(iter(by_id))
    bot = get_virtual_bot(bot_id_for_agent(aid))
    assert bot is not None
    assert bot.id == bot_id_for_agent(aid)
    assert get_virtual_bot("agent:" + aid).id == aid
    assert not is_agent_colleague_id("agent:agent:" + aid)
    assert bot.allowed_agent_ids == [aid]
    assert bot.is_system is True


def test_get_bot_resolves_virtual():
    init_db()
    with next(get_session()) as session:
        seed_system_bots(session)
        by_id = load_catalog_by_id()
        aid = next(iter(by_id))
        bot = get_bot(session, bot_id_for_agent(aid))
        assert bot is not None
        assert bot.name == (by_id[aid].get("persona") or by_id[aid].get("name"))
        chief = get_bot(session, "chief")
        assert chief is not None
        assert chief.name == "幕僚长"


def test_roster_and_squads_shape():
    data = roster()
    assert data["chief"]["id"] == "chief"
    assert data["stats"]["domainAgents"] >= 50
    assert data["teams"]
    first = data["teams"][0]
    assert first["members"]
    m = first["members"][0]
    assert m["id"] == m["agentId"]
    assert "summary" in m
    assert "examplePrompts" in m

    sq = squads()
    workflows = [s for s in sq if s["kind"] == "workflow"]
    assert workflows
    assert workflows[0]["speakPolicy"] == "pipeline"
    assert workflows[0]["memberBotIds"]
    assert workflows[0]["leadBotId"] == "chief"


def test_resolve_mentions_persona():
    by_id = load_catalog_by_id()
    aid, meta = next((k, v) for k, v in by_id.items() if v.get("persona"))
    persona = meta["persona"]
    ids = resolve_mentions(f"请 @{persona} 帮忙看看", None)
    assert bot_id_for_agent(aid) in ids
    ids2 = resolve_agent_mentions(f"@{persona} 开工")
    assert bot_id_for_agent(aid) in ids2


def test_coverage_report():
    sq = next(s for s in squads() if s["kind"] == "workflow")
    full = coverage_report(sq["memberBotIds"], format=sq.get("format"))
    assert full["coverageRatio"] >= 0.99
    partial = coverage_report(sq["memberBotIds"][:2], format=sq.get("format"))
    assert partial["missing"]
    assert partial["coverageRatio"] < 1.0


def test_api_roster_squads_templates():
    init_db()
    client = TestClient(app)
    r = client.get("/api/v1/bots/roster")
    assert r.status_code == 200
    body = r.json()
    assert body["stats"]["domainAgents"] >= 50

    s = client.get("/api/v1/bots/squads")
    assert s.status_code == 200
    assert s.json()["squads"]

    t = client.get("/api/v1/bots/templates")
    assert t.status_code == 200
    ids = {x["id"] for x in t.json()}
    assert "eggbot" in ids or "chief" in ids
    assert "topic-scout" not in ids
    assert "team-editorial" not in ids

    by_id = load_catalog_by_id()
    aid = next(iter(by_id))
    g = client.get(f"/api/v1/bots/{bot_id_for_agent(aid)}")
    assert g.status_code == 200
    assert g.json()["id"] == bot_id_for_agent(aid)


def test_create_pipeline_team_with_agent_members():
    init_db()
    client = TestClient(app)
    sq = next(
        s for s in client.get("/api/v1/bots/squads").json()["squads"] if s["kind"] == "workflow"
    )
    members = sq["memberBotIds"][:5]
    res = client.post(
        "/api/v1/bots/teams",
        json={
            "name": "花名册编组单元测",
            "memberBotIds": members,
            "speakPolicy": "pipeline",
            "leadBotId": "chief",
            "maxRounds": 6,
        },
    )
    assert res.status_code == 200, res.text
    team = res.json()
    assert "chief" in team["memberBotIds"]
    assert team["speakPolicy"] == "pipeline"
    client.delete(f"/api/v1/bots/teams/{team['id']}")


def test_pipeline_handoff_builder():
    bots = list_virtual_bots()
    assert len(bots) >= 2
    a, b = bots[0], bots[1]
    h = _build_handoff(
        from_bot=a,
        to_bot=b,
        stage={"id": "S1", "name": "选题", "requiresUserAck": True},
        instruction="推进",
        context="上下文",
    )
    assert h["type"] == "handoff"
    assert h["fromBotId"] == a.id
    assert h["toBotId"] == b.id
    assert h["requiresUserAck"] is True


def test_canonical_identity_preserves_legacy_rows_and_scopes():
    import pytest
    from fastapi import HTTPException
    from sqlmodel import Session, SQLModel, create_engine
    from app.models import Bot, BotSkill, Conversation, MemoryFile, ScheduledTask, UsageEvent
    from app.routers import bots, memory_ext, personal_agent
    from app.schemas import BotPatchIn, BotTeamCreateIn, CreateConversationIn, MemoryMountIn
    from app.seed import DEMO_USER

    aid = "topic.logline_title"
    alias = "agent:" + aid
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as db:
        for number, identity in enumerate([alias, aid, "eggbot"], 1):
            tag = str(number)
            db.add(BotSkill(bot_id=identity, name=tag, slash=tag))
            db.add(ScheduledTask(bot_id=identity, id=tag, name=tag, cron_or_interval="1h"))
            db.add(UsageEvent(bot_id=identity, user_id=DEMO_USER, model="offline",
                              prompt_tokens=number, completion_tokens=0))
            for project in ("a", "b"):
                db.add(MemoryFile(path=f"/memories/bots/{identity}/projects/{project}/{tag}",
                                  project_id=project, user_id=DEMO_USER, content=tag))
        from app.models import Project
        for project_id in ("a","b"):
            db.add(Project(id=project_id,user_id=DEMO_USER,title="旧项目",format="manju",stage="S0_SETUP"))
        old = Conversation(id="old-chat", bot_id=alias, project_id="a", user_id=DEMO_USER)
        db.add(old)
        db.commit()

        for identity in (aid, alias):
            assert bots.api_get_bot(identity, db).id == aid
            with pytest.raises(HTTPException) as patch:
                bots.api_patch_bot(identity, BotPatchIn(name="changed"), db)
            assert patch.value.status_code == 400
            with pytest.raises(HTTPException) as delete:
                bots.api_delete_bot(identity, db)
            assert delete.value.status_code == 400
            assert sorted(s.name for s in bots.api_bot_skills(identity, db) if s.bot_id == aid) == ["1", "2"]
            assert sorted(r["name"] for r in bots.api_bot_routines(identity, db)) == ["1", "2"]
            assert sorted(r["content"] for r in bots.api_bot_memories(identity, db, "a")["files"]) == ["1", "2"]
            assert bots.api_bot_usage(identity, 7, db)["promptTokens"] == 3
            chat = personal_agent.create_conversation(CreateConversationIn(bot_id=identity, project_id="a"), db)
            assert (chat.id, chat.bot_id) == ("old-chat", aid)
        other = personal_agent.create_conversation(CreateConversationIn(bot_id=alias, project_id="b"), db)
        assert other.id != "old-chat" and other.bot_id == aid
        assert db.get(Conversation, "old-chat").bot_id == alias
        team = bots.api_create_team(BotTeamCreateIn(name="team", member_bot_ids=[aid, alias], lead_bot_id=alias), db)
        assert team.member_bot_ids == [aid] and team.lead_bot_id == aid
        mount = memory_ext.create_mount(MemoryMountIn(store_id=f"bot.{alias}.profile",
            conversation_id=old.id, agent_id=alias), db)
        assert (mount.agent_id, mount.store_id) == (aid, f"bot.{aid}.profile")
        with pytest.raises(HTTPException) as denied:
            memory_ext.create_mount(MemoryMountIn(store_id=mount.store_id, agent_id="eggbot"), db)
        assert denied.value.status_code == 403
        db.add(Bot(id=alias, name="persisted conflict"))
        db.commit()
        with pytest.raises(HTTPException) as conflict:
            bots.api_get_bot(aid, db)
        assert conflict.value.status_code == 409
        assert db.get(Bot, alias).name == "persisted conflict"


def test_private_mount_bootstrap_legacy_reads_and_historical_listing():
    import pytest
    from fastapi import HTTPException
    from sqlmodel import Session, SQLModel, create_engine, select
    from app.memory_service import hybrid_search_memory
    from app.models import AgentRun, Conversation, MemoryFile, MemoryMount, MemoryStore
    from app.routers.memory_ext import bootstrap_mounts, create_mount, list_mounts
    from app.schemas import MemoryMountIn
    from app.seed import DEMO_USER

    aid = "topic.logline_title"
    alias = "agent:" + aid
    with Session(create_engine("sqlite://")) as db:
        SQLModel.metadata.create_all(db.get_bind())
        db.add(Conversation(id="chat", user_id=DEMO_USER, project_id="p", bot_id=alias))
        db.add(AgentRun(id="run", agent_id=aid, project_id="p", conversation_id="chat"))
        db.commit()
        for project, chat, run, agent in [
            ("other", "chat", "run", alias), ("p", "chat", None, "eggbot"),
            ("p", None, "run", "eggbot"), ("p", "absent", "run", aid),
        ]:
            with pytest.raises(HTTPException) as denied:
                bootstrap_mounts(project, chat, run, agent, db)
            assert denied.value.status_code == 403
            assert not db.exec(select(MemoryStore)).all()
            assert not db.exec(select(MemoryMount)).all()
        mounts = bootstrap_mounts("p", "chat", "run", alias, db)
        assert all(m.agent_id == aid for m in mounts)
        old_store = f"bot.{alias}.profile"
        db.add(MemoryStore(id=old_store, name="legacy", kind="agent", scope_ref=alias, shared=False))
        db.add(MemoryMount(id="old", agent_id=alias, store_id=old_store, conversation_id="chat"))
        fixtures = [(alias, "dup", "stale"), (alias, "only", "historical"),
                    (aid, "dup", "current"), ("eggbot", "secret", "hidden")]
        for identity, name, content in fixtures:
            db.add(MemoryFile(path=f"/memories/bots/{identity}/{name}", user_id=DEMO_USER,
                              store_id=f"bot.{identity}.profile", content=content))
        db.add(MemoryFile(path="/memories/bots/eggbot/wrong-owner", user_id=DEMO_USER,
                          store_id=old_store, content="mislabeled"))
        db.commit()
        physical = create_mount(MemoryMountIn(store_id=f"bot.{aid}.profile", agent_id=aid), db)
        assert physical.store_id == old_store
        assert sorted(r.content for r in hybrid_search_memory(db, "", store_id=physical.store_id)) == ["current", "historical"]
        from app.routers.misc import memory_tree
        tree = memory_tree(db, f"bot.{aid}.profile", None)
        assert sorted(row.content for row in tree) == ["current", "historical"]
        historical = next(row for row in tree if row.content == "historical")
        assert historical.path == f"/memories/bots/{alias}/only"
        assert historical.display_path == f"/memories/bots/{aid}/only"
        view = next(m for m in list_mounts("chat", None, db) if m.id == "old")
        assert (view.agent_id, view.store_id) == (aid, old_store)
        assert db.get(MemoryMount, "old").agent_id == alias
