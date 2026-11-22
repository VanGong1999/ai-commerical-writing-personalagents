import pytest
from fastapi import HTTPException
from sqlmodel import SQLModel, Session, create_engine
from app.models import AgentRun, Job
from app.routers import jobs

@pytest.fixture
def session(monkeypatch):
    engine = create_engine('sqlite://')
    SQLModel.metadata.create_all(engine)
    monkeypatch.setattr(jobs, 'enqueue_job', lambda *a, **kw: None)
    monkeypatch.setattr(jobs, 'publish_job_event', lambda *a, **kw: None)
    monkeypatch.setattr(jobs, 'clear_cancel', lambda *a, **kw: None)
    monkeypatch.setattr(jobs, 'clear_interrupt', lambda *a, **kw: None, raising=False)
    with Session(engine) as s:
        yield s
    engine.dispose()

def test_explicit_retry_reopens_failed_run_and_keeps_recovery_evidence(session):
    session.add(AgentRun(id='r', agent_id='topic.hotspot', status='failed', lease_version=7,
        lease_owner='old', attempt=3, exec_checkpoint={'turn':4,'lastTool':{'name':'artifact_create','status':'pending'}}, output_artifact_ids=['existing']))
    session.add(Job(id='j',user_id='u',type='agent.run',status='failed',result_ref='r',payload={'runId':'r'},attempts=3))
    session.commit()
    jobs.retry_job('j',session=session)
    run=session.get(AgentRun,'r'); job=session.get(Job,'j')
    assert run.status=='queued'
    assert run.lease_owner is None and run.lease_version==8 and run.attempt==0
    assert run.exec_checkpoint['lastTool']['status']=='pending'
    assert run.output_artifact_ids==['existing']
    assert job.payload['operatorDecision']=='resume'
    assert job.status=='queued' and job.attempts==0

@pytest.mark.parametrize('status',['running','queued','succeeded','paused'])
def test_retry_does_not_restart_active_successful_or_paused_run(session,status):
    session.add(AgentRun(id='r',agent_id='topic.hotspot',status=status))
    session.add(Job(id='j',user_id='u',type='agent.run',status='failed',result_ref='r',payload={'runId':'r'}))
    session.commit()
    with pytest.raises(HTTPException) as exc:
        jobs.retry_job('j',session=session)
    assert exc.value.status_code==409


def seed_failed(session):
    session.add(AgentRun(id='r',agent_id='topic.hotspot',status='failed',lease_version=7,lease_owner='old',exec_checkpoint={'turn':4},output_artifact_ids=['existing']))
    session.add(Job(id='j',user_id='u',type='agent.run',status='failed',result_ref='r',payload={'runId':'r'}))
    session.commit()


def test_stale_retry_cannot_erase_new_worker_lease(session,monkeypatch):
    from app.run_lease import acquire
    seed_failed(session)
    effects=[]
    monkeypatch.setattr(jobs,'enqueue_job',lambda *a,**k:effects.append('enqueue'))
    with Session(session.get_bind()) as stale:
        stale_job=stale.get(Job,'j');stale_run=stale.get(AgentRun,'r')
        jobs.retry_job('j',session=session)
        claim=acquire(session,'r','new-worker')
        assert claim['ok'] and claim['leaseVersion']==9
        effects.clear()
        with pytest.raises(HTTPException) as exc:
            jobs.retry_job('j',session=stale)
        assert exc.value.status_code==409
        assert effects==[]
        session.expire_all()
        run=session.get(AgentRun,'r')
        assert run.status=='running' and run.lease_version==9 and run.lease_owner=='new-worker'


def test_losing_job_compare_and_swap_rolls_back_run_and_does_not_clear_signals(session,monkeypatch):
    seed_failed(session)
    effects=[]
    for name in ['enqueue_job','clear_cancel','clear_interrupt']:
        monkeypatch.setattr(jobs,name,lambda *a,**k:effects.append('effect'))
    with Session(session.get_bind()) as stale:
        stale_job=stale.get(Job,'j');stale_run=stale.get(AgentRun,'r')
        session.get(Job,'j').status='running';session.commit()
        with pytest.raises(HTTPException) as exc:
            jobs.retry_job('j',session=stale)
        assert exc.value.status_code==409 and effects==[]
        session.expire_all()
        run=session.get(AgentRun,'r')
        assert run.status=='failed' and run.lease_version==7
        assert session.get(Job,'j').status=='running'


def test_cancel_and_interrupt_are_cleared_only_after_retry_commit(session,monkeypatch):
    seed_failed(session)
    effects=[]
    commit=session.commit
    def committed():
        commit();effects.append('commit')
    monkeypatch.setattr(session,'commit',committed)
    monkeypatch.setattr(jobs,'clear_cancel',lambda job_id:effects.append(('cancel',job_id)))
    monkeypatch.setattr(jobs,'clear_interrupt',lambda run_id:effects.append(('interrupt',run_id)))
    monkeypatch.setattr(jobs,'enqueue_job',lambda *a,**k:effects.append('enqueue'))
    monkeypatch.setattr(jobs,'publish_job_event',lambda *a,**k:effects.append('event'))
    jobs.retry_job('j',session=session)
    assert effects==['commit',('cancel','j'),('interrupt','r'),'enqueue','event']
