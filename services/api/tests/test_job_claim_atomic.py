"""Exercise the claim race with stale candidates from two real SQLite sessions."""
from sqlmodel import SQLModel, Session, create_engine

from app.models import Job
from app.routers.jobs import claim_agent_job


def test_stale_candidate_cannot_be_claimed_twice(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path}/claim.db")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as seed:
        seed.add(Job(user_id='test', id='j', type='agent.run', payload={}, status='queued'))
        seed.commit()
    with Session(engine) as first, Session(engine) as second:
        original_exec = first.exec
        competing = []

        def interleaved(statement, *args, **kwargs):
            candidates = list(original_exec(statement, *args, **kwargs))
            # A second worker wins after the first worker reads its candidates.
            competing.append(claim_agent_job(session=second))
            return candidates

        monkeypatch.setattr(first, 'exec', interleaved)
        result = claim_agent_job(session=first)
        assert competing[0]['jobId'] == 'j'
        assert result['jobId'] is None
    with Session(engine) as verify:
        job = verify.get(Job, 'j')
        assert job.attempts == 1
        assert job.status == 'running'


def test_claim_filters_types_before_candidate_limit(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path}/types.db")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        for i in range(25):
            session.add(Job(user_id='test', type='other', payload={}, status='queued', priority=0))
        session.add(Job(user_id='test', id='wanted', type='agent.run', payload={}, status='queued', priority=10))
        session.commit()
        assert claim_agent_job(session=session)['jobId'] == 'wanted'
