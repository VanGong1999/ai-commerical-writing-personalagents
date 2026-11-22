"""SQLite accounting and job transport tests using previously returned usage metadata."""
import importlib.util
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, SQLModel, create_engine, select

from app.models import AgentRun, Bot, Job, Project, ProviderConfig, RunDigest, UsageEvent
from app.routers import jobs, misc
from app.usage_attribution import increment_project_tokens, record_model_usage

# First two metadata rows from the six-return custom knowledge run, 2026-11-20.
USAGE = [
    dict(model="MiniMax-M3.1-Flash", prompt_tokens=1933, completion_tokens=131,
         cache_hit_tokens=186, cache_miss_tokens=1747),
    dict(model="MiniMax-M3.1-Flash", prompt_tokens=2455, completion_tokens=5412,
         cache_hit_tokens=1933, cache_miss_tokens=522),
]


@pytest.fixture
def engine(tmp_path):
    db = create_engine(f"sqlite:///{tmp_path / 'digest.db'}")
    SQLModel.metadata.create_all(db)
    with Session(db) as session:
        session.add(Project(id="p", user_id="owner", title="p", format="manju", stage="S0_SETUP"))
        session.add(Bot(id="custom", name="custom", owner_user_id="owner"))
        session.add(AgentRun(id="r", project_id="p", agent_id="custom"))
        session.commit()
    yield db
    db.dispose()


@pytest.fixture
def worker(monkeypatch):
    root = Path(__file__).resolve().parents[2] / "job-worker"
    monkeypatch.syspath_prepend(str(root))
    spec = importlib.util.spec_from_file_location("digest_test_worker", root / "main.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def race(operation):
    barrier = Barrier(2)
    def attempt(index):
        barrier.wait(timeout=5)
        return operation(index)
    with ThreadPoolExecutor(2) as pool:
        return list(pool.map(attempt, range(2)))


def test_concurrent_enqueues_and_claims(engine, worker, monkeypatch):
    envelopes = []
    monkeypatch.setattr(jobs, "enqueue_job", lambda jid, payload: envelopes.append(jid))
    def enqueue(_):
        with Session(engine) as session:
            jobs._enqueue_run_digest(session, session.get(AgentRun, "r"), "owner")
    race(enqueue)
    with Session(engine) as session:
        job = session.exec(select(Job)).one()
        jid = job.id
        assert envelopes == [jid]
        assert (job.user_id, job.project_id, job.payload) == ("owner", "p", {"run_id": "r"})
    def claim(_):
        with Session(engine) as session:
            return worker._claim_run_digest(session, jid)
    assert sorted(race(claim)) == [False, True]
    with Session(engine) as session:
        job = session.get(Job, jid)
        assert job.attempts == 1 and job.started_at and job.status == "running"
        job.status = "succeeded"
        session.commit()
    assert not claim(0)
    with Session(engine) as session:
        assert session.get(Job, jid).attempts == 1


def test_terminal_callback_reuses_old_job(engine, monkeypatch):
    monkeypatch.setattr(jobs, "enqueue_job", lambda *_: pytest.fail("duplicate enqueue"))
    with Session(engine) as session:
        session.add(Job(id="old", type="run.digest", payload={"run_id": "r"}, user_id="owner"))
        session.commit()
        jobs._enqueue_run_digest(session, session.get(AgentRun, "r"), "owner")
        assert session.exec(select(Job.id)).all() == ["old"]


def store(session, index):
    from worker_handlers import _store_run_digest
    return _store_run_digest(session, RunDigest(id="run.digest:r", run_id="r"), USAGE[index],
                             event_id=f"run.digest:job:{index}", agent_id="custom",
                             project_id="p", user_id="owner")


def test_two_returns_keep_one_summary_and_both_charges(engine, worker):
    def persist(index):
        with Session(engine) as session:
            return store(session, index)
    assert sorted(race(persist)) == [False, True]
    with Session(engine) as session:
        assert session.exec(select(RunDigest.id)).all() == ["run.digest:r"]
        rows = misc.list_usage("p", session)
        assert len(rows) == 2
        for row in rows:
            assert (row.phase, row.run_id, row.agent_id, row.bot_id, row.user_id) == (
                "run.digest", "r", "custom", "custom", "owner")
            index = int(row.id.rsplit(":", 1)[1])
            assert all(getattr(row, key) == value for key, value in USAGE[index].items())
            assert session.get(UsageEvent, row.id).cost_est == row.cost_est
        assert session.get(UsageEvent, "run.digest:job:0").cost_est == 0.002364
        assert session.get(Project, "p").token_used == 1933 + 131 + 2455 + 5412


def test_digest_insert_failure_rolls_back_usage_and_charge(engine, worker):
    with Session(engine) as session:
        session.execute(text("CREATE TRIGGER fail_digest BEFORE INSERT ON rundigest "
                             "BEGIN SELECT RAISE(ABORT, 'digest insert failure'); END"))
        session.commit()
        with pytest.raises(IntegrityError):
            store(session, 0)
        session.commit()  # The worker subsequently commits its own failure status.
        assert session.exec(select(UsageEvent)).all() == []
        assert session.exec(select(RunDigest)).all() == []
        assert session.get(Project, "p").token_used == 0


def test_stale_loaded_project_and_configured_rate(engine):
    with Session(engine) as first, Session(engine) as second:
        stale = first.get(Project, "p")
        second.add(ProviderConfig(name="local", base_url="local", pricing={
            USAGE[0]["model"]: {"cachedInput": 0.5, "input": 2.0, "output": 8.0}}))
        increment_project_tokens(second, "p", 10)
        second.commit()
        assert stale.token_used == 0
        record_model_usage(USAGE[0], session=first, agent_id="custom", project_id="p", user_id="owner")
        assert stale.token_used == 2074
        event = first.exec(select(UsageEvent)).one()
        assert event.cost_est == round((186 * 0.5 + 1747 * 2 + 131 * 8) / 1e6, 6)


def test_six_actual_turns_exclude_narrator_from_run_total(engine, worker, monkeypatch):
    monkeypatch.setattr(jobs, "_maybe_announce_run", lambda *_: None)
    turns = [(1933, 131), (2455, 5412), (7906, 728), (4619, 3494), (8329, 71), (8519, 19)]
    with Session(engine) as session:
        for prompt, completion in turns:
            session.add(UsageEvent(user_id="owner", project_id="p", run_id="r", agent_id="custom",
                                   model=USAGE[0]["model"], prompt_tokens=prompt, completion_tokens=completion))
        increment_project_tokens(session, "p", 33761 + 9855)
        session.commit()
        store(session, 0)
        run = jobs.patch_run_status("r", {"status": "cancelled", "tokenPrompt": 8519,
                                          "tokenCompletion": 19}, session=session)
        assert (run.token_prompt, run.token_completion) == (33761, 9855)
        assert session.get(Project, "p").token_used == 33761 + 9855 + 2064


async def test_historical_committed_digest_replay_skips_provider(engine, worker, monkeypatch):
    import worker_handlers
    async def unexpected_call(*args, **kwargs):
        pytest.fail("replay reached inference")
    monkeypatch.setattr(worker_handlers, "chat_completion", unexpected_call)
    with Session(engine) as session:
        session.add(RunDigest(id="historical-id", run_id="r"))
        session.commit()
        await worker.handle_run_digest(session, Job(type="run.digest", payload={"run_id": "r"}, user_id="owner"))
        assert session.exec(select(RunDigest.id)).all() == ["historical-id"]
        assert session.exec(select(UsageEvent.id)).all() == []
        assert session.get(Project, "p").token_used == 0


def test_unknown_price_on_digest_detail_stays_unknown(engine):
    # Historical storage placeholder and public read contract, without a model response.
    with Session(engine) as session:
        session.add(UsageEvent(id="run.digest:job:unpriced", user_id="owner", project_id="p",
                               model="unpriced", prompt_tokens=1, completion_tokens=1))
        session.commit()
        detail, = misc.list_usage("p", session)
        assert detail.phase == "run.digest" and detail.cost_est is None
