from __future__ import annotations

from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select
from starlette.testclient import TestClient
import pytest

from app import queue
from app.db import get_session
from app.main import api, app
from app.models import AgentRun, Artifact, Job, Project, TaskProposal, new_id
from app.queue import put_fleet_state

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
SQLModel.metadata.create_all(engine)


def override_session():
    with Session(engine) as session:
        yield session


client = TestClient(app)


@pytest.fixture(autouse=True)
def _use_test_session(monkeypatch):
    # Never contact development Redis or provider/governor in fleet tests.
    from app import queue, llm_governor
    monkeypatch.setattr(queue, "_get_redis", lambda: None)
    monkeypatch.setattr(llm_governor, "slots_available", lambda **kwargs: True)
    api.dependency_overrides[get_session] = override_session
    yield
    api.dependency_overrides.pop(get_session, None)


def _project_id(fmt: str = "manju") -> str:
    with Session(engine) as session:
        p = Project(
            id=new_id(),
            user_id="00000000-0000-4000-8000-000000000001",
            title="fleet-test",
            format=fmt,
            stage="S0",
            status="active",
        )
        session.add(p)
        session.commit()
        return p.id


def _ordered_three():
    return client.post('/api/v1/agents/fleet', json={
        'projectId': _project_id(), 'mode': 'ordered', 'mergePolicy': 'human',
        'members': [{'name': str(i), 'task': '写标题', 'agentId': 'topic.logline_title'} for i in range(3)],
    }).json()


def test_ordered_duplicate_completion_does_not_skip_running_predecessor():
    fleet = _ordered_three()
    path = f"/api/v1/agents/fleet/{fleet['fleetId']}/member"
    client.patch(path, json={'index': 0, 'status': 'done', 'summary': '上游卖点'})
    client.patch(path, json={'index': 1, 'status': 'running'})
    state = client.patch(path, json={'index': 0, 'status': 'done'}).json()
    assert state['enqueuedIndexes'] == [0, 1]


def test_ordered_failure_terminates_dependents_without_merging():
    fleet = _ordered_three()
    first, second = fleet["jobs"][:2]
    path = f"/api/v1/agents/fleet/{fleet['fleetId']}"
    running = client.patch(f"{path}/member", json={"index": 0, "status": "running"})
    assert running.status_code == 200
    with Session(engine) as session:
        job = session.get(Job, first["jobId"])
        run = session.get(AgentRun, first["runId"])
        job.status = run.status = "dead"
        session.add(job)
        session.add(run)
        session.commit()
    queue._memory_fleet.pop(fleet["fleetId"])
    detail = client.get(path)
    assert detail.status_code == 200
    assert detail.json()["reports"][0]["status"] == "failed"
    with Session(engine) as session:
        assert session.get(Job, second["jobId"]).status == "blocked"

    late = client.patch(f"{path}/member", json={"index": 0, "status": "done"})
    assert late.status_code == 200
    assert late.json()["reports"][0]["status"] == "failed"

    state = client.patch(f"{path}/member",
                         json={'index': 0, 'status': 'failed', 'summary': '模型失败'}).json()
    assert [r['status'] for r in state['reports']] == ['failed'] * 3
    assert not state.get('awaitingHumanMerge')
    assert not state.get('mergedArtifactId')
    with Session(engine) as session:
        for report in state['reports'][1:]:
            assert session.get(AgentRun, report['runId']).status == 'cancelled'


def test_ordered_handoff_contains_predecessor_evidence():
    fleet = _ordered_three()
    first, second = fleet['state']['reports'][:2]
    with Session(engine) as session:
        run = session.get(AgentRun, first['runId'])
        run.output_artifact_ids = ['artifact-upstream']
        session.add(run)
        session.commit()
    client.patch(f"/api/v1/agents/fleet/{fleet['fleetId']}/member",
                 json={'index': 0, 'status': 'done', 'summary': '林舟阻止公司破产'})
    with Session(engine) as session:
        run = session.get(AgentRun, second['runId'])
        handoff = run.input_json.get('fleetUpstream', [])
        assert handoff == [{'name': '0', 'runId': first['runId'],
                            'summary': '林舟阻止公司破产', 'artifactIds': ['artifact-upstream']}]
        assert session.get(Job, second['jobId']).payload['input']['fleetUpstream'] == handoff


def test_ordered_future_members_cannot_be_claimed_from_database_fallback():
    fleet = _ordered_three()
    with Session(engine) as session:
        second = session.get(Job, fleet['jobs'][1]['jobId'])
        assert second.status == 'blocked'
    client.patch(f"/api/v1/agents/fleet/{fleet['fleetId']}/member", json={'index':0,'status':'done'})
    with Session(engine) as session:
        assert session.get(Job, fleet['jobs'][1]['jobId']).status == 'queued'


def test_handoff_reads_persisted_artifacts_before_worker_finalizes_run():
    from app.models import Artifact
    fleet = _ordered_three()
    first, second = fleet['jobs'][:2]
    with Session(engine) as session:
        artifact = Artifact(project_id=fleet['state']['projectId'], type='logline',
                            title='上游标题', created_by_run_id=first['runId'])
        session.add(artifact)
        session.commit()
        artifact_id = artifact.id
    client.patch(f"/api/v1/agents/fleet/{fleet['fleetId']}/member",json={'index':0,'status':'done'})
    with Session(engine) as session:
        assert session.get(AgentRun,second['runId']).input_json['fleetUpstream'][0]['artifactIds'] == [artifact_id]


@pytest.mark.parametrize('agent_id', ['missing.agent', 'scene.triple'])
def test_fleet_rejects_unknown_or_wrong_format_before_creating_jobs(agent_id):
    pid = _project_id('manju')
    response = client.post('/api/v1/agents/fleet', json={
        'projectId': pid, 'members': [
            {'name': 'valid', 'task': '写标题', 'agentId': 'topic.logline_title'},
            {'name': 'invalid', 'task': '写场景', 'agentId': agent_id}],
    })
    assert response.status_code == 400
    with Session(engine) as session:
        assert not list(session.exec(select(AgentRun).where(AgentRun.project_id == pid)))


def test_chinese_colleagues_have_separate_memory_namespaces():
    from app.routers.agents_catalog import _fleet_workdir
    assert _fleet_workdir('p', 'f', '主角同事') != _fleet_workdir('p', 'f', '配角同事')
    assert _fleet_workdir('p', 'f', 'a/b') != _fleet_workdir('p', 'f', 'a_b')


def test_terminal_member_does_not_regress_on_late_callback():
    fleet = _ordered_three()
    path = f"/api/v1/agents/fleet/{fleet['fleetId']}/member"
    client.patch(path, json={'index': 0, 'status': 'done', 'summary': '完成'})
    state = client.patch(path, json={'index': 0, 'status': 'running'}).json()
    assert state['reports'][0]['status'] == 'done'


def test_create_run_returns_job_id():
    pid = _project_id()
    res = client.post(
        "/api/v1/runs",
        json={"projectId": pid, "agentId": "orch.writing", "inputJson": {"task": "hi"}},
    )
    assert res.status_code == 200
    body = res.json()
    assert body.get("id")
    assert body.get("jobId"), "create_run must return jobId to avoid client race"


def test_fleet_create_and_patch_and_human_merge():
    pid = _project_id()
    created = client.post(
        "/api/v1/agents/fleet",
        json={
            "projectId": pid,
            "mode": "union",
            "mergePolicy": "human",
            "members": [
                {"name": "a", "task": "任务 A", "agentId": "orch.writing"},
                {"name": "b", "task": "任务 B", "agentId": "orch.writing"},
            ],
        },
    )
    assert created.status_code == 200
    data = created.json()
    assert data["ok"] is True
    fleet_id = data["fleetId"]
    assert fleet_id.startswith("fleet_")
    assert len(data["jobs"]) == 2
    state = data["state"]
    assert state["mode"] == "union"
    assert state["mergePolicy"] == "human"
    assert state["format"] == "manju"
    assert state["enqueuedIndexes"] == [0, 1]
    assert len(state["reports"]) == 2

    got = client.get(f"/api/v1/agents/fleet/{fleet_id}")
    assert got.status_code == 200
    assert got.json()["planId"] == fleet_id
    queue._memory_fleet.pop(fleet_id)

    for r in state["reports"]:
        patched = client.patch(
            f"/api/v1/agents/fleet/{fleet_id}/member",
            json={
                "name": r["name"],
                "status": "done",
                "summary": f"{r['name']} ok",
                "runId": r["runId"],
                "jobId": r["jobId"],
            },
        )
        assert patched.status_code == 200
    final = patched.json()
    assert final.get("awaitingHumanMerge") is True
    assert final.get("mergeMarkdown")

    queue._memory_fleet.pop(fleet_id)
    reopened = client.get(f"/api/v1/agents/fleet/{fleet_id}")
    assert reopened.status_code == 200
    assert reopened.json() == final
    with Session(engine) as session:
        artifacts = list(session.exec(select(Artifact).where(Artifact.project_id == pid)))
        assert [a.id for a in artifacts] == [state["artifactId"]]

    confirmed = client.post(
        f"/api/v1/agents/fleet/{fleet_id}/confirm-merge",
        json={"accept": True, "note": "lgtm"},
    )
    assert confirmed.status_code == 200
    body = confirmed.json()
    assert body.get("awaitingHumanMerge") is False
    assert body.get("humanMerge", {}).get("accepted") is True
    assert body["humanMerge"]["note"] == "lgtm"
    assert body.get("mergedArtifactId"), "confirm-merge must land merge artifact"
    with Session(engine) as session:
        assert session.get(Artifact, state["artifactId"]).body_json["mergedArtifactId"] == body["mergedArtifactId"]
        assert {job.id for job in session.exec(select(Job).where(Job.project_id == pid))} == {
            report["jobId"] for report in state["reports"]
        }


def test_fleet_ordered_serial_enqueue():
    pid = _project_id("duanju")
    created = client.post(
        "/api/v1/agents/fleet",
        json={
            "projectId": pid,
            "mode": "ordered",
            "mergePolicy": "human",
            "members": [
                {"name": "first", "task": "第一步", "agentId": "orch.writing"},
                {"name": "second", "task": "第二步", "agentId": "orch.writing"},
            ],
        },
    )
    assert created.status_code == 200
    data = created.json()
    state = data["state"]
    assert state["format"] == "duanju"
    assert state["enqueuedIndexes"] == [0]

    # 完成第一个后应链式入队第二个
    r0 = state["reports"][0]
    patched = client.patch(
        f"/api/v1/agents/fleet/{data['fleetId']}/member",
        json={
            "name": r0["name"],
            "status": "done",
            "summary": "step1",
            "runId": r0["runId"],
            "jobId": r0["jobId"],
        },
    )
    assert patched.status_code == 200
    mid = patched.json()
    assert mid["enqueuedIndexes"] == [0, 1]
    assert mid["reports"][1]["status"] == "pending"

    r1 = mid["reports"][1]
    done = client.patch(
        f"/api/v1/agents/fleet/{data['fleetId']}/member",
        json={
            "name": r1["name"],
            "status": "done",
            "summary": "step2",
            "runId": r1["runId"],
            "jobId": r1["jobId"],
        },
    )
    assert done.status_code == 200
    assert done.json().get("awaitingHumanMerge") is True


def test_fleet_synthesis_auto_enqueue():
    pid = _project_id()
    created = client.post(
        "/api/v1/agents/fleet",
        json={
            "projectId": pid,
            "mode": "synthesis",
            "mergePolicy": "semantic_repair",
            "synthesisAgentId": "orch.writing",
            "members": [
                {"name": "a", "task": "探索 A", "agentId": "orch.writing"},
                {"name": "b", "task": "探索 B", "agentId": "orch.writing"},
            ],
        },
    )
    assert created.status_code == 200
    data = created.json()
    fleet_id = data["fleetId"]
    assert data["state"]["enqueuedIndexes"] == [0, 1]

    for r in data["state"]["reports"]:
        res = client.patch(
            f"/api/v1/agents/fleet/{fleet_id}/member",
            json={
                "name": r["name"],
                "status": "done",
                "summary": f"{r['name']} done",
                "runId": r["runId"],
                "jobId": r["jobId"],
            },
        )
        assert res.status_code == 200
    final = res.json()
    assert final.get("synthesisJobId"), "synthesis+semantic_repair must enqueue synthesis"
    assert final.get("mergeMarkdown")
    assert final.get("mergedArtifactId")


def test_fleet_list_by_project():
    pid = _project_id()
    created = client.post(
        "/api/v1/agents/fleet",
        json={
            "projectId": pid,
            "mode": "union",
            "mergePolicy": "human",
            "members": [{"name": "only", "task": "t", "agentId": "orch.writing"}],
        },
    )
    assert created.status_code == 200
    fleet_id = created.json()["fleetId"]
    listed = client.get(f"/api/v1/agents/fleets?projectId={pid}")
    assert listed.status_code == 200
    body = listed.json()
    assert body["count"] >= 1
    assert any(f["planId"] == fleet_id for f in body["fleets"])


def test_fleet_max_members():
    pid = _project_id()
    res = client.post(
        "/api/v1/agents/fleet",
        json={
            "projectId": pid,
            "mode": "union",
            "members": [
                {"name": f"m{i}", "task": f"t{i}", "agentId": "orch.writing"} for i in range(5)
            ],
        },
    )
    assert res.status_code == 400


def test_fleet_workdir_namespace():
    from app.routers.agents_catalog import _fleet_workdir

    path = _fleet_workdir("proj1", "fleet_abc", "char/A!")
    assert path.startswith("/memories/projects/proj1/fleet/fleet_abc/")
    assert "!" not in path


def test_fleet_confirm_rejects_when_not_ready():
    put_fleet_state(
        "fleet_not_ready",
        {"planId": "fleet_not_ready", "reports": [], "mode": "ordered"},
    )
    res = client.post(
        "/api/v1/agents/fleet/fleet_not_ready/confirm-merge",
        json={"accept": True},
    )
    assert res.status_code == 400


def test_approve_proposal_creates_run_and_job():
    pid = _project_id()
    with Session(engine) as session:
        prop = TaskProposal(
            id=new_id(),
            type="colleague.proactive",
            message="补一段大纲",
            project_id=pid,
            actions=[{"type": "agent.run", "agentId": "orch.writing", "label": "开跑", "needsApproval": True, "actionId": "a1"}],
            status="pending",
        )
        session.add(prop)
        session.commit()
        prop_id = prop.id

    res = client.post(f"/api/v1/task-proposals/{prop_id}/approve")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "approved"
    assert body.get("runId")
    assert body.get("jobId")

    with Session(engine) as session:
        run = session.get(AgentRun, body["runId"])
        job = session.get(Job, body["jobId"])
        assert run is not None
        assert job is not None
        assert job.result_ref == run.id
        assert job.payload.get("runId") == run.id
        assert job.payload.get("fromProposal") == prop_id


def test_fleet_roster_persists_identity_task_and_namespace():
    response = client.post('/api/v1/agents/fleet', json={
        'projectId': _project_id(), 'mode': 'union', 'members': [
            {'name': '主角', 'task': '设计主角', 'agentId': 'char.bio_manju'},
            {'name': '配角', 'task': '设计配角', 'agentId': 'char.bio_manju'},
            {'name': '标题', 'task': '拟标题', 'agentId': 'topic.logline_title'},
        ]})
    assert response.status_code == 200
    fleet = response.json()
    reports = client.get(f"/api/v1/agents/fleet/{fleet['fleetId']}").json()['reports']
    assert len(reports) == 3
    assert [r['agentId'] for r in reports] == ['char.bio_manju', 'char.bio_manju', 'topic.logline_title']
    assert [r['task'] for r in reports] == ['设计主角', '设计配角', '拟标题']
    assert len({r['workdir'] for r in reports}) == 3


def test_pa_fleet_defaults_parallel_and_keeps_individual_tasks(monkeypatch):
    import asyncio
    from app.models import Conversation
    from app.routers import personal_agent as pa
    with Session(engine) as session:
        conv = Conversation(project_id=_project_id(), user_id="00000000-0000-4000-8000-000000000001")
        session.add(conv)
        session.commit()
        text, detail = asyncio.run(pa._execute_supervisor_tool('create_fleet', {
            'goal': '三人独立构思', 'members': [
                {'name': '主角', 'agent_id': 'char.bio_manju', 'task': '设计主角'},
                {'name': '配角', 'agent_id': 'char.bio_manju', 'task': '设计配角'},
                {'name': '标题', 'agent_id': 'topic.logline_title', 'task': '拟标题'},
            ]}, session, conv))
    assert detail['state']['mode'] == 'union'
    assert detail['state']['enqueuedIndexes'] == [0, 1, 2]
    assert [r['task'] for r in detail['state']['reports']] == ['设计主角', '设计配角', '拟标题']
    assert '3 名成员' in text


def test_pa_fleet_rejects_oversize_without_silently_dropping_members(monkeypatch):
    import asyncio
    from app.models import Conversation
    from app.routers import personal_agent as pa
    pid = _project_id()
    with Session(engine) as session:
        conv = Conversation(project_id=pid, user_id="00000000-0000-4000-8000-000000000001")
        session.add(conv)
        session.commit()
        text, detail = asyncio.run(pa._execute_supervisor_tool('create_fleet', {
            'goal': '构思', 'members': ['orch.writing'] * 5}, session, conv))
        assert not list(session.exec(select(AgentRun).where(AgentRun.project_id == pid)))
    assert not detail.get('ok')
    assert '4' in text


def test_parallel_callbacks_keep_all_reports(monkeypatch):
    import copy
    import time
    from concurrent.futures import ThreadPoolExecutor
    from app.routers import agents_catalog as catalog
    stored = {'mode': 'union', 'mergePolicy': 'human', 'reports': [
        {'index': i, 'name': str(i), 'status': 'pending'} for i in range(3)]}
    def read(_):
        snapshot = copy.deepcopy(stored)
        time.sleep(0.03)
        return snapshot
    def write(_, state):
        stored.clear()
        stored.update(copy.deepcopy(state))
    monkeypatch.setattr(catalog, 'get_fleet_state', read)
    monkeypatch.setattr(catalog, 'put_fleet_state', write)
    monkeypatch.setattr(catalog, '_sync_fleet_artifact', lambda *args: None)
    def complete(i):
        return catalog.patch_fleet_member('concurrent', catalog.FleetMemberPatchIn(index=i, status='done'), None)
    with ThreadPoolExecutor(max_workers=3) as executor:
        list(executor.map(complete, range(3)))
    assert [r['status'] for r in stored['reports']] == ['done'] * 3
    assert stored['awaitingHumanMerge'] is True


def test_fleet_accepts_established_virtual_colleague_id():
    response = client.post('/api/v1/agents/fleet', json={
        'projectId': _project_id(), 'members': [
            {'name': '标题', 'task': '拟标题', 'agentId': 'agent:topic.logline_title'}]})
    assert response.status_code == 200
    assert response.json()['state']['reports'][0]['agentId'] == 'topic.logline_title'


def test_ordered_callback_cannot_complete_unadmitted_future_member():
    fleet = _ordered_three()
    response = client.patch(f"/api/v1/agents/fleet/{fleet['fleetId']}/member",
                            json={'index': 2, 'status': 'done'})
    assert response.status_code == 409
    state = client.get(f"/api/v1/agents/fleet/{fleet['fleetId']}").json()
    assert state['reports'][2]['status'] == 'pending'
    assert state['enqueuedIndexes'] == [0]


def test_deferred_pump_waits_for_ordered_predecessor():
    from app.models import Artifact
    from app.routers.agents_catalog import pump_deferred_fleets
    fleet = _ordered_three()
    state = fleet['state']
    state['deferredIndexes'] = [2]
    put_fleet_state(fleet['fleetId'], state)
    with Session(engine) as session:
        artifact = session.get(Artifact, state['artifactId'])
        artifact.body_json = state
        session.add(artifact)
        session.commit()
        pump_deferred_fleets(session)
        assert session.get(Job, fleet['jobs'][2]['jobId']).status == 'blocked'


@pytest.mark.parametrize('tool,args', [
    ('run_agent', {'agent_id': 'topic.logline_title', 'instruction': '拟标题'}),
    ('create_fleet', {'goal': '构思', 'members': ['topic.logline_title']}),
    ('subagent_spawn', {'role': 'worker', 'task': '构思'}),
])
def test_busy_governor_dispatch_still_creates_durable_jobs(monkeypatch, tool, args):
    import asyncio
    from app import llm_governor
    from app.models import Conversation
    from app.routers import personal_agent as pa
    monkeypatch.setattr(llm_governor, 'should_defer_pa_writing', lambda: True)
    pid = _project_id()
    with Session(engine) as session:
        conv = Conversation(project_id=pid, user_id='00000000-0000-4000-8000-000000000001')
        session.add(conv)
        session.commit()
        text, detail = asyncio.run(pa._execute_supervisor_tool(tool, args, session, conv))
        jobs = list(session.exec(select(Job).where(Job.project_id == pid)))
        assert len(jobs) == 1, (text, detail)
        reported_id = detail['jobs'][0]['jobId'] if tool == 'create_fleet' else detail['job_id']
        assert reported_id == jobs[0].id


@pytest.mark.asyncio
@pytest.mark.parametrize('runtime', ['chief', 'bot'])
async def test_explicit_parallel_fleet_routes_before_confirmation(monkeypatch, runtime):
    import json
    from types import SimpleNamespace
    from app import bot_registry, bot_runtime
    from app.models import Bot, Conversation, Message
    from app.routers import personal_agent as pa
    pid = _project_id()
    request = '当前项目三项互不依赖，请使用协作编组并行，不要另建守护任务组。'
    async def chat(*args, **kwargs):
        assert 'create_fleet' in {t['function']['name'] for t in kwargs['tools']}
        return SimpleNamespace(content='', tool_calls=[{'id':'dispatch', 'function': {
            'name':'start_async_task', 'arguments':json.dumps({'project_id':pid,'goal':'构思','tasks':[
                {'project_id':pid,'agent_id':'topic.logline_title','instruction':'拟标题','label':'标题'},
                {'project_id':pid,'agent_id':'char.bio_manju','instruction':'设计主角','label':'人设'},
            ]})}}], model='test', prompt_tokens=1, completion_tokens=1, raw={'choices':[{'finish_reason':'stop'}]})
    events=[]
    async def emit(name,data): events.append((name,data))
    monkeypatch.setattr(pa,'chat_completion',chat)
    monkeypatch.setattr(bot_runtime,'chat_completion',chat)
    monkeypatch.setattr(bot_registry,'seed_system_bots',lambda *args: [])
    monkeypatch.setattr(bot_registry,'get_bot',lambda *args: None)
    monkeypatch.setattr(pa,'_core_facts_block',lambda *args:'')
    monkeypatch.setattr(bot_runtime,'build_bot_system_prompt',lambda *args:('system',[]))
    monkeypatch.setattr(pa,'_append_run_step',lambda *args,**kwargs:None)
    with Session(engine) as session:
        conv=Conversation(project_id=pid,user_id='test')
        session.add(conv);session.commit()
        session.add(Message(conversation_id=conv.id,role='user',content=request));session.commit()
        if runtime=='chief':
            await pa._run_supervisor_impl(session,conv,emit)
        else:
            await bot_runtime._run_bot_turn_impl(session,conv,Bot(id='chief',name='总编',trust_level=1),emit,skip_inbox=True)
        confirm=next(data for name,data in events if name=='confirm')
        assert confirm['tool']=='create_fleet'
        assert confirm['args']['mode']=='union'
        assert [m['task'] for m in confirm['args']['members']]==['拟标题','设计主角']
        assert not list(session.exec(select(Job).where(Job.project_id==pid)))


def test_fleet_routing_refuses_dependent_or_cross_project_tasks():
    from app.routers import personal_agent as pa
    for task in [
        {'project_id':'other','agent_id':'topic.logline_title','instruction':'拟标题'},
        {'project_id':'p','agent_id':'topic.logline_title','instruction':'拟标题','depends_on':[0]},
    ]:
        name,args=pa._route_collaboration_tool('start_async_task',{'tasks':[task]},
            project_id='p',user_text='互不依赖，请用协作编组，不另建守护任务组')
        assert name=='create_fleet'
        assert args['_routing_error']
        assert pa._requires_confirm(name,args) is None
    original={'tasks':[{'project_id':'p','agent_id':'topic.logline_title','depends_on':[0]}]}
    assert pa._route_collaboration_tool('start_async_task',original,project_id='p',
        user_text='跨阶段按依赖启动后台任务组')==('start_async_task',original)


@pytest.mark.asyncio
@pytest.mark.parametrize('dependent', [False, True])
async def test_direct_taskgroup_dispatch_honors_explicit_fleet_request(dependent):
    from app.models import AsyncTaskGroup, Conversation, Message
    from app.routers import personal_agent as pa
    pid = _project_id()
    with Session(engine) as session:
        conv = Conversation(project_id=pid, user_id='test')
        session.add(conv); session.commit()
        session.add(Message(conversation_id=conv.id, role='user',
                            content='当前项目用协作编组并行，任务互不依赖，不要另建守护任务组'))
        session.commit()
        task = {'project_id':pid,'agent_id':'topic.logline_title','instruction':'拟标题'}
        if dependent:
            task['depends_on']=[0]
        text,detail=await pa._execute_supervisor_tool('start_async_task',{'tasks':[task]},session,conv)
        assert not list(session.exec(select(AsyncTaskGroup).where(AsyncTaskGroup.conversation_id==conv.id)))
        jobs=list(session.exec(select(Job).where(Job.project_id==pid)))
        if dependent:
            assert not jobs
            assert detail['error']=='fleet_route_mismatch'
        else:
            assert len(jobs)==1
            assert detail['state']['mode']=='union'
            assert detail['state']['reports'][0]['task']=='拟标题'
