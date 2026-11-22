import asyncio
import json
import os
import tempfile
import subprocess
from pathlib import Path
from datetime import datetime, timedelta, timezone

import pytest
from sqlmodel import Session, SQLModel, create_engine, select

from app.agent_inbox import conversation_owner
from app.group_router import _run_pipeline
from app.models import Conversation, Message, Project
from app.seed import DEMO_USER


@pytest.fixture
def studio(tmp_path):
    engine = create_engine("sqlite:///" + str(tmp_path / "pipeline.db"))
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        project = Project(user_id=DEMO_USER, title="示例", format="manju", stage="S0")
        conv = Conversation(user_id=DEMO_USER, project_id=project.id, kind="group",
                            group_rules={"stages": [{"id": "select", "requiresUserAck": True}]})
        session.add_all([project, conv])
        session.commit()
        yield session, conv


async def quiet(*args):
    pass


def tick(session, conv, members=(), budget=2, goal="男频漫剧"):
    async def run():
        async with conversation_owner(session, conv.id):
            return await _run_pipeline(session, conv, list(members), quiet, claimed_events=None,
                                       user_text=goal, max_rounds=budget)
    return asyncio.run(run())


def test_empty_gate_is_durable_before_return(studio):
    session, conv = studio
    tick(session, conv)
    with Session(session.get_bind()) as reader:
        rules = reader.get(Conversation, conv.id).group_rules
        assert rules["pipeline_execution"]["status"] == "waiting_ack"
        assert reader.get(Message, rules["pipeline_execution"]["ackMessageId"]).actions[0]["stageId"] == "select"


def configure(session, conv, stages, ids=()):
    from app.agent_colleagues import get_virtual_bot
    conv.group_rules = {"speak_policy": "pipeline", "stages": stages}
    conv.member_bot_ids = list(ids)
    session.add(conv)
    session.commit()
    return [get_virtual_bot(i) for i in ids]


def checkpoint(conv):
    return conv.group_rules["pipeline_execution"]


@pytest.fixture
def local_queue(monkeypatch):
    from app.routers import assistant, agents_catalog
    sent = []
    for mod in (assistant, agents_catalog):
        monkeypatch.setattr(mod, "enqueue_job", lambda jid, payload: sent.append(jid))
        monkeypatch.setattr(mod, "publish_job_event", lambda *args: None)
    monkeypatch.setattr(agents_catalog, "put_fleet_state", lambda *args: None)
    monkeypatch.setattr("app.llm_governor.slots_available", lambda **kwargs: True)
    return sent


def finish(session, conv, index=0):
    from app.models import AgentRun, Artifact, Job
    child = checkpoint(conv)["inflight"][index]
    run = session.get(AgentRun, child["runId"])
    job = session.get(Job, child["jobId"])
    art = Artifact(project_id=conv.project_id, title="候选", type="core_hook", created_by_run_id=run.id,
                   body_markdown="只有本次产物的素材")
    run.status = job.status = "succeeded"
    run.receipt_id = "receipt_" + run.id
    run.output_artifact_ids = [art.id]
    run.gate_results = [dict(type="receipt", receipt=dict(status="succeeded", runId=run.id,
                             attestation="fixture", outputVersions={art.id: 1}))]
    session.add_all([art, run, job])
    session.commit()
    return art


def respond(session, conv, mid, yes, **kwargs):
    from app.routers.personal_agent import respond_conversation_impl
    return asyncio.run(respond_conversation_impl(session, conv, approve=yes, message_id=mid, **kwargs))


def test_bound_gate_reject_resume_and_duplicate(studio):
    session, conv = studio
    configure(session, conv, [{"id":"select","requiresUserAck":True,"next":["bio"]},
                              {"id":"bio","requiresUserAck":True}])
    tick(session, conv)
    mid = checkpoint(conv)["ackMessageId"]
    assert not respond(session, conv, None, True)["ok"]
    assert respond(session, conv, mid, False)["ok"]
    tick(session, conv)
    assert checkpoint(conv)["status"] == "rejected"
    tick(session, conv, goal="重新申请确认")
    fresh = checkpoint(conv)["ackMessageId"]
    assert fresh != mid and not respond(session, conv, mid, True)["ok"]
    assert respond(session, conv, fresh, True, edited_args={"note":"第一梗"})["ok"]
    assert checkpoint(conv)["status"] == "waiting_ack"
    assert checkpoint(conv)["stageId"] == "bio" and not respond(session, conv, fresh, True)["ok"]
    second = checkpoint(conv)["ackMessageId"]
    pending = session.get(Message, second)
    pending.actions = [{**pending.actions[0],"executionId":"different"}]
    session.commit()
    assert not respond(session, conv, second, True)["ok"]


def test_ordered_restart_waits_for_versioned_child(studio, local_queue):
    from app.models import AgentRun, ArtifactVersion
    session, conv = studio
    ids = ["topic.market_brief","topic.genre_trim","topic.core_hook_batch"]
    members = configure(session, conv, [{"id":"start","agentIds":ids, "next":["last"]},
                                        {"id":"unreached","requiresUserAck":True},
                                        {"id":"last","requiresUserAck":True}], ids)
    tick(session, conv, members)
    first = checkpoint(conv)["inflight"][0]
    tick(session, conv, members)
    assert len(local_queue)==1
    run = session.get(AgentRun, first["runId"])
    run.status = "failed"
    session.commit()
    tick(session, conv, members)
    assert checkpoint(conv)["memberPosition"] == 0 and "failed" in checkpoint(conv)["detail"]
    art = finish(session, conv)
    original = art.body_markdown
    session.add(ArtifactVersion(artifact_id=art.id, version=1, title=art.title, status="draft",body_markdown=original))
    art.body_markdown = "用户后续编辑"
    art.version = 2
    session.add_all([art, Message(conversation_id=conv.id,role="user",content="无关历史")])
    session.commit()
    with Session(session.get_bind()) as recovered:
        resumed = recovered.get(Conversation, conv.id)
        tick(recovered, resumed, members, goal="继续")
        cp = checkpoint(resumed)
        assert cp["memberPosition"] == 1 and cp["completed"][0]["runId"] == first["runId"]
        prompt = recovered.get(AgentRun, cp["inflight"][0]["runId"]).input_json["assistantPrompt"]
        assert original in prompt and art.id in prompt and "男频漫剧" in prompt
        assert "用户后续编辑" not in prompt and "无关历史" not in prompt
        finish(recovered, resumed)
        tick(recovered, resumed, members)
        assert checkpoint(resumed)["inflight"][0]["memberId"] == ids[2]
        finish(recovered, resumed)
        tick(recovered, resumed, members)
        assert checkpoint(resumed)["stageId"] == "last"
        assert len(local_queue) == 3


def test_discussion_round_budget_and_errors(studio, monkeypatch):
    from app.models import Bot
    session, conv = studio
    ids = ["reader","editor","writer"]
    configure(session, conv, [{"id":"A","memberBotIds":ids,"discussionMemberIds":ids}], ids=())
    bots = [Bot(id=i,name=i,owner_user_id=DEMO_USER) for i in ids]
    sent = []
    fail = True
    async def discuss(session, conv, bot, emit, **kwargs):
        assert kwargs["discussion_prompt"] and kwargs["skip_inbox"]
        sent.append(bot.id)
        if bot.id == "writer" and fail:
            await emit("error", {"message":"错误"})
            return "LLM 调用失败"
        session.add(Message(conversation_id=conv.id, bot_id=bot.id, role="assistant", content=bot.id,
                            actions=[dict(type="pipeline_discussion", discussionId=kwargs["discussion_id"])]))
        session.commit()
        await emit("done", {"reply":bot.id})
        return bot.id
    monkeypatch.setattr("app.bot_runtime.run_bot_turn", discuss)
    tick(session, conv, bots, budget=2)
    assert sent == ids[:2] and checkpoint(conv)["status"] == "yielded"
    tick(session, conv, bots)
    assert checkpoint(conv)["memberPosition"] == 2 and checkpoint(conv)["status"] == "blocked"
    fail = False
    tick(session, conv, bots)
    tick(session, conv, bots)
    assert sent == ["reader","editor","writer","writer"] and checkpoint(conv)["status"] == "completed"


def test_union_bounded_and_uses_only_pre_stage_inputs(studio, local_queue):
    from app.models import AgentRun
    session, conv = studio
    ids = ["topic.market_brief","topic.genre_trim","topic.core_hook_batch"]
    members = configure(session, conv, [{"id":"U","mode":"union","agentIds":ids,"next":["H"]},
                                        {"id":"H","requiresUserAck":True}], ids)
    tick(session, conv, members)
    first = checkpoint(conv)["inflight"]
    assert len(local_queue)==2 and first[0]["fleetId"] == first[1]["fleetId"]
    finish(session, conv, 1)
    tick(session, conv, members)
    assert len(local_queue)==2 and checkpoint(conv)["memberPosition"] == 0
    finish(session, conv, 0)
    tick(session, conv, members)
    child = checkpoint(conv)["inflight"][0]
    assert child["memberId"] == ids[2] and child["fleetId"] != first[0]["fleetId"]
    assert session.get(AgentRun, child["runId"]).input_json["upstreamArtifacts"] == []
    finish(session, conv)
    tick(session, conv, members)
    assert len(local_queue)==3 and checkpoint(conv)["stageId"]=="H"


@pytest.mark.parametrize("stages,reason", [
    ([{"id":"A","next":["missing"]}], "后继不存在"),
    ([{"id":"A","mode":"synthesis"}], "尚不支持"),
    ([{"id":"A","agentIds":["unknown"]}], "缺失"),
    ([{"id":"A"}], "缺少必需成员"),
    ([{"id":"A"},{"id":"A"}], "重复"),
    ([], "阶段配置"),
])
def test_invalid_stages_stop(studio, stages, reason):
    session, conv = studio
    configure(session, conv, stages)
    tick(session, conv)
    assert checkpoint(conv)["status"]=="blocked" and reason in checkpoint(conv)["detail"]


def test_cycle_and_exact_branch(studio):
    session, conv = studio
    configure(session, conv, [{"id":"A","requiresUserAck":True,"next":["A","B"]},
                              {"id":"B","requiresUserAck":True}])
    tick(session, conv)
    assert respond(session, conv, checkpoint(conv)["ackMessageId"], True)["ok"]
    assert checkpoint(conv)["status"] == "branch_choice"
    tick(session, conv, goal="选择 A")
    assert "循环" in checkpoint(conv)["detail"]
    tick(session, conv)
    tick(session, conv, goal="选择 B")
    assert checkpoint(conv)["stageId"] == "B"


def test_stale_lease_or_foreign_project_cannot_advance(studio):
    from app.agent_inbox import LostInboxLease
    from app.models import InboxLease
    session, conv = studio
    async def stale():
        async with conversation_owner(session, conv.id):
            lease = session.get(InboxLease, conv.id)
            from sqlalchemy import update
            session.execute(update(InboxLease).where(InboxLease.conversation_id==conv.id).values(token="someone_else"))
            session.commit()
            await _run_pipeline(session, conv, [], quiet, claimed_events=None, user_text="goal",max_rounds=2)
    with pytest.raises(LostInboxLease):
        asyncio.run(stale())
    assert "pipeline_execution" not in conv.group_rules
    session.delete(session.get(InboxLease, conv.id))
    project = session.get(Project,conv.project_id)
    project.user_id = "other"
    session.commit()
    tick(session, conv)
    assert "pipeline_execution" not in conv.group_rules


def test_dispatch_crash_after_commit_and_legacy_reconcile(studio, local_queue, monkeypatch):
    from app.routers import assistant
    session, conv = studio
    ids = ["topic.market_brief"]
    members = configure(session, conv, [{"id":"A","agentIds":ids}], ids)
    def crash(jid, payload):
        with Session(session.get_bind()) as fresh:
            visible = fresh.get(Conversation, conv.id)
            assert checkpoint(visible)["inflight"][0]["jobId"] == jid
        raise OSError("broker connection lost")
    monkeypatch.setattr(assistant,"enqueue_job",crash)
    with pytest.raises(OSError): tick(session, conv, members)
    tick(session, conv, members)
    assert len(checkpoint(conv)["inflight"])==1
    conv.group_rules = {"stages":[{"id":"old"}],"pipeline_cursor":1,"ack:old":True}
    session.commit()
    tick(session,conv)
    assert checkpoint(conv)["status"]=="blocked" and not checkpoint(conv)["completed"]


def test_group_parent_done_only_after_checkpoint(studio, local_queue, monkeypatch):
    from app import chief_runner
    from app.agent_inbox import submit_event
    from app.models import AgentEvent, Job, ThreadSubscription
    session, conv = studio
    ids = ["topic.market_brief"]
    configure(session, conv, [{"id":"P","agentIds":ids}], ids)
    event = submit_event(session, conversation_id=conv.id, source="web", payload={"message":"我的原创目标","project_id":conv.project_id})
    real_mark_done = chief_runner.mark_done
    def checked(sess, events, **kwargs):
        with Session(sess.get_bind()) as reader:
            state = checkpoint(reader.get(Conversation,conv.id))
            assert state["goal"] == "我的原创目标"
            child = state["inflight"][0]
            assert reader.get(Job, child["jobId"]).result_ref == child["runId"]
            assert reader.exec(select(ThreadSubscription).where(ThreadSubscription.run_id == child["runId"])).one().mode == "wake"
            assert reader.get(AgentEvent,event.id).status=="processing"
        real_mark_done(sess,events,**kwargs)
    monkeypatch.setattr(chief_runner, "mark_done", checked)
    asyncio.run(chief_runner.run_conversation_turns(session,conv.id))
    assert event.status=="done" and checkpoint(conv)["status"]=="waiting_child"


def checklist_delivery(project_id, run_id, manuscript_id):
    worker = Path(__file__).resolve().parents[2] / "agent-worker"
    with tempfile.TemporaryDirectory() as directory:
        fixture = Path(__file__).with_name("fixtures") / "pipelineQaReceipt.mjs"
        output = subprocess.check_output(["node", str(fixture),
            project_id, run_id, manuscript_id], cwd=worker, text=True,
            env={**os.environ, "AGENT_SESSION_ROOT": directory})
    return json.loads(output.splitlines()[-1])


def test_batch_dispatcher_waits_for_real_group_and_every_child(studio, monkeypatch):
    from app.models import AgentRun, AsyncTaskGroup, Artifact, Job
    from app.pipeline_checkpoint import _collect, _version
    from app.routers import jobs
    monkeypatch.setattr(jobs, "enqueue_job", lambda *args:None)
    monkeypatch.setattr(jobs, "_maybe_announce_run", lambda *args:None)
    session, conv = studio
    project = session.get(Project,conv.project_id)
    stages = [{"id":"batch", "agentIds":["orch.batch_writer"]}]
    members = configure(session, conv, stages, ["orch.batch_writer"])
    state = dict(stageId="batch",executionId="X",projectId=project.id,topologyVersion=_version(stages),
                 memberPosition=0,visited=[],approvals=[],completed=[],status="waiting_child",goal="逐集审核")
    def completed(agent, data, group_id=None, deps=()):
        run = AgentRun(agent_id=agent, project_id=project.id, conversation_id=conv.id,
                       input_json=data, status="succeeded", task_group_id=group_id, depends_on_run_ids=list(deps))
        job = Job(type="agent.run",project_id=project.id,conversation_id=conv.id,user_id=conv.user_id,
                  result_ref=run.id,status="succeeded")
        versions = {}
        if deps:
            delivery = checklist_delivery(project.id, run.id, data["artifactIds"][0])
            row = delivery["art"]
            art = Artifact(id=row["id"], type=row["type"], title=row["title"], project_id=row["projectId"],
                           body_markdown=row["bodyMarkdown"], body_json=row["bodyJson"], version=row["version"],
                           created_by_run_id=row["createdByRunId"])
            session.add(art)
            result = delivery["result"]
            run.status = job.status = "running"
            run.lease_version = 1
            run.lease_until = datetime.now(timezone.utc) + timedelta(minutes=1)
            session.add_all([job, run])
            session.commit()
            jobs.patch_run_status(run.id, dict(leaseVersion=1, terminalJobId=job.id, status=result["status"],
                gateResults=result["gates"], outputArtifactIds=result["artifactIds"], receiptId=result["receiptId"],
                receipt={**result["receipt"],"exitReason":result["exitReason"],"outputVersions":result["outputVersions"]}),session)
            assert run.approval_state == "waiting"
            return run, job
        elif group_id:
            art=Artifact(type="manuscript",title=agent,body_markdown="实际交付",
                         project_id=project.id,created_by_run_id=run.id)
            session.add(art)
            run.output_artifact_ids = [art.id]
            versions[art.id]=1
        run.receipt_id="receipt_"+run.id
        run.gate_results=[dict(type="receipt",receipt=dict(runId=run.id,attestation="x",status="succeeded",outputVersions=versions))]
        session.add_all([run,job])
        return run, job
    parent, job = completed("orch.batch_writer",{"pipelineStageId":"batch","pipelineExecutionId":"X"})
    child = dict(memberId=parent.agent_id,runId=parent.id,jobId=job.id)
    group = AsyncTaskGroup(user_id=conv.user_id, conversation_id=conv.id, title="批次",
                           plan_json={"projectId":project.id,"dispatcherRunId":parent.id,"tasks":[
                               {"agent_id":"prose.episode_body","input_extra":{"episodeNo":1}},{"agent_id":"qc.human_checklist"}]})
    session.add(group)
    body, _ = completed("prose.episode_body", {"episodeNo":1},group.id)
    qa, _ = completed("qc.human_checklist",
        {"artifactIds":body.output_artifact_ids, "qaSourceVersions":{body.output_artifact_ids[0]:1}},group.id,[body.id])
    session.commit()
    assert _collect(session,conv,project,state,child)[0] is None and child["batchRunIds"]==[body.id,qa.id]
    group.status="completed"
    from app.routers.projects import logic_ack, LogicAckIn
    from fastapi import HTTPException
    conv.group_rules = {**conv.group_rules,"pipeline_execution":{**state,"inflight":[child]}}
    session.commit()
    tick(session, conv, members)
    assert checkpoint(conv)["status"] == "waiting_child"
    qa_cards = [ev for msg in session.exec(select(Message)) for ev in msg.evidence or [] if ev.get("kind") == "pipeline_qa"]
    assert qa_cards[-1]["reports"] == {qa.output_artifact_ids[0]:1}
    pid, qid = project.id,qa.id
    versions = {a.id:a.version for a in session.exec(select(Artifact))}
    session.commit()
    logic_ack(pid,session,LogicAckIn(expectedVersions=versions))
    for approval in ("none","waiting","rejected","approved"):
        qa.approval_state = approval
        session.commit()
        assert _collect(session,conv,project,state,child)[0] is None
        assert child["qaReview"]["reports"] == {qa.output_artifact_ids[0]: 1}
    session.commit()
    with pytest.raises(HTTPException):
        logic_ack(pid,session,LogicAckIn(expectedVersions={**versions,body.output_artifact_ids[0]:2},qaRunId=qid))
    session.rollback()
    logic_ack(pid,session,LogicAckIn(expectedVersions=versions,qaRunId=qid))
    receipt, wait = _collect(session,conv,project,state,child)
    assert wait is None and {r["type"] for r in receipt["artifacts"]} == {"manuscript","qc_report"}
    from app.chief_runner import run_conversation_turns
    asyncio.run(run_conversation_turns(session, conv.id))
    assert checkpoint(conv)["status"] == "completed"
    assert {r["type"] for r in checkpoint(conv)["completed"][0]["artifacts"]} == {"manuscript","qc_report"}
    manuscript = session.get(Artifact,body.output_artifact_ids[0])
    manuscript.version += 1
    manuscript.body_markdown = "作者另改的版本"
    session.commit()
    with pytest.raises(HTTPException):
        logic_ack(pid,session,LogicAckIn(expectedVersions={**versions,manuscript.id:2},qaRunId=qid))
    session.rollback()


def test_unrelated_confirmation_and_project_rebind(studio):
    from app.routers.personal_agent import chat_conversation
    from app.schemas import ChatConversationIn
    from fastapi import HTTPException
    session, conv = studio
    configure(session,conv,[{"id":"gate","requiresUserAck":True}])
    tick(session,conv)
    for owner, status in [(DEMO_USER,409),("other",404)]:
        p = Project(user_id=owner,title="other",format="manju",stage="S0")
        session.add(p)
        session.commit()
        with pytest.raises(HTTPException) as failure:
            asyncio.run(chat_conversation(conv.id,ChatConversationIn(message="继续",project_id=p.id),session))
        assert failure.value.status_code==status and checkpoint(conv)["projectId"]==conv.project_id


def test_auto_responder_never_widens_human_gate(studio, monkeypatch):
    from datetime import timedelta
    from app import confirm_autoresponder as ar
    from app.models import utcnow
    session, conv = studio
    tick(session,conv)
    msg = session.get(Message,checkpoint(conv)["ackMessageId"])
    msg.created_at = utcnow() - timedelta(hours=1)
    session.commit()
    monkeypatch.setattr(ar,"engine",session.get_bind())
    from types import SimpleNamespace
    monkeypatch.setattr(ar,"get_settings",lambda:SimpleNamespace(personal_agent_auto_respond=True,personal_agent_confirm_timeout_min=1))
    iterations=[]
    async def once(*args):
        if iterations:
            raise asyncio.CancelledError
        iterations.append(True)
    monkeypatch.setattr(ar.asyncio,"sleep",once)
    monkeypatch.setattr(ar.asyncio,"create_task",lambda _:pytest.fail("automatic approval attempted"))
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(ar._loop())
    assert session.get(Message,msg.id).actions[0]["type"]=="confirm_required"


def test_first_admission_cannot_be_rebound_before_drain(studio, local_queue):
    from fastapi import HTTPException
    from app.chief_runner import run_conversation_turns
    from app.agent_inbox import submit_event
    from app.models import AgentRun
    from app.routers.personal_agent import chat_conversation
    from app.schemas import ChatConversationIn
    session, conv = studio
    configure(session, conv, [{"id":"P","agentIds":["topic.market_brief"]}], ["topic.market_brief"])
    project_a = conv.project_id
    other = Project(user_id=DEMO_USER,title="B",format="manju",stage="S0")
    conv.project_id = None
    session.add(other)
    session.commit()
    asyncio.run(chat_conversation(conv.id,ChatConversationIn(message="ONLY_A", project_id=project_a),session))
    with pytest.raises(HTTPException) as err:
        asyncio.run(chat_conversation(conv.id,ChatConversationIn(message="ONLY_B",project_id=other.id),session))
    assert err.value.status_code==409
    submit_event(session,conversation_id=conv.id,source="web",payload={"message":"FOREIGN","project_id":other.id})
    asyncio.run(run_conversation_turns(session,conv.id))
    run=session.exec(select(AgentRun)).one()
    assert run.project_id==project_a and checkpoint(conv)["goal"]=="ONLY_A"


@pytest.mark.parametrize("names", [["unrelated"],["FormatSelected"],["ChunkPolicy"],["FormatSelected","ChunkPolicy"]])
def test_setup_requires_both_real_gate_receipts(studio,names):
    from app.models import AgentRun, Job
    from app.pipeline_checkpoint import PipelinePause, _read_receipt
    session,conv=studio
    project=session.get(Project,conv.project_id)
    run=AgentRun(agent_id="orch.writing",project_id=project.id,status="succeeded",receipt_id="proof")
    run.gate_results=[{"id":n,"result":"pass","evidence":dict(source="bound_project",projectId=project.id,format=project.format)} for n in names]+[dict(type="receipt",receipt=dict(
        runId=run.id,status="succeeded",attestation="fixture",outputVersions={}))]
    job=Job(type="agent.run",user_id=DEMO_USER,project_id=project.id,result_ref=run.id,status="succeeded")
    if len(names)==2:
        assert _read_receipt(session,project,run,job)[1] is None
    else:
        with pytest.raises(PipelinePause):
            _read_receipt(session,project,run,job)


@pytest.mark.parametrize("admitted",[0,1])
def test_union_crash_releases_remaining_original_jobs(studio,local_queue,monkeypatch,admitted):
    from app.routers import agents_catalog as fleet
    from app.models import Job
    session,conv=studio
    ids=["topic.genre_trim","topic.market_brief"]
    members=configure(session,conv,[dict(id="U",mode="union",agentIds=ids)],ids)
    enqueue=fleet._enqueue_fleet_job
    def fault(*args,**kwargs):
        if len(local_queue)==admitted: raise OSError("worker stopped during fleet release")
        return enqueue(*args,**kwargs)
    monkeypatch.setattr(fleet,"_enqueue_fleet_job",fault)
    monkeypatch.setattr(fleet,"get_fleet_state",lambda _:None)
    with pytest.raises(OSError):tick(session,conv,members)
    monkeypatch.setattr(fleet,"_enqueue_fleet_job",enqueue)
    with Session(session.get_bind()) as pump:
        fleet.pump_deferred_fleets(pump)
        fleet.pump_deferred_fleets(pump)
        jobs=pump.exec(select(Job)).all()
        assert len(local_queue)==len(set(local_queue))==len(jobs)==2
        assert all(j.status=="queued" for j in jobs)


def test_terminal_result_commits_job_run_and_replay_once(studio,monkeypatch):
    from app.models import AgentRun,Job
    from app.routers import jobs
    from fastapi import HTTPException
    session,conv=studio
    run=AgentRun(project_id=conv.project_id,conversation_id=conv.id,agent_id="topic.market_brief",status="running",lease_version=4,lease_until=datetime.now(timezone.utc)+timedelta(minutes=1))
    job=Job(project_id=conv.project_id,conversation_id=conv.id,type="agent.run",user_id=conv.user_id,result_ref=run.id,status="running")
    session.add_all([job,run])
    session.commit()
    body=dict(terminalJobId=job.id,leaseVersion=4,status="succeeded",outputArtifactIds=[],receiptId="r1",
              receipt=dict(runId=run.id,status="succeeded",attestation="a",outputVersions={}))
    monkeypatch.setattr(jobs,"_maybe_announce_run",lambda *a:None)
    monkeypatch.setattr(jobs,"enqueue_job",lambda *a:None)
    with pytest.raises(HTTPException):
        jobs.patch_run_status(run.id,{**body,"leaseVersion":3},session)
    jobs.patch_run_status(run.id,body,session)
    with Session(session.get_bind()) as recovered:
        assert recovered.get(Job,job.id).status=="succeeded"
        assert recovered.get(AgentRun,run.id).gate_results[-1]["receipt"]==body["receipt"]
        jobs.patch_run_status(run.id,body,recovered)
        assert len(recovered.exec(select(Job).where(Job.type=="run.digest")).all())==1


@pytest.mark.parametrize("preset", [False, True])
def test_projectless_pipeline_chat_admission(studio, monkeypatch, preset):
    from app import chief_runner, group_router
    from app.routers.personal_agent import chat_conversation
    from app.schemas import ChatConversationIn
    from fastapi import HTTPException
    session, conv = studio
    members = ["topic.market_brief"]
    configure(session, conv, [{"id":"P","agentIds":members}] if preset else [], members)
    conv.project_id = None
    session.commit()
    if preset:
        with pytest.raises(HTTPException) as exc:
            asyncio.run(chat_conversation(conv.id, ChatConversationIn(message="我的问题"), session))
        assert exc.value.status_code == 404
        return
    received = []
    async def chat(session, conv, bot, emit, *, claimed_events, skip_inbox):
        received.append((bot.id, claimed_events[0].payload["message"]))
        return "已回答"
    monkeypatch.setattr(group_router, "run_bot_turn", chat)
    asyncio.run(chat_conversation(conv.id, ChatConversationIn(message="我的问题"), session))
    asyncio.run(chief_runner.run_conversation_turns(session, conv.id))
    assert received == [("topic.market_brief", "我的问题")]
    assert conv.project_id is None and "pipeline_execution" not in conv.group_rules


def test_steer_after_saved_receipt_requeues_same_run_and_retains_instruction(studio, monkeypatch):
    from app.models import AgentRun, Job
    from app.routers import jobs, tasks
    session, conv = studio
    run = AgentRun(project_id=conv.project_id, conversation_id=conv.id, agent_id="topic.market_brief",
                   status="running", lease_version=4, lease_until=datetime.now(timezone.utc)+timedelta(minutes=1),
                   input_json={"assistantPrompt":"原指令"})
    job = Job(type="agent.run", project_id=conv.project_id,user_id=conv.user_id,result_ref=run.id,status="running")
    session.add_all([job,run])
    session.commit()
    queued = []
    monkeypatch.setattr(jobs, "enqueue_job", lambda jid, payload: queued.append(jid))
    monkeypatch.setattr(jobs, "_maybe_announce_run", lambda *args:None)
    monkeypatch.setattr(tasks, "request_interrupt", lambda *args:None)
    monkeypatch.setattr(tasks, "publish_task_event", lambda *args:None)
    receipt = {"attestation":"original", "status":"succeeded", "runId":run.id}
    terminal = {"status":"succeeded", "receiptId":"receipt_"+run.id, "receipt":receipt,
                "leaseVersion":4, "terminalJobId":job.id}
    tasks.update_run(run.id,tasks.UpdateRunIn(message="改成夜景",update_strategy="interrupt"),session)
    jobs.get_steer(run.id,session)  # Simulate worker loss immediately after reading the mailbox.
    jobs.patch_run_status(run.id,terminal,session)
    session.refresh(job)
    assert job.status == run.status == "queued" and queued == [job.id]
    replay = jobs.get_steer(run.id,session)
    assert replay["messages"] == [] and replay["inputJson"] == run.input_json
    assert "改成夜景" in run.input_json["assistantPrompt"] and not run.receipt_id
    run.status = job.status = "running"
    run.lease_version += 1
    run.lease_until = datetime.now(timezone.utc)+timedelta(minutes=1)
    session.commit()
    revised = {**terminal, "leaseVersion":run.lease_version, "steerRevision":run.input_json["steerRevision"],
               "receipt":{**receipt, "attestation":"revised"}}
    jobs.patch_run_status(run.id,revised,session)
    assert run.status == job.status == "succeeded" and run.gate_results[-1]["receipt"] == revised["receipt"]
    from fastapi import HTTPException
    from app.agent_inbox import submit_event, steer_mailbox
    with pytest.raises(HTTPException) as finished:
        submit_event(session, conversation_id=steer_mailbox(run.id), source="steer", payload={"message":"迟到"})
    assert finished.value.status_code == 409 and "迟到" not in run.input_json["assistantPrompt"]


@pytest.mark.parametrize("declared", [[], ["paused-member"], ["missing-member"]], ids=["empty", "inactive", "missing"])
def test_pipeline_chat_without_available_members(studio, monkeypatch, declared):
    from types import SimpleNamespace
    from app import group_router
    from app.models import Bot

    session, conv = studio
    conv.project_id = None
    conv.member_bot_ids = declared
    conv.group_rules = {"speak_policy": "pipeline"}
    session.add_all([
        Bot(id="paused-member", name="已停用成员", owner_user_id=conv.user_id, status="paused"),
        Bot(id="unrelated", name="未入群", owner_user_id=conv.user_id),
        Bot(id="other-owner", name="其他用户的同事", owner_user_id="another-user"),
    ])
    session.commit()
    calls = []
    events = []
    async def record_bot_call(session, conv, bot, emit, **kwargs):
        calls.append(bot.id)
        return "不应发言"
    async def record_event(event, data):
        events.append((event, data))
    monkeypatch.setattr(group_router, "run_bot_turn", record_bot_call)
    reply = asyncio.run(group_router.run_group_turn(session, conv, record_event,
        claimed_events=[SimpleNamespace(payload={"message":"组内消息"})]))
    assert calls == []
    assert group_router._member_bots(session, conv) == []
    assert reply == "群聊还没有成员。"
    assert events == [("done", {"reply":reply, "conversationId":conv.id})]
