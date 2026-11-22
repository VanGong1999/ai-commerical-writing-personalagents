import pytest
from fastapi import HTTPException
from sqlmodel import Session, select

from app import queue
from app.models import AgentRun, Project, Job, TaskProposal
from app.routers import misc
from test_llm_provider_routing import _routing_engine


def test_proposal_report_replay_approval_and_validation(monkeypatch):
    engine = _routing_engine()
    sent = []
    monkeypatch.setattr(queue, "enqueue_job", lambda jid, body: sent.append(jid))
    monkeypatch.setattr(queue, "publish_job_event", lambda *args: None)
    monkeypatch.setattr(misc, "resolve_default_model", lambda: "mock")
    with Session(engine) as session:
        project = Project(title="测试", format="manju", stage="S0_SETUP", user_id="test")
        run = AgentRun(project_id=project.id, agent_id="colleague.proactive")
        session.add_all([project, run])
        session.commit()
        item = dict(message="核对冲突", agentId="struct.expectation", needsApproval=True, priority="P1")
        def save(items):
            return misc.save_colleague_checklist(project.id, run.id, {"title":"待审批","items":items}, session)
        for invalid in [dict(item,done="false"), dict(item,agentId="unknown"), dict(item,agentId="topic.cool_point_5"), dict(item,needsApproval=False)]:
            with pytest.raises(HTTPException):
                save([invalid])
        art = save([item])
        assert save([item]).id == art.id
        proposal = session.exec(select(TaskProposal)).one()
        assert proposal.status == "pending" and not sent
        receipt = misc.approve_proposal(proposal.id, session)
        assert session.get(Job, receipt.job_id).user_id == project.user_id
        from app.models import Conversation
        from app.routers.personal_agent import _execute_supervisor_tool
        import asyncio
        conv = Conversation(user_id="test",project_id="other")
        args = {"proposal_id":proposal.id}
        _, denied = asyncio.run(_execute_supervisor_tool("approve_proposal",args,session,conv))
        assert "jobId" not in denied
        conv.project_id = project.id
        _, detail = asyncio.run(_execute_supervisor_tool("approve_proposal",args,session,conv))
        assert detail["jobId"] == receipt.job_id and detail["runId"] == receipt.run_id
        second = misc.approve_proposal(proposal.id, session)
        assert receipt.job_id == second.job_id == session.exec(select(Job)).one().id
        assert receipt.run_id == second.run_id and sent == [receipt.job_id]

        approved_run = session.get(AgentRun, receipt.run_id)
        for field, wrong in [("project_id","another-project"), ("input_json", {"fromProposal":"another-proposal"})]:
            previous = getattr(approved_run, field)
            setattr(approved_run, field, wrong)
            session.commit()
            with pytest.raises(HTTPException) as refused:
                misc.approve_proposal(proposal.id, session)
            assert refused.value.status_code == 409 and sent == [receipt.job_id]
            setattr(approved_run, field, previous)
            session.commit()


def test_concurrent_approval_returns_same_job(tmp_path, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from sqlmodel import SQLModel, create_engine
    engine = create_engine(f"sqlite:///{tmp_path / 'proposal.db'}")
    SQLModel.metadata.create_all(engine)
    queued = []
    monkeypatch.setattr(queue,"enqueue_job",lambda job_id, payload: queued.append(job_id))
    monkeypatch.setattr(queue,"publish_job_event",lambda *args: None)
    monkeypatch.setattr(misc,"resolve_default_model",lambda:"mock")
    with Session(engine) as session:
        session.add(Project(id="p",title="并发",format="manju",stage="S0_SETUP",user_id="owner"))
        proposal = TaskProposal(type="colleague.proactive",project_id="p",message="审稿",
                                actions=[dict(type="agent.run",agentId="struct.expectation")])
        session.add(proposal)
        session.commit()
        proposal_id = proposal.id
    barrier = Barrier(2)
    def approve(_):
        with Session(engine) as session:
            barrier.wait(timeout=5)
            return misc.approve_proposal(proposal_id, session)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first, second = pool.map(approve, range(2))
    assert first.job_id == second.job_id and first.run_id == second.run_id
    assert queued == [first.job_id]
