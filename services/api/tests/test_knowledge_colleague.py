import pytest
from fastapi import HTTPException
from sqlmodel import Session, SQLModel, create_engine
from app.models import Project, KnowledgeDoc, Bot, AgentRun, Job
from app.knowledge_colleague import validate_config, resolve_agent, catalog, run_role, colleague
from app.routers.jobs import knowledge_page, knowledge_search

def test_project_document_and_execution_identity():
    engine = create_engine('sqlite://')
    SQLModel.metadata.create_all(engine)
    with Session(engine) as s:
        for id, owner in [('a','u'), ('b','u'), ('c','x')]:
            s.add(Project(id=id,user_id=owner,title=id,format='manju',stage='setup'))
            s.add(KnowledgeDoc(id=id,user_id=owner,title=id,doc_type='text',storage_uri='inline:宋朝'+id,status='indexed'))
        s.commit()
        config=dict(enabled=True,projectId='a',formats=['manju'],documentIds=['a'])
        for override in [dict(projectId='c'),dict(documentIds=['c']),dict(stage='invented'),dict(formats=['invented'])]:
            with pytest.raises(HTTPException):
                validate_config(s, 'u', config|override, [])
        bot=Bot(id='adviser',name='顾问',owner_user_id='u',execution=validate_config(s,'u',config,[]))
        s.add(bot);s.commit()
        assert resolve_agent(s,bot.id,'a','u')['id']==bot.id
        assert [a['id'] for a in catalog(s,'a','u')].count(bot.id)==1
        for project,owner in [('b','u'),('c','x')]:
            with pytest.raises(HTTPException): resolve_agent(s,bot.id,project,owner)
            with pytest.raises(HTTPException): colleague(s,bot.id,owner,project)
        run=AgentRun(project_id='a',agent_id=bot.id)
        job=Job(type='agent.run',project_id='a',user_id='u',result_ref=run.id,payload={'agentId':bot.id})
        s.add(run);s.add(job);s.commit()
        from app.routers.jobs import KnowledgeCitationsIn, knowledge_citations
        from hashlib import sha256
        role = run_role(s,run.id,job.id,'u',initialize=True)
        assert role['id']==bot.id
        def batch(doc_id, quote, offset):
            return KnowledgeCitationsIn(roleVersion=role["version"], citations=[
                dict(docId=doc_id, quote=quote, offset=offset)])
        anchor = knowledge_citations(run.id,job.id,batch("a","朝a",0),s,"u")["citations"][0]
        assert anchor == dict(docId="a", quote="朝a", offset=1, providedOffset=0,
                              sourceHash=sha256("宋朝a".encode()).hexdigest())
        for identity, quote, status in [("b","宋朝b",403), ("a","近似引文",422)]:
            with pytest.raises(HTTPException) as exc:
                knowledge_citations(run.id,job.id,batch(identity,quote,0),s,"u")
            assert exc.value.status_code == status
        assert knowledge_search(run.id,job.id,'宋',4,s,'u',role['version'])['hits'][0]['docId']=='a'
        assert knowledge_page(run.id,'a',job.id,1,2,s,'u',role['version'])['text']=='朝a'
        with pytest.raises(HTTPException): knowledge_page(run.id,'b',job.id,0,2,s,'u',role['version'])
        bot.status='paused';s.add(bot);s.commit()
        with pytest.raises(HTTPException): run_role(s,run.id,job.id,'u')


def test_citation_offsets_match_uploaded_text_coordinates():
    from app.routers.jobs import resolve_quote_offset
    text = "甲😀甲😀甲唯一引文。结尾"
    assert resolve_quote_offset(text, "唯一引文", 4) == 5
    assert resolve_quote_offset(text, "甲😀", 2) == 2  # exact offsets disambiguate repeated text
    for quote, offset in [("甲😀", 1), ("甲乙", 0), ("aaa", 4)]:
        with pytest.raises(HTTPException):
            resolve_quote_offset("aaaaa" if quote == "aaa" else text, quote, offset)


@pytest.fixture
def adviser_workspace(monkeypatch):
    from app.bot_registry import create_bot
    from app.settings import get_settings
    owner = get_settings().demo_user_id
    from sqlalchemy.pool import StaticPool
    engine = create_engine("sqlite://", connect_args={"check_same_thread":False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        for key, who in [("A", owner), ("B", owner), ("X", "foreign")]:
            session.add(Project(id=key, user_id=who, title="项目" + key, format="manju", stage="S0_SETUP"))
            session.add(KnowledgeDoc(id=key, user_id=who, title=key, doc_type="text", status="indexed",
                                     storage_uri="inline:史料" + key))
        session.commit()
        from app.routers import jobs
        for key in ("enqueue_job", "publish_job_event"):
            monkeypatch.setattr(jobs, key, lambda *_a, **_kw: None)
        bot = create_bot(session, {"name": "考据", "execution": {
            "enabled": True, "formats": ["manju"], "projectId": "A", "documentIds": ["A"]}}, owner_user_id=owner)
        yield session, owner, bot
    engine.dispose()


def test_catalog_receipt_scope_and_changed_configuration(adviser_workspace):
    from app.models import Artifact
    from app.bot_registry import patch_bot
    from app.routers import jobs
    from app.schemas import CreateRunIn
    from sqlmodel import select
    s, owner, bot = adviser_workspace
    card = next(item for item in catalog(s, "A", owner) if item["id"] == bot.id)
    assert (card["documentCount"], card["projectTitle"], card["doneContract"][1]["gates"]) == (1, "项目A", ["Schema"])
    assert len([c for c in catalog(s, "B", owner) if c["id"] == bot.id]) == 0
    for project, identity in [("B", bot.id), ("X", bot.id), ("A", "no-such-role")]:
        with pytest.raises(HTTPException):
            jobs.create_run(CreateRunIn(project_id=project, agent_id=identity), s)
    assert not s.exec(select(Job)).all()
    run = jobs.create_run(CreateRunIn(project_id="A", agent_id=bot.id), s)
    job = s.exec(select(Job)).one()
    role = jobs.knowledge_role(run.id, job.id, s, owner)
    assert job.payload["agentId"] == run.agent_id == bot.id
    for identity, pid, creator, kind in [("own", "A", run.id, "qc_report"), ("other", "A", "different", "qc_report"),
                                         ("foreign", "B", run.id, "qc_report"), ("prose", "A", run.id, "manuscript")]:
        s.add(Artifact(id=identity, project_id=pid, created_by_run_id=creator, type=kind,
                       title="私有标题", body_markdown="保密", status="candidate"))
    s.commit()
    version = role["version"]
    assert jobs.knowledge_outputs(run.id, job.id, version, s, owner) == {
        "artifacts": [{"id": "own", "version": 1, "status": "candidate"}]}
    checked = jobs.knowledge_outputs(run.id, job.id, version, s, owner, evidence=True)["artifacts"]
    assert [(row["id"], row["bodyMarkdown"]) for row in checked] == [("own", "保密")]
    with pytest.raises(HTTPException):
        jobs.knowledge_outputs(run.id, "other-job", version, s, owner)
    cfg = bot.execution
    for update in ({"documentIds": ["X"]}, {"extra": True}, {"stage": "BAD"}, {"formats": ["BAD"]}):
        with pytest.raises(HTTPException):
            patch_bot(s, bot, {"execution": dict(cfg, **update)})
    with pytest.raises(HTTPException):
        patch_bot(s, bot, {"tool_allowlist": ["bash"]})
    patch_bot(s, bot, {"execution": dict(cfg, documentIds=["A", "B"])})
    for stale_read in [
        lambda: jobs.knowledge_role(run.id, job.id, s, owner),
        lambda: jobs.knowledge_page(run.id, "B", job.id, 0, 5, s, owner),
        lambda: jobs.knowledge_search(run.id, job.id, "史料", 4, s, owner),
        lambda: jobs.knowledge_outputs(run.id, job.id, version, s, owner),
        lambda: jobs.knowledge_page(run.id, "B", job.id, 0, 5, s, owner, version),
        lambda: jobs.knowledge_search(run.id, job.id, "史料", 4, s, owner, version),
    ]:
        with pytest.raises(HTTPException) as exc:
            stale_read()
        assert exc.value.status_code == 409


def test_ordinary_group_admission_and_late_fleet_scope(adviser_workspace):
    import asyncio
    from sqlmodel import select
    from app.models import BotTeam, Conversation, AgentEvent
    from app.routers import jobs, personal_agent as pa, agents_catalog as fleet
    from app.schemas import CreateConversationIn, ChatConversationIn, CreateRunIn, ContextRefRequest
    from app.group_router import _member_bots
    s, owner, bot = adviser_workspace
    outsider = Bot(id="outsider", name="外部顾问", owner_user_id="foreign", execution={
        "enabled": True, "projectId": "X", "formats": ["manju"], "documentIds": ["X"]})
    s.add(outsider)
    s.add(BotTeam(id="foreign-team", name="其他人的团队", owner_user_id="foreign", member_bot_ids=[outsider.id]))
    s.commit()
    for keywords in [dict(member_bot_ids=[outsider.id]), dict(member_bot_ids=[bot.id], team_id="foreign-team")]:
        with pytest.raises(HTTPException):
            pa.create_conversation(CreateConversationIn(kind="group", project_id="A", **keywords), s)
    conv = Conversation(id="group", kind="group", user_id=owner, project_id="A", member_bot_ids=[outsider.id])
    s.add(conv)
    s.commit()
    with pytest.raises(HTTPException):
        _member_bots(s, conv)
    with pytest.raises(HTTPException):
        asyncio.run(pa.chat_conversation(conv.id, ChatConversationIn(message="核查"), s))
    conv.member_bot_ids = [bot.id]
    s.add(conv)
    s.commit()
    assert [b.id for b in _member_bots(s, conv)] == [bot.id]
    with pytest.raises(HTTPException) as blocked:
        asyncio.run(pa.chat_conversation(conv.id, ChatConversationIn(message="核查",
                    context_refs=[ContextRefRequest(kind="kb_doc",source_id="B")]), s))
    assert blocked.value.status_code == 403 and not s.exec(select(AgentEvent)).all()
    run = jobs.create_run(CreateRunIn(project_id="A", agent_id=bot.id), s)
    job = s.exec(select(Job)).one()
    bot.status = "paused"
    s.add(bot)
    s.commit()
    with pytest.raises(HTTPException):
        fleet._enqueue_fleet_job(s, fleet_id="f", job_id=job.id, run_id=run.id, state={}, index=0, respect_governor=False)


def test_one_bot_project_routines_use_distinct_events_and_conversations(adviser_workspace):
    from sqlmodel import select
    from app.models import AgentEvent, Conversation, ScheduledTask, utcnow
    from app.bot_registry import patch_bot
    from test_scheduler_event_routines import _load_scheduler
    s, owner, bot = adviser_workspace
    scheduler = _load_scheduler()
    patch_bot(s, bot, {"execution": dict(bot.execution, projectId=None)})
    for project in ["A", "B"]:
        task = ScheduledTask(id="task-" + project, name=project, bot_id=bot.id,
                             cron_or_interval="1h", payload_template={"projectId": project})
        s.add(task)
        source = AgentEvent(conversation_id="source", source="job_done", payload={"project_id":project, "run_id":"run-" + project})
        s.add(source)
        s.commit()
        wrong = AgentEvent(conversation_id="source", source="job_done", payload={"project_id":"X", "run_id":"foreignRun"})
        scheduler._enqueue_bot_routine(s, task, utcnow(), event=wrong)
        scheduler._enqueue_bot_routine(s, task, utcnow(), event=source)
    conversations = s.exec(select(Conversation).where(Conversation.kind == "routine")).all()
    assert {c.project_id for c in conversations} == {"A", "B"} and len(conversations) == 2
    for conv in conversations:
        event = s.exec(select(AgentEvent).where(AgentEvent.conversation_id == conv.id)).one()
        project = conv.project_id
        assert (event.payload["project_id"], event.payload["task_id"], event.target_bot_id) == (project, "task-" + project, bot.id)
        assert "run-" + project in event.payload["message"] and "foreignRun" not in event.payload["message"]


def test_admitted_source_refs_follow_every_group_speaker(adviser_workspace):
    import asyncio
    from types import SimpleNamespace
    from app.bot_runtime import knowledge_request
    from app.models import AgentEvent, Conversation
    from app.routers import personal_agent as pa
    from app.schemas import ChatConversationIn, ContextRefRequest
    from app.bot_registry import patch_bot
    from sqlmodel import select
    s, owner, bot = adviser_workspace
    # An individual user can mention an owned adviser outside the group's fixed roster.
    conv = Conversation(user_id=owner, project_id="A", kind="group", member_bot_ids=["chief"])
    s.add(conv)
    s.commit()
    from app.bot_registry import seed_system_bots
    seed_system_bots(s)
    with pytest.raises(HTTPException) as denied:
        asyncio.run(pa.chat_conversation(conv.id,ChatConversationIn(message="@" + bot.name + " 请核对",
            context_refs=[ContextRefRequest(kind="kb_doc",source_id="B")]),s))
    assert denied.value.status_code == 403
    assert not s.exec(select(AgentEvent)).all()
    from app.context_refs import resolve_refs
    from app.routers import assistant, jobs
    from unittest.mock import patch
    doc = s.get(KnowledgeDoc, "A")
    prefix = "前" * 6100 + "😀𠮷\n"
    quote = "鹤在第三扇窗前停下。"
    doc.storage_uri = "inline:" + prefix + quote + "后记" + quote
    s.add(doc)
    s.commit()
    ref = resolve_refs(s, [ContextRefRequest(kind="kb_doc", source_id="A", start=6105, end=6115, quote=quote)]).refs[0]
    event = SimpleNamespace(source="web", payload={"message":"核查", "contextRefs":[ref.model_dump(by_alias=True)]})
    instruction, selected = knowledge_request(s, bot, conv.project_id, [event])
    with patch.object(assistant, "enqueue_job"), patch.object(assistant, "publish_job_event"):
        dispatch = assistant._trigger_agent(s, s.get(Project, "A"), bot.id, bot.name, instruction, selected_refs=selected)
    run_id, job_id = dispatch["run_id"], dispatch["job_id"]
    role = run_role(s, run_id, job_id, owner, initialize=True)
    span, = role["selectedReferences"]
    assert (span["offset"], span["limit"], span["id"], span["snapshotId"]) == (6103, 10, ref.id, ref.snapshot_id)
    assert span["quote"] == knowledge_page(run_id, "A", job_id, span["offset"], span["limit"], s, owner, role["version"])["text"] == quote
    assert "contextBefore" not in span and "contextAfter" not in span
    citations = jobs.KnowledgeCitationsIn(roleVersion=role["version"], citations=[
        dict(docId="A", refId=ref.id, offset=6115, quote=quote)])
    anchor, = jobs.knowledge_citations(run_id, job_id, citations, s, owner)["citations"]
    assert (anchor["offset"], anchor["sourceHash"], anchor["snapshotId"]) == (6103, ref.content_hash, ref.snapshot_id)
    doc.storage_uri += "更新"
    s.add(doc)
    s.commit()
    with pytest.raises(HTTPException, match="重新选择"):
        run_role(s, run_id, job_id, owner)
    # The later speaker gets the original event even if another user message was appended.
    from app import group_router
    conv.member_bot_ids = ["chief", bot.id]
    conv.group_rules = {"speak_policy":"free"}
    s.add(conv)
    s.commit()
    seen = []
    async def deliver(session, conversation, participant, emit, *, claimed_events, skip_inbox):
        seen.append((participant.id, claimed_events, skip_inbox))
        if participant.id == "chief":
            patch_bot(s, bot, {"execution": dict(bot.execution, documentIds=["B"])})
        else:
            knowledge_request(session, participant, conversation.project_id, claimed_events)
        return None
    async def emit(*args): pass
    with patch.object(group_router, "run_bot_turn", deliver), pytest.raises(HTTPException):
        asyncio.run(group_router.run_group_turn(s,conv,emit,claimed_events=[event]))
    assert seen[0][1] == seen[1][1] == [event] and seen[1][2]


def test_candidate_only_input_and_legacy_completion(adviser_workspace, monkeypatch):
    from sqlmodel import select
    from app.models import Artifact, AsyncTaskGroup
    from app import task_daemon
    from app.routers import jobs
    from app.schemas import CreateRunIn
    s, owner, bot = adviser_workspace
    options = {"adoptType":"qc_report", "adoptMode":"strong"}
    with pytest.raises(HTTPException):
        jobs.create_run(CreateRunIn(project_id="A",agent_id=bot.id,input_json=options),s)
    for key in ["input_extra","inputExtra"]:
        with pytest.raises(HTTPException):
            task_daemon.create_task_group(s,user_id=owner,conversation_id=None,title="scope",goal="核查",
                kind="multi_agent",approval_mode="auto_pilot",max_concurrency=1,
                tasks=[{"projectId":"A","agentId":bot.id,key:options}])
    assert not s.exec(select(Job)).all() and not s.exec(select(AsyncTaskGroup)).all()
    run = AgentRun(project_id="A",agent_id=bot.id,input_json=options)
    report = Artifact(project_id="A",created_by_run_id=run.id,type="qc_report",status="candidate",title="考据")
    s.add(run); s.add(report); s.commit()
    monkeypatch.setattr(jobs, "_maybe_announce_run", lambda *_:None)
    jobs.patch_run_status(run.id,{"status":"succeeded"},s)
    s.refresh(report)
    assert (report.status,report.version,report.adopted_at) == ("candidate",1,None)


def test_historical_run_start_remains_authoritative(adviser_workspace):
    from app.models import RunStep
    from app.routers import jobs
    from app.bot_registry import patch_bot
    s,owner,bot = adviser_workspace
    run = AgentRun(project_id="A",agent_id=bot.id)
    job = Job(type="agent.run",user_id=owner,project_id="A",result_ref=run.id,payload={"agentId":bot.id})
    s.add(run);s.add(job);s.commit()
    version = jobs.knowledge_role(run.id,job.id,s,owner)["version"]
    run.knowledge_role_version = None
    s.add(run)
    s.add(RunStep(run_id=run.id,conversation_id="project:A",kind="run_start",seq=1,payload={"roleVersion":version}))
    s.commit()
    assert jobs.knowledge_role(run.id,job.id,s,owner)["version"] == version
    assert run.knowledge_role_version is None
    patch_bot(s,bot,{"execution":dict(bot.execution,documentIds=["A","B"])})
    with pytest.raises(HTTPException):
        jobs.knowledge_role(run.id,job.id,s,owner)


def test_search_and_page_require_version_over_http(adviser_workspace):
    from starlette.testclient import TestClient
    from app.main import app, api
    from app.db import get_session
    from app.routers import jobs
    from app.schemas import CreateRunIn
    from sqlmodel import select
    s,owner,bot = adviser_workspace
    run = jobs.create_run(CreateRunIn(project_id="A",agent_id=bot.id),s)
    job = s.exec(select(Job)).one()
    def session_for_request():
        with Session(s.get_bind()) as local: yield local
    api.dependency_overrides[get_session] = session_for_request
    try:
        client = TestClient(app)
        url = f"/api/v1/runs/{run.id}/knowledge-"
        query = {"job_id":job.id}
        version = client.get(url+"role",params=query).json()["version"]
        for path, args in [("search",{"q":"史料"}),("doc/A",{})]:
            assert client.get(url+path,params=query|args).status_code == 422
            assert client.get(url+path,params=query|args|{"version":version}).status_code == 200
    finally:
        api.dependency_overrides.pop(get_session,None)


@pytest.mark.parametrize("kind", ["dm","group"])
def test_disabling_admitted_knowledge_turn_cannot_fall_back_to_supervisor(adviser_workspace,kind,monkeypatch):
    import asyncio
    from sqlmodel import select
    from app import bot_runtime, group_router
    from app.agent_inbox import submit_event, inbox_event_actions
    from app.bot_registry import patch_bot
    from app.models import Conversation, AgentEvent, Message
    from app.routers import personal_agent as pa
    from app.schemas import ChatConversationIn
    s,owner,bot = adviser_workspace
    conv = Conversation(user_id=owner,project_id="A",kind=kind,bot_id=bot.id if kind=="dm" else None,
        member_bot_ids=[bot.id] if kind=="group" else [])
    s.add(conv);s.commit()
    # Exercise the normal HTTP handler through durable admission without consuming its execution stream.
    asyncio.run(pa.chat_conversation(conv.id,ChatConversationIn(message="请考据"),s))
    admitted=s.exec(select(AgentEvent).where(AgentEvent.conversation_id==conv.id)).one()
    assert admitted.payload["knowledgeAdmission"]["botIds"] == [bot.id]
    ref={"kind":"kb_doc","sourceId":"A","quote":"REVOKED_QUOTE","start":0,"end":2}
    quoted=submit_event(s,conversation_id=conv.id,source="web",target_bot_id=bot.id,
        payload={"message":"核查选区","contextRefs":[ref]})
    s.add(Message(conversation_id=conv.id,role="user",content="核查选区",actions=inbox_event_actions([quoted]),
                  evidence=[{"kind":"context_ref","ref":ref}]))
    s.commit()
    patch_bot(s,bot,{"execution":{}})
    def forbidden(*_args,**_kw):
        pytest.fail("disabled admitted work reached a provider or knowledge dispatcher")
    monkeypatch.setattr(bot_runtime,"chat_completion",forbidden)
    monkeypatch.setattr(pa,"_trigger_agent",forbidden)
    async def emit(*_args): pass
    if kind=="dm":
        perform=lambda event: bot_runtime.run_bot_turn(s,conv,bot,emit,claimed_events=[event])
    else:
        perform=lambda event: group_router.run_group_turn(s,conv,emit,claimed_events=[event])
    for event in [admitted,quoted]:
        with pytest.raises(HTTPException) as refused: asyncio.run(perform(event))
        assert refused.value.status_code in (403,409)
    if kind=="group":
        with pytest.raises(HTTPException):
            asyncio.run(bot_runtime.run_bot_turn(s,conv,bot,emit,claimed_events=[quoted],skip_inbox=True))
    assert not s.exec(select(Job)).all()
    ordinary=submit_event(s,conversation_id=conv.id,source="web",target_bot_id=bot.id,payload={
        "message":"新的普通请求","knowledgeAdmission":{"projectId":"A","botIds":[bot.id]}})
    from app.knowledge_colleague import validate_knowledge_delivery
    assert not ordinary.payload.get("knowledgeAdmission")
    assert not validate_knowledge_delivery(s,conv,[ordinary.payload],bot.id)
    entries=pa._load_history(s,conv.id,ordinary_bot_id=bot.id)
    assert all("REVOKED_QUOTE" not in entry["content"] for entry in entries)


@pytest.mark.parametrize(("revocation", "denial"), [("pause_bot", 404), ("delete_document", 403)])
def test_failed_dm_job_completes_after_knowledge_access_is_revoked(adviser_workspace, monkeypatch, revocation, denial):
    import asyncio
    from sqlmodel import select
    from starlette.testclient import TestClient
    from app import bot_runtime, chief_runner, db, feishu_notify, run_lease
    from app.bot_registry import patch_bot
    from app.main import api
    from app.models import AgentEvent, RunStep, ThreadSubscription
    from app.routers import assistant, jobs, personal_agent as pa
    from app.schemas import ChatConversationIn, CreateConversationIn

    session, owner, bot = adviser_workspace
    engine = session.get_bind()
    monkeypatch.setattr(db, "engine", engine)
    monkeypatch.setattr(assistant, "enqueue_job", lambda *_: None)
    monkeypatch.setattr(assistant, "publish_job_event", lambda *_: None)
    monkeypatch.setattr(feishu_notify, "announce_run_finished", lambda *_, **__: False)

    def unexpected_inference(*args, **kwargs):
        pytest.fail("completion bookkeeping reached inference or dispatched new work")

    monkeypatch.setattr(bot_runtime, "chat_completion", unexpected_inference)
    monkeypatch.setattr(pa, "chat_completion", unexpected_inference)
    patch_bot(session, bot, {"trust_level": 2})
    conv = pa.create_conversation(CreateConversationIn(kind="dm", bot_id=bot.id, project_id="A"), session)
    asyncio.run(pa.chat_conversation(conv.id, ChatConversationIn(message="核查项目史料"), session))
    asyncio.run(chief_runner.run_conversation_turns(session, conv.id))
    request = session.exec(select(AgentEvent).where(AgentEvent.conversation_id == conv.id)).one()
    assert request.payload["knowledgeAdmission"]["recipientBotId"] == bot.id
    claim = jobs.claim_agent_job(session=session)
    job_id, run_id = claim["jobId"], claim["runId"]
    lease = run_lease.acquire(session, run_id, "knowledge-worker")
    assert lease["ok"]
    assert session.get(Job, job_id).status == session.get(AgentRun, run_id).status == "running"
    version = jobs.knowledge_role(run_id, job_id, session, owner)["version"]
    monkeypatch.setattr(pa, "_trigger_agent", unexpected_inference)
    if revocation == "pause_bot":
        patch_bot(session, bot, {"status": "paused"})
    else:
        session.delete(session.get(KnowledgeDoc, "A"))
        session.commit()
    with pytest.raises(HTTPException) as rejected_read:
        jobs.knowledge_page(run_id, "A", job_id, 0, 10, session, owner, version)
    assert rejected_read.value.status_code == denial

    terminal = {
        "terminalJobId": job_id, "leaseVersion": lease["leaseVersion"],
        "status": "failed", "error": rejected_read.value.detail,
    }
    with TestClient(api) as client:
        for _ in range(2):
            response = client.patch(f"/runs/{run_id}/status", json=terminal)
            assert response.status_code == 200, response.text

    with Session(engine) as fresh:
        assert fresh.get(AgentRun, run_id).status == fresh.get(Job, job_id).status == "failed"
        sub = fresh.exec(select(ThreadSubscription).where(ThreadSubscription.run_id == run_id)).one()
        assert sub.status == "completed"
        receipt = fresh.exec(select(RunStep).where(
            RunStep.run_id == run_id, RunStep.kind == "agent_status",
        )).one()
        assert (receipt.payload["status"], receipt.payload["closedSubscriptionIds"]) == ("failed", [sub.id])
        event = fresh.exec(select(AgentEvent).where(
            AgentEvent.conversation_id == conv.id, AgentEvent.source == "job_done",
        )).one()
        assert (event.payload["run_id"], event.payload["status"]) == (run_id, "failed")
        assert not event.payload.get("knowledgeAdmission")
        with pytest.raises(HTTPException) as rejected_delivery:
            asyncio.run(chief_runner.pump_one(fresh, conv.id))
        assert rejected_delivery.value.status_code == denial


def test_knowledge_routine_cannot_become_an_ordinary_occurrence(adviser_workspace):
    from app.schemas import CreateScheduledTaskIn
    from app.routers.misc import create_scheduled
    from app.models import AgentEvent, utcnow
    from app.bot_registry import patch_bot
    from sqlmodel import select
    from test_scheduler_event_routines import _load_scheduler
    s,owner,bot = adviser_workspace
    scheduler = _load_scheduler()
    body = CreateScheduledTaskIn(name="考据",bot_id=bot.id,prompt="复核",cron_or_interval="1h",
                                 payload_template={"projectId":"A","knowledgeBotId":"spoof"})
    task = create_scheduled(body,s)
    assert task.payload_template["knowledgeBotId"] == bot.id
    patch_bot(s,bot,{"execution":{}})
    with pytest.raises(HTTPException):
        scheduler._enqueue_bot_routine(s,task,utcnow())
    assert not s.exec(select(AgentEvent)).all()
    ordinary = create_scheduled(body,s)
    assert "knowledgeBotId" not in ordinary.payload_template
    scheduler._enqueue_bot_routine(s,ordinary,utcnow())
    event=s.exec(select(AgentEvent)).one()
    assert event.payload["knowledgeAdmission"] is None


def test_pipeline_resume_retains_the_original_knowledge_assignment(adviser_workspace):
    import asyncio
    from app.models import Conversation
    from app.agent_inbox import submit_event, conversation_owner
    from app.pipeline_checkpoint import advance_pipeline
    from app.bot_registry import patch_bot
    from sqlmodel import select
    s,owner,bot = adviser_workspace
    stage = {"id":"review","name":"考据","memberBotIds":[bot.id],"discussionMemberIds":[bot.id]}
    conv=Conversation(user_id=owner,project_id="A",kind="group",member_bot_ids=[bot.id],
                      group_rules={"format":"manju","stages":[stage],"speakPolicy":"pipeline"})
    s.add(conv);s.commit()
    ev=submit_event(s,conversation_id=conv.id,source="web",payload={"message":"核查"})
    async def emit(*args): pass
    async def advance(budget,goal,events):
        async with conversation_owner(s,conv.id):
            return await advance_pipeline(s,conv,[stage],[bot],emit,goal,budget,events)
    asyncio.run(advance(0,"核查",[ev]))
    state=conv.group_rules["pipeline_execution"]
    assert state["knowledgeAdmissions"][0]["botIds"] == [bot.id]
    patch_bot(s,bot,{"execution":{}})
    asyncio.run(advance(1,"",[]))
    assert conv.group_rules["pipeline_execution"]["status"] == "blocked"
    assert not s.exec(select(Job)).all()


def test_bound_group_revision_reuses_version_history_and_current_evidence(monkeypatch):
    import json
    from pathlib import Path
    from datetime import timedelta
    from hashlib import sha256
    from sqlmodel import select
    from pydantic import ValidationError
    from app.models import ActivityLog, Artifact, ArtifactVersion, utcnow
    from app.routers import jobs, projects
    from app.schemas import PatchArtifactIn
    from app.routers.jobs import KnowledgeRevisionIn, revise_knowledge_report

    fixtures = Path(__file__).resolve().parents[2] / "agent-worker/test/fixtures"
    group = json.loads((fixtures / "knowledge-group-native.json").read_text())
    source = json.loads((fixtures / "knowledge-report-native.json").read_text())["source"]
    role = group["roles"][1]
    pid, doc_id = role["runProjectId"], role["documentIds"][0]
    cfg = dict(enabled=True, projectId=pid, stage="S0_SETUP", formats=["manju"], documentIds=[doc_id])
    original, second = [call["args"] for call in group["calls"]]
    receipt = json.loads(group["results"][0]["result"])
    instructions = role["instructions"]
    actor, pinned = role["id"], role["version"]

    def canonical(args):
        evidence = args["bodyJson"]
        return {**evidence, "agentId": actor, "roleVersion": pinned, "unknownItems": evidence["unknowns"],
                "unknowns": "\n".join(evidence["unknowns"]), "citations": [
                    {**c, "offset": source.index(c["quote"]), "providedOffset": int(c["offset"]),
                     "sourceHash": sha256(source.encode()).hexdigest()} for c in evidence["citations"]]}

    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as s:
        bot = Bot(id=actor, name=role["name"], owner_user_id="u", execution=cfg,
                  persona=instructions["persona"], tone=instructions["tone"],
                  duties=instructions["duties"], never_do=instructions["neverDo"])
        project = Project(id=pid, user_id="u", title="编组", format="manju", stage="S0_SETUP",
                          progress={"logicAck": True})
        doc = KnowledgeDoc(id=doc_id, user_id="u", title="证据卡", doc_type="text", storage_uri="inline:"+source)
        run = AgentRun(id=role["runId"], agent_id=actor, project_id=pid, status="running",
                       knowledge_role_version=pinned, lease_version=3, lease_until=utcnow()+timedelta(minutes=5))
        job = Job(id=group["jobId"], type="agent.run", result_ref=run.id, user_id="u",
                  payload={"agentId": actor}, project_id=pid, status="running")
        saved = Artifact(id=receipt["id"], project_id=pid, created_by_run_id=run.id, type="qc_report",
                         title=original["title"], body_markdown=original["bodyMarkdown"], body_json=canonical(original),
                         status="candidate")
        s.add_all([bot, project, doc, run, job, saved])
        s.commit()
        assert run_role(s, run.id, job.id, "u")["version"] == pinned
        base = dict(expectedVersion=1, roleVersion=pinned, leaseVersion=3)
        def revise(**edits):
            return revise_knowledge_report(run.id, saved.id, job.id, KnowledgeRevisionIn(**(base | edits)), s, "u")
        for bad in [dict(status="adopted"), dict(expectedVersion=None), dict(expectedVersion=True)]:
            with pytest.raises(ValidationError):
                revise(title="修订", **bad)
        for edits in [dict(expectedVersion=9), dict(leaseVersion=2), dict(roleVersion="revoked")]:
            with pytest.raises(HTTPException):
                revise(title="修订", **edits)
        for obj, field, value in [(saved,"created_by_run_id",group["roles"][0]["runId"]),
                                  (saved,"project_id","foreign"), (saved,"type","outline"), (saved,"status","adopted"),
                                  (saved,"body_json",{**canonical(original),"agentId":group["roles"][0]["id"]}),
                                  (bot,"tool_allowlist",role["tools"]), (bot,"status","paused"),
                                  (job,"status","succeeded"), (run,"status","paused"), (run,"status","succeeded"),
                                  (doc,"storage_uri","inline:"+source+"扩充")]:
            prior = getattr(obj,field)
            setattr(obj,field,value)
            s.commit()
            with pytest.raises(HTTPException):
                revise(title="修订")
            assert not s.exec(select(ArtifactVersion)).all() and saved.version == 1
            setattr(obj,field,prior)
            s.commit()
        live_deadline = run.lease_until
        for deadline in (None, utcnow()-timedelta(seconds=1)):
            run.lease_until = deadline
            s.commit()
            with pytest.raises(HTTPException):
                revise(title="失效租约")
            assert s.exec(select(ArtifactVersion)).all() == s.exec(select(ActivityLog)).all() == []
            assert (saved.version,saved.title) == (1,original["title"])
        run.lease_until = live_deadline
        s.commit()
        # Expire the clock between acquiring the baseline lock and executing the final update.
        with monkeypatch.context() as m:
            clock = [utcnow()]
            baseline = projects._capture_baseline
            def after_lock(*args):
                snapshot = baseline(*args)
                clock[0] += timedelta(hours=1)
                return snapshot
            m.setattr(jobs, "utcnow", lambda: clock[0])
            m.setattr(projects, "_capture_baseline", after_lock)
            with pytest.raises(HTTPException):
                revise(title="写入时租约已过期")
            assert s.exec(select(ArtifactVersion)).all() == s.exec(select(ActivityLog)).all() == []
            assert (saved.version,saved.title) == (1,original["title"])
        def version_actor():
            evidence_row, = jobs.knowledge_outputs(run.id,job.id,pinned,s,"u",evidence=True)["artifacts"]
            return evidence_row.get("versionActor")
        assert version_actor() is None
        projects._snapshot_version(s, saved, actor="agent:"+run.id)
        s.commit()
        assert version_actor() == "agent:"+run.id
        saved.body_markdown = "与快照不一致"
        s.commit()
        assert version_actor() is None
        saved.body_markdown = original["bodyMarkdown"]
        s.commit()
        evidence = canonical(second)
        for bad in [{**evidence,"citations":[{**evidence["citations"][0],"sourceHash":"stale"}]},
                    {**evidence,"citations":[{**evidence["citations"][0],"docId":"foreign"}]},
                    {**evidence,"unknownItems":["丢失项目"]}]:
            with pytest.raises(HTTPException):
                revise(bodyJson=bad)
        result = revise(title=second["title"], bodyMarkdown=second["bodyMarkdown"], bodyJson=evidence)
        assert (result.id,result.status,result.version,result.body_json) == (saved.id,"candidate",2,evidence)
        assert result.body_markdown == second["bodyMarkdown"] and project.progress == {"logicAck": True}
        history = s.exec(select(ArtifactVersion).order_by(ArtifactVersion.version)).all()
        assert [(v.version,v.title) for v in history] == [(1,original["title"]), (2,second["title"])]
        assert history[-1].actor == "agent:"+run.id
        with pytest.raises(HTTPException):
            revise(title="过期修订")
        assert len(s.exec(select(ArtifactVersion)).all()) == 2
        assert version_actor() == history[-1].actor
        projects.patch_artifact(pid, saved.id, PatchArtifactIn(expectedVersion=2, bodyMarkdown="作者修订正文"), s)
        assert (saved.version,saved.body_markdown,version_actor()) == (3,"作者修订正文","user")
        # A second record for the exact same version makes provenance ambiguous.
        s.add(ArtifactVersion(artifact_id=saved.id,version=3,title=saved.title,status=saved.status,
                              body_markdown=saved.body_markdown,body_json=saved.body_json,actor="agent:"+run.id))
        s.commit()
        assert version_actor() is None
