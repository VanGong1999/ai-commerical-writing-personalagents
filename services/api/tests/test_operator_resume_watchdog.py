from datetime import timedelta

import pytest
from fastapi import HTTPException
from sqlmodel import Session, SQLModel, create_engine, select

from app import db, queue, run_lease, task_daemon, watchdog
from app.models import AgentRun, AsyncTaskGroup, Job, Project, RunStep, utcnow
from app.routers import jobs, tasks


@pytest.fixture
def controls(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'controls.db'}")
    SQLModel.metadata.create_all(engine)
    monkeypatch.setattr(db, "engine", engine)
    now = [utcnow()]
    for module in (run_lease, watchdog, task_daemon):
        monkeypatch.setattr(module, "utcnow", lambda: now[0])
    for name in ("enqueue_job", "publish_job_event", "publish_task_event"):
        monkeypatch.setattr(task_daemon, name, lambda *args: None)
    monkeypatch.setattr(queue, "job_in_queue", lambda _: True)
    monkeypatch.setattr(run_lease, "publish_task_event", lambda _: None)
    with Session(engine) as session:
        yield session, now
    engine.dispose()


def run_and_job(session, now, status="queued", group=None):
    project = Project(title="watchdog", format="manju", stage="draft", user_id=tasks.DEMO_USER)
    run = AgentRun(agent_id="prose.episode_body", project_id=project.id, conversation_id="chat",
                   status=status, created_at=now - timedelta(hours=1), attempt=2,
                   task_group_id=group.id if group else None, exec_checkpoint={"turn": 2})
    job = Job(type="agent.run", user_id=tasks.DEMO_USER, result_ref=run.id, status=status)
    session.add_all([project, run, job])
    session.commit()
    return run, job


def alerts(session):
    return [(a["runId"], a["type"]) for a in watchdog.scan(session, announce=False)["alerts"]]


@pytest.mark.parametrize("group_control", [False, True])
def test_resume_grace_and_expiry(controls, group_control):
    session, now = controls
    group = AsyncTaskGroup(user_id=tasks.DEMO_USER, status="paused")
    session.add(group)
    run, job = run_and_job(session, now[0], group=group if group_control else None)
    run_lease.pause(session, run.id)
    before = (run.created_at, run.heartbeat_at, run.progress_pct, run.progress_stage, run.attempt)
    original_job = job.id
    if group_control:
        tasks.patch_group(group.id, tasks.PatchGroupIn(status="running"), session)
    else:
        tasks.resume_run(run.id, session)
    assert (run.status, job.status, job.id) == ("queued", "queued", original_job)
    assert (run.created_at, run.heartbeat_at, run.progress_pct, run.progress_stage, run.attempt) == before
    assert alerts(session) == []
    now[0] += timedelta(minutes=14, seconds=59)
    if group_control:
        tasks.patch_group(group.id, tasks.PatchGroupIn(status="running"), session)
    else:
        with pytest.raises(HTTPException) as rejected:
            tasks.resume_run(run.id, session)
        assert rejected.value.status_code == 409
    assert alerts(session) == []
    now[0] += timedelta(seconds=1)
    assert alerts(session) == [(run.id, "stuck_run")]
    warning = session.exec(select(RunStep)).one()
    assert warning.payload["noProgress"]
    assert alerts(session) == []
    assert run_lease.acquire(session, run.id, "worker")["attempt"] == 2


@pytest.mark.parametrize("stored_time", [None, "bad timestamp", 1e99])
def test_stale_run_and_untrusted_dates(controls, stored_time):
    session, now = controls
    run, _ = run_and_job(session, now[0])
    run.input_json = {"operator_resumed_at_s": now[0].timestamp()}
    run.exec_checkpoint = {"_operatorResume": True, "operator_resumed_at_s": now[0].timestamp()}
    session.add(run)
    session.commit()
    jobs.patch_run_status(run.id, {"status": "queued", "operator_resumed_at_s": now[0].timestamp()}, session)
    assert run.operator_resumed_at_s is None
    session.connection().exec_driver_sql(
        "UPDATE agentrun SET operator_resumed_at_s=? WHERE id=?", (stored_time, run.id))
    session.commit()
    assert alerts(session) == [(run.id, "stuck_run")]


def test_real_progress_live_lease_and_expired_zombie(controls):
    session, now = controls
    run, job = run_and_job(session, now[0], status="paused")
    tasks.resume_run(run.id, session)
    claim = run_lease.acquire(session, run.id, "worker", ttl_s=3000)
    assert claim["attempt"] == 2
    now[0] += timedelta(minutes=40)
    assert alerts(session) == []
    assert run_lease.heartbeat(session, run.id, "worker", claim["leaseVersion"],
                               checkpoint={"operator_resumed_at_s": now[0].timestamp()})["ok"]
    assert run.operator_resumed_at_s == (now[0] - timedelta(minutes=40)).timestamp()
    run_lease.release(session, run.id, "worker", claim["leaseVersion"])
    assert run.status == "running" and run.lease_until is None
    now[0] += timedelta(minutes=25)
    session.add(RunStep(conversation_id="chat", run_id=run.id, actor=run.agent_id,
                        kind="tool_result", seq=1, created_at=now[0]))
    session.commit()
    assert alerts(session) == []
    now[0] += timedelta(minutes=31)
    assert alerts(session) == [(run.id, "zombie_run_requeued")]
    assert (run.status, job.status, run.attempt) == ("queued", "queued", 2)


def test_resume_rollback_and_stale_claim(controls):
    session, now = controls
    run, job = run_and_job(session, now[0], status="paused")
    job.status = "failed"
    session.commit()
    assert run_lease.resume(session, run.id)["reason"] == "no_live_job"
    assert run.operator_resumed_at_s is None and run.exec_checkpoint == {"turn": 2}
    job.status = "paused"
    session.commit()
    with Session(session.get_bind()) as stale:
        observed = stale.get(AgentRun, run.id)
        assert observed.status == "paused"
        assert run_lease.resume(session, run.id)["ok"]
        now[0] += timedelta(minutes=10)
        assert run_lease.resume(stale, run.id)["reason"] == "conflict"
        assert observed.operator_resumed_at_s == (now[0] - timedelta(minutes=10)).timestamp()


def test_genuine_reclaim_after_operator_resume(controls):
    session, now = controls
    run, job = run_and_job(session, now[0], status="paused")
    assert run_lease.resume(session, run.id)["ok"]
    assert run_lease.acquire(session, run.id, "one")["attempt"] == 2
    now[0] += timedelta(minutes=2)
    assert run_lease.reclaim_expired(session, now=now[0], announce=False) == {"requeued": 1, "dead": 0}
    assert run_lease.acquire(session, run.id, "two")["attempt"] == 3
    now[0] += timedelta(minutes=2)
    assert run_lease.reclaim_expired(session, now=now[0], announce=False) == {"requeued": 0, "dead": 1}
    assert (run.status, job.status) == ("dead", "dead")


def test_legacy_sqlite_migration(controls):
    session, now = controls
    run, _ = run_and_job(session, now[0], status="paused")
    old = (run.id, run.created_at, run.exec_checkpoint)
    engine = session.get_bind()
    session.close()
    with engine.begin() as connection:
        connection.exec_driver_sql("ALTER TABLE agentrun DROP COLUMN operator_resumed_at_s")
        indexes = connection.exec_driver_sql("PRAGMA index_list(agentrun)").all()
    for _ in range(2):
        db.init_db()
    with Session(engine) as migrated:
        row = migrated.get(AgentRun, old[0])
        assert (row.id, row.created_at, row.exec_checkpoint) == old
        assert row.status == "paused" and row.operator_resumed_at_s is None
        assert migrated.connection().exec_driver_sql("PRAGMA index_list(agentrun)").all() == indexes


def test_old_warning_survives_resume_and_zombie_deadline(controls):
    session, now = controls
    run, job = run_and_job(session, now[0], status="paused")
    history = RunStep(conversation_id="chat", run_id=run.id, seq=39, kind="watchdog",
                      actor="system", payload={"reason": "stuck_run", "status": "queued"},
                      created_at=run.created_at)
    gates = [{"type": "feishu_watchdog", "at": "historical"}]
    run.exec_checkpoint = {}
    run.gate_results = gates
    session.add_all([run, history])
    session.commit()
    before = (history.id, history.seq, history.created_at, history.payload)
    assert run_lease.resume(session, run.id)["ok"]
    jobs.patch_run_status(run.id, {"status": "running"}, session)
    now[0] += timedelta(minutes=29)
    assert alerts(session) == []
    now[0] += timedelta(minutes=2)
    assert alerts(session) == [(run.id, "zombie_run_failed")]
    assert (run.status, job.status, run.gate_results) == ("failed", "failed", gates)
    assert (history.id, history.seq, history.created_at, history.payload) == before


def test_cancel_pending_pause_does_not_start_grace(controls):
    session, now = controls
    run, _ = run_and_job(session, now[0])
    run_lease.acquire(session, run.id, "worker")
    assert run_lease.pause(session, run.id)["mode"] == "signal"
    assert run_lease.resume(session, run.id)["mode"] == "cancel_pause"
    assert run.status == "running" and run.operator_resumed_at_s is None


def test_resume_uses_committed_job_status(controls, monkeypatch):
    session, now = controls
    run, job = run_and_job(session, now[0], status="paused")
    assert job.status == "paused"
    run_id, job_id = run.id, job.id
    with Session(session.get_bind()) as other:
        other.get(Job, job_id).status = "failed"
        other.commit()
    notifications = []
    for name in ("enqueue_job", "publish_job_event", "publish_task_event"):
        monkeypatch.setattr(task_daemon, name, lambda *args: notifications.append(args))
    assert run_lease.resume(session, run_id) == {"ok": False, "reason": "no_live_job", "status": "paused"}
    with Session(session.get_bind()) as verify:
        observed = verify.get(AgentRun, run_id)
        assert observed.status == "paused" and observed.operator_resumed_at_s is None
        assert observed.exec_checkpoint == {"turn": 2}
        assert verify.get(Job, job_id).status == "failed"
    assert notifications == []


def test_resume_refreshes_cached_live_job(controls):
    session, now = controls
    run, job = run_and_job(session, now[0], status="paused")
    job.status = "queued"
    session.commit()
    assert job.status == "queued"
    with Session(session.get_bind()) as other:
        other.get(Job, job.id).status = "paused"
        other.commit()
    assert run_lease.resume(session, run.id)["ok"]
    assert job.status == "queued" and run.status == "queued"


def test_clock_rollback_preserves_real_resume_grace(controls):
    session, now = controls
    run, _ = run_and_job(session, now[0], status="paused")
    now[0] -= timedelta(days=365)
    created = run.created_at
    assert run_lease.resume(session, run.id)["ok"]
    now[0] += timedelta(minutes=14, seconds=59)
    assert alerts(session) == []
    now[0] += timedelta(seconds=1)
    assert alerts(session) == [(run.id, "stuck_run")]
    assert run.created_at == created


@pytest.mark.parametrize("with_heartbeat", [True, False])
def test_clock_rollback_detects_unleased_zombie(controls, with_heartbeat):
    session, now = controls
    run, job = run_and_job(session, now[0], status="running")
    now[0] -= timedelta(days=365)
    created = run.created_at
    if with_heartbeat:
        claim = run_lease.acquire(session, run.id, "worker")
        run_lease.release(session, run.id, "worker", claim["leaseVersion"])
        assert alerts(session) == []
        now[0] += timedelta(minutes=31)
    # With no valid timestamps, an unleased zombie is already eligible for inspection.
    run.exec_checkpoint = {}
    session.commit()
    assert alerts(session) == [(run.id, "zombie_run_failed")]
    assert run.created_at == created and job.status == "failed"
