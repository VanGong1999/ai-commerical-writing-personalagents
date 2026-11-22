import pytest
from sqlmodel import Session, SQLModel, create_engine, select

from app.models import AgentRun, Project, UsageEvent
from app.routers import jobs


@pytest.fixture
def session(monkeypatch):
    engine = create_engine('sqlite://')
    SQLModel.metadata.create_all(engine)
    monkeypatch.setattr(jobs, 'enqueue_job', lambda *args, **kwargs: None)
    monkeypatch.setattr(jobs, '_maybe_announce_run', lambda *args, **kwargs: None)
    with Session(engine) as session:
        yield session
    engine.dispose()


@pytest.mark.parametrize('latest_prompt,latest_completion', [(200, 75), (0, 0)])
def test_terminal_run_sums_actual_turns_across_attempts_without_rebilling(session, latest_prompt, latest_completion):
    project = Project(id='p', user_id='test', title='usage test', format='manju', stage='S0_SETUP', token_used=425)
    run = AgentRun(id='r', project_id='p', agent_id='prose.episode_body', status='running',
                   lease_version=3, token_prompt=100, token_completion=50, model='actual-model')
    session.add(project); session.add(run)
    for run_id, prompt, completion in [('r', 100, 50), ('r', 200, 75), ('unrelated', 900, 900)]:
        session.add(UsageEvent(user_id='test', project_id='p', run_id=run_id,
            model='actual-model', prompt_tokens=prompt, completion_tokens=completion, cost_est=0))
    session.commit()
    for _ in range(2):
        result = jobs.patch_run_status('r', {'status': 'cancelled', 'leaseVersion': 3,
            'tokenPrompt': latest_prompt, 'tokenCompletion': latest_completion}, session=session)
        assert (result.token_prompt, result.token_completion) == (300, 125)
        session.refresh(project)
        assert project.token_used == 425
        assert len(session.exec(select(UsageEvent).where(UsageEvent.run_id == 'r')).all()) == 2


@pytest.mark.parametrize("digest_present", [False, True])
def test_terminal_legacy_worker_creates_one_aggregate_then_remains_idempotent(session, digest_present):
    project = Project(id='p', user_id='test', title='legacy usage', format='manju', stage='S0_SETUP')
    run = AgentRun(id='r', project_id='p', agent_id='char.bio_manju', status='running',
                   lease_version=2, model='legacy-model')
    # A prior narrator event belongs to this project, outside the execution turn.
    digest_tokens = 2064 if digest_present else 0
    if digest_present:
        project.token_used = digest_tokens
        session.add(UsageEvent(id='run.digest:j:e', user_id='test', project_id='p', run_id='r',
            model='MiniMax-M3.1-Flash', prompt_tokens=1933, completion_tokens=131))
    session.add(project); session.add(run); session.commit()
    first = jobs.patch_run_status('r', {'status': 'cancelled', 'leaseVersion': 2,
        'tokenPrompt': 120, 'tokenCompletion': 30}, session=session)
    assert (first.token_prompt, first.token_completion) == (120, 30)
    again = jobs.patch_run_status('r', {'status': 'cancelled', 'leaseVersion': 2,
        'tokenPrompt': 20, 'tokenCompletion': 5}, session=session)
    assert (again.token_prompt, again.token_completion) == (120, 30)
    events = session.exec(select(UsageEvent).where(UsageEvent.run_id == 'r')).all()
    events = [event for event in events if not event.id.startswith('run.digest:')]
    assert len(events) == 1
    assert (events[0].prompt_tokens, events[0].completion_tokens, events[0].cost_est) == (120, 30, 0)
    session.refresh(project)
    assert project.token_used == digest_tokens + 150
