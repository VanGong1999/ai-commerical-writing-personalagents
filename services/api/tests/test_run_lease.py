"""Agent Instance 生命周期：租约 / 心跳 / 回收 / pause-resume / fencing / 审计。"""

from __future__ import annotations

from datetime import timedelta
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select
from starlette.testclient import TestClient

from app import run_lease as lease
from app.db import get_session
from app.main import api, app
from app.models import ActivityLog, AgentRun, Job, utcnow

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
SQLModel.metadata.create_all(engine)


def override_session():
    with Session(engine) as session:
        yield session


client = TestClient(app)


@pytest.fixture(autouse=True)
def _use_test_session():
    api.dependency_overrides[get_session] = override_session
    yield
    api.dependency_overrides.pop(get_session, None)


def _mk_run(session: Session, status="queued", **kw) -> AgentRun:
    run = AgentRun(agent_id="prose.episode_body", project_id="p1", status=status, **kw)
    session.add(run)
    session.commit()
    session.refresh(run)
    job = Job(type="agent.run", payload={"runId": run.id}, user_id="u", result_ref=run.id, status="queued")
    session.add(job)
    session.commit()
    return run


def test_acquire_blocks_second_owner_and_fences_old_owner():
    with Session(engine) as s:
        run = _mk_run(s)
        a = lease.acquire(s, run.id, "w1")
        assert a["ok"] and a["leaseVersion"] == 1 and a["attempt"] == 1
        # 租约有效期内他人不能领
        b = lease.acquire(s, run.id, "w2")
        assert not b["ok"] and b["reason"] == "leased"
        # 过期后他人可领，版本递增
        past = utcnow() + timedelta(seconds=500)
        c = lease.acquire(s, run.id, "w2", now=past)
        assert c["ok"] and c["leaseVersion"] == 2
        # 旧 worker 心跳被 fencing
        hb = lease.heartbeat(s, run.id, "w1", 1)
        assert hb == {"ok": False, "reason": "lease_lost"}


def test_acquire_rejects_competing_claim_from_stale_session():
    with Session(engine) as first, Session(engine) as second:
        run = _mk_run(first)
        stale = second.get(AgentRun, run.id)
        assert stale.lease_owner is None
        winner = lease.acquire(first, run.id, "winner")
        loser = lease.acquire(second, run.id, "loser")
        assert winner["ok"]
        assert not loser["ok"]
        first.refresh(run)
        assert run.lease_owner == "winner"
        assert run.lease_version == winner["leaseVersion"]


def test_simultaneous_workers_receive_only_one_live_lease(tmp_path):
    isolated = create_engine(f"sqlite:///{tmp_path / 'lease-race.db'}",
                             connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(isolated)
    with Session(isolated) as session:
        run_id = _mk_run(session).id
    both_read = Barrier(2)

    class RacingSession(Session):
        def get(self, entity, *args, **kwargs):
            row = super().get(entity, *args, **kwargs)
            if entity is AgentRun:
                both_read.wait(timeout=5)
            return row

    def claim(owner):
        with RacingSession(isolated) as session:
            return owner, lease.acquire(session, run_id, owner)

    try:
        with ThreadPoolExecutor(max_workers=2) as workers:
            claims = list(workers.map(claim, ["worker-a", "worker-b"]))
        winners = [(owner, result) for owner, result in claims if result["ok"]]
        assert len(winners) == 1
        with Session(isolated) as session:
            run = session.get(AgentRun, run_id)
            assert run.lease_owner == winners[0][0]
            assert run.lease_version == 1
            assert run.attempt == 1
    finally:
        isolated.dispose()


@pytest.mark.parametrize("changes", [{"status": "paused"}, {"control_signal": "stop"}])
def test_acquire_cannot_overwrite_control_change_from_stale_session(changes):
    with Session(engine) as operator, Session(engine) as worker:
        run = _mk_run(operator)
        stale = worker.get(AgentRun, run.id)
        assert stale.status == "queued"
        for key, value in changes.items():
            setattr(run, key, value)
        operator.add(run)
        operator.commit()
        result = lease.acquire(worker, run.id, "worker")
        assert not result["ok"]
        operator.refresh(run)
        assert run.lease_owner is None
        for key, value in changes.items():
            assert getattr(run, key) == value


def test_heartbeat_extends_lease_and_stores_checkpoint():
    with Session(engine) as s:
        run = _mk_run(s)
        a = lease.acquire(s, run.id, "w1")
        hb = lease.heartbeat(
            s, run.id, "w1", a["leaseVersion"], checkpoint={"turn": 7, "stage": "撰写中", "artifactIds": ["a1"]}
        )
        assert hb["ok"] and hb["action"] == "continue"
        s.refresh(run)
        assert run.exec_checkpoint["turn"] == 7
        again = lease.acquire(s, run.id, "w1")  # 同 owner 幂等
        assert again["ok"] and again["leaseVersion"] == a["leaseVersion"]
        assert again["resume"] is True and again["checkpoint"]["artifactIds"] == ["a1"]


def test_reclaim_requeues_with_checkpoint_then_dies_after_max_attempts():
    with Session(engine) as s:
        run = _mk_run(s, max_attempts=2)
        a = lease.acquire(s, run.id, "w1")
        lease.heartbeat(s, run.id, "w1", a["leaseVersion"], checkpoint={"turn": 3})
        future = utcnow() + timedelta(seconds=1000)
        out = lease.reclaim_expired(s, now=future, announce=False)
        assert out["requeued"] >= 1
        s.refresh(run)
        assert run.status == "queued" and run.lease_owner is None
        assert run.exec_checkpoint["turn"] == 3  # checkpoint 保留 → 可续跑
        # 第二次领取 + 再过期 → attempt==max → dead
        lease.acquire(s, run.id, "w2")
        out2 = lease.reclaim_expired(s, now=future + timedelta(seconds=1000), announce=False)
        assert out2["dead"] >= 1
        s.refresh(run)
        assert run.status == "dead"


def test_legacy_runs_without_lease_are_not_reclaimed():
    with Session(engine) as s:
        run = _mk_run(s, status="running")
        out = lease.reclaim_expired(s, now=utcnow() + timedelta(days=1), announce=False)
        s.refresh(run)
        assert run.status == "running" and out["requeued"] == 0


def test_pause_signal_via_heartbeat_then_release_and_resume():
    with Session(engine) as s:
        run = _mk_run(s)
        a = lease.acquire(s, run.id, "w1")
        assert a["attempt"] == 1
        p = lease.pause(s, run.id)
        assert p["mode"] == "signal"
        hb = lease.heartbeat(s, run.id, "w1", a["leaseVersion"], checkpoint={"turn": 2})
        assert hb["action"] == "pause"
        rel = lease.release(s, run.id, "w1", a["leaseVersion"], state="paused")
        assert rel["ok"]
        s.refresh(run)
        assert run.status == "paused" and run.lease_owner is None
        # 暂停中的实例不可被领取
        assert lease.acquire(s, run.id, "w3")["reason"] == "paused"
        r = lease.resume(s, run.id)
        assert r["ok"] and r["status"] == "queued"
        got = lease.acquire(s, run.id, "w3")
        assert got["ok"] and got["resume"] is True
        # 操作员 pause→resume 不得消耗 crash attempt
        assert got["attempt"] == 1
        s.refresh(run)
        assert run.attempt == 1
        assert "_operatorResume" not in (run.exec_checkpoint or {})


def test_stop_is_terminal():
    with Session(engine) as s:
        run = _mk_run(s)
        out = lease.stop(s, run.id)
        assert out["ok"]
        assert lease.acquire(s, run.id, "w1")["reason"] == "terminal"


def test_duplicate_jobs_follow_pause_resume_and_stop_without_resurrection():
    with Session(engine) as session:
        run = _mk_run(session)
        historical = session.exec(select(Job).where(Job.result_ref == run.id)).first()
        historical.status = "succeeded"
        session.add(historical)
        for status in ["queued", "running"]:
            session.add(Job(type="agent.run", payload={"runId": run.id}, user_id="u",
                            result_ref=run.id, status=status))
        session.commit()
        assert lease.pause(session, run.id)["ok"]
        jobs = list(session.exec(select(Job).where(Job.result_ref == run.id)))
        assert sorted(job.status for job in jobs) == ["paused", "paused", "succeeded"]
        assert lease.resume(session, run.id)["status"] == "queued"
        session.expire_all()
        jobs = list(session.exec(select(Job).where(Job.result_ref == run.id)))
        assert len(jobs) == 3
        assert sorted(job.status for job in jobs) == ["cancelled", "queued", "succeeded"]
        assert lease.stop(session, run.id)["ok"]
        session.expire_all()
        jobs = list(session.exec(select(Job).where(Job.result_ref == run.id)))
        assert sorted(job.status for job in jobs) == ["cancelled", "cancelled", "succeeded"]


@pytest.mark.parametrize("run_status", ["paused", "succeeded", "failed", "cancelled", "dead"])
def test_rejected_lease_settles_stale_live_jobs(run_status):
    with Session(engine) as session:
        run = _mk_run(session, status=run_status)
        session.add(Job(type="agent.run", payload={"runId": run.id}, user_id="u",
                        result_ref=run.id, status="running"))
        session.commit()
        assert not lease.acquire(session, run.id, "stale-worker")["ok"]
        jobs = list(session.exec(select(Job).where(Job.result_ref == run.id)))
        assert {job.status for job in jobs} == {run_status}


def test_worker_release_pauses_all_live_deliveries():
    with Session(engine) as session:
        run = _mk_run(session)
        session.add(Job(type="agent.run", payload={"runId": run.id}, user_id="u",
                        result_ref=run.id, status="running"))
        session.commit()
        acquired = lease.acquire(session, run.id, "worker")
        assert lease.pause(session, run.id)["mode"] == "signal"
        assert not lease.acquire(session, run.id, "duplicate-worker")["ok"]
        assert {job.status for job in session.exec(select(Job).where(Job.result_ref == run.id))} == {"queued", "running"}
        assert lease.release(session, run.id, "worker", acquired["leaseVersion"], state="paused")["ok"]
        assert {job.status for job in session.exec(select(Job).where(Job.result_ref == run.id))} == {"paused"}


def test_http_lifecycle_and_instances_view_and_audit():
    with Session(engine) as s:
        run = _mk_run(s)
        rid = run.id
    r = client.post(f"/api/v1/tasks/runs/{rid}/lease", json={"owner": "w1"})
    assert r.status_code == 200 and r.json()["ok"]
    ver = r.json()["leaseVersion"]
    r = client.patch(
        f"/api/v1/tasks/runs/{rid}/heartbeat",
        json={"owner": "w1", "leaseVersion": ver, "checkpoint": {"turn": 4, "stage": "x"}},
    )
    assert r.json()["ok"]
    ps = client.get("/api/v1/tasks/instances").json()
    mine = [i for i in ps["instances"] if i["runId"] == rid][0]
    assert mine["state"] == "running" and mine["checkpoint"]["turn"] == 4
    assert mine["lease"]["owner"] == "w1"
    detail = client.get(f"/api/v1/tasks/instances/{rid}")
    assert detail.status_code == 200 and detail.json()["checkpointFull"]["turn"] == 4

    # fencing：旧 leaseVersion 回写状态 → 409
    bad = client.patch(f"/api/v1/runs/{rid}/status", json={"status": "succeeded", "leaseVersion": ver + 5})
    assert bad.status_code == 409
    ok = client.patch(f"/api/v1/runs/{rid}/status", json={"status": "succeeded", "leaseVersion": ver})
    assert ok.status_code == 200

    # pause/stop 走审计
    with Session(engine) as s:
        run2 = _mk_run(s)
        rid2 = run2.id
    assert client.post(f"/api/v1/tasks/runs/{rid2}/pause").status_code == 200
    assert client.post(f"/api/v1/tasks/runs/{rid2}/resume").status_code == 200
    assert client.post(f"/api/v1/tasks/runs/{rid2}/stop").status_code == 200
    assert client.post(f"/api/v1/tasks/runs/{rid2}/stop").status_code == 409
    with Session(engine) as s:
        acts = [a.action for a in s.exec(select(ActivityLog)) if (a.detail or {}).get("audit")]
        assert {"agent_pause", "agent_resume", "agent_stop"} <= set(acts)
    audit = client.get("/api/v1/tasks/audit").json()
    assert audit["count"] >= 3


def test_metrics_and_attention_flags():
    with Session(engine) as s:
        run = _mk_run(s)
        lease.acquire(s, run.id, "w1", ttl_s=5)
        s.refresh(run)
        view = lease.instance_view(s, run)
        assert view["attention"] == "lease_expiring"
        m = lease.instance_metrics(s)
        assert m["total"] >= 1 and m["leaseExpiring"] >= 1
    r = client.get("/api/v1/tasks/metrics")
    assert r.status_code == 200 and "byState" in r.json()
