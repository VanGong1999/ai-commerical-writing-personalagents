from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine
from starlette.testclient import TestClient

from app.db import get_session
from app.main import api, app
from app.models import AgentRun, Conversation, Job, Project, ProjectStageEvent, RunStep, new_id, utcnow
from app.seed import DEMO_USER

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
SQLModel.metadata.create_all(engine)
client = TestClient(app)


def override_session():
    with Session(engine) as session:
        yield session


@pytest.fixture(autouse=True)
def _use_test_session():
    api.dependency_overrides[get_session] = override_session
    yield
    api.dependency_overrides.pop(get_session, None)


def test_project_and_run_replay_include_studio_steps():
    pid = new_id()
    rid = new_id()
    with Session(engine) as session:
        session.add(
            Project(
                id=pid,
                user_id=DEMO_USER,
                title="回放测试",
                format="manju",
                stage="S1_HOOK_BATCH",
            )
        )
        session.add(
            AgentRun(
                id=rid,
                project_id=pid,
                agent_id="topic.core_hook_batch",
                status="succeeded",
                output_artifact_ids=["a1"],
                finished_at=utcnow(),
            )
        )
        session.add(
            ProjectStageEvent(
                project_id=pid,
                from_stage="S0_SETUP",
                to_stage="S1_HOOK_BATCH",
                actor="user",
                reason="test",
            )
        )
        session.add(
            RunStep(
                conversation_id=f"project:{pid}",
                run_id=rid,
                seq=1,
                actor="agent:topic.core_hook_batch",
                kind="tool_call",
                payload={"name": "artifact_create"},
            )
        )
        session.commit()

    project = client.get(f"/api/v1/projects/{pid}/replay").json()
    assert project["projectId"] == pid
    assert project["runCount"] == 1
    assert project["stepCount"] >= 1
    kinds = {e["kind"] for e in project["events"]}
    assert "stage" in kinds
    assert "run_start" in kinds
    assert "run_end" in kinds
    assert "step:tool_call" in kinds

    run = client.get(f"/api/v1/runs/{rid}/replay").json()
    assert run["run"]["id"] == rid
    assert len(run["steps"]) >= 1
    assert run["steps"][0]["payload"]["name"] == "artifact_create"


def test_append_run_step_uses_project_pseudo_conversation():
    pid = new_id()
    rid = new_id()
    with Session(engine) as session:
        session.add(
            Project(
                id=pid,
                user_id=DEMO_USER,
                title="伪会话",
                format="manju",
                stage="S0_SETUP",
            )
        )
        session.add(
            AgentRun(
                id=rid,
                project_id=pid,
                agent_id="char.bio_manju",
                status="running",
            )
        )
        job = Job(type="agent.run",user_id=DEMO_USER,project_id=pid,result_ref=rid,payload={"agentId":"char.bio_manju"})
        session.add(job)
        session.commit()
        jid = job.id

    res = client.post(
        f"/api/v1/runs/{rid}/steps",
        json={"job_id":jid, "kind":"tool_call", "payload":{"name":"bible_read"}},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["conversationId"] == f"project:{pid}"


def test_empty_run_replay_does_not_include_other_run_steps():
    pid, run_a, run_b = new_id(), new_id(), new_id()
    with Session(engine) as session:
        session.add(Project(id=pid,user_id=DEMO_USER,title="剧本",format="manju",stage="setup"))
        session.add(Conversation(id="shared",user_id=DEMO_USER,project_id=pid))
        session.add(AgentRun(id=run_a, project_id=pid, conversation_id='shared', agent_id='a', status='succeeded'))
        session.add(AgentRun(id=run_b, project_id=pid, conversation_id='shared', agent_id='b', status='queued'))
        session.add(RunStep(conversation_id='shared', run_id=run_a, seq=1, kind='tool_call', payload={'name': 'other-run'}))
        session.commit()
    response = client.get(f'/api/v1/runs/{run_b}/replay')
    assert response.status_code == 200
    assert response.json()['steps'] == []


def test_child_terminal_is_first_writer_wins_per_parent_and_child():
    from app.routers.jobs import append_run_step, RunStepIn, get_run_replay
    rid = new_id()
    with Session(engine) as session:
        pid = new_id()
        session.add(Project(id=pid,user_id=DEMO_USER,title="剧本",format="manju",stage="setup"))
        session.add(AgentRun(id=rid,project_id=pid,agent_id="orch.writing"))
        job = Job(type="agent.run",user_id=DEMO_USER,project_id=pid,result_ref=rid,payload={"agentId":"orch.writing"})
        session.add(job)
        session.commit()
        child = "nested_" + rid + "_1_child_run"
        append_run_step(rid,RunStepIn(job_id=job.id,kind="subagent",payload={"phase":"admitted",
            "spawning_run_id":rid,"spawned_run_id":child,"agent_id":"char.bio_manju"}),session)
        for status in ["succeeded", "cancelled"]:
            append_run_step(rid, RunStepIn(job_id=job.id,actor="agent:char.bio_manju",kind="run_end", payload={
                "child_run_id":child, "parent_run_id":rid, "status":status,"event_id":"child:run_end",
            }),session)
        append_run_step(rid,RunStepIn(job_id=job.id,kind="subagent",payload={"status":"succeeded",
            "spawning_run_id":rid,"spawned_run_id":child}),session)
        with pytest.raises(HTTPException) as forged:
            append_run_step(rid,RunStepIn(job_id=job.id,kind="subagent",payload={"status":"failed",
                "spawning_run_id":rid,"spawned_run_id":child}),session)
        assert forged.value.status_code == 409
        steps = get_run_replay(rid, session)["steps"]
        assert [s["payload"]["status"] for s in steps if s["kind"]=="run_end"] == ["succeeded"]


def test_replay_and_step_writes_match_owner_job_conversation_and_actor():
    pid,foreign,conv,other_conv,rid,other_run,jid,other_job = [new_id() for _ in range(8)]
    with Session(engine) as s:
        for project,owner,cid,run,job,actor in [(pid,DEMO_USER,conv,rid,jid,"own"),(foreign,"OTHER",other_conv,other_run,other_job,"theirs")]:
            s.add(Project(id=project,user_id=owner,title=project,format="manju",stage="setup"))
            s.add(Conversation(id=cid,user_id=owner,project_id=project))
            s.add(AgentRun(id=run,project_id=project,conversation_id=cid,agent_id=actor))
            s.add(Job(id=job,type="agent.run",project_id=project,conversation_id=cid,
                      result_ref=run,payload={"agentId":actor}, user_id=owner))
        s.add(RunStep(run_id=other_run,conversation_id=other_conv,kind="tool_result",seq=1,payload={"text":"FOREIGN-SOURCE"}))
        s.commit()
    for url in [f'runs/{other_run}/replay',f'projects/{foreign}/replay']:
        response = client.get('/api/v1/' + url)
        assert response.status_code == 404 and 'FOREIGN-SOURCE' not in response.text
    body = {"job_id":jid,"actor":"own","kind":"tool_result","payload":{"text":"allowed"}}
    for target, override in [(other_run,{"job_id":other_job}),(rid,{"job_id":other_job}),(rid,{"conversation_id":other_conv}),
                             (rid,{"actor":"theirs"}),(rid,{"payload":{"child_run_id":"forged","parent_run_id":rid}})]:
        assert client.post(f'/api/v1/runs/{target}/steps',json={**body,**override}).status_code in (403,404)
    assert client.get(f'/api/v1/runs/{rid}/replay').json()['steps'] == []
    assert client.post(f'/api/v1/runs/{rid}/steps',json=body).status_code == 200
