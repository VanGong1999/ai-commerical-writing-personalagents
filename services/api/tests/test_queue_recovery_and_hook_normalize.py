"""队列卫生恢复 + 核心梗候选归一化的回归测试。"""

from __future__ import annotations

from datetime import timedelta

from sqlmodel import Session

from app.db import engine, init_db
from app.models import AgentRun, Job, Project, new_id, utcnow
from app.routers.projects import _normalize_core_hook_candidate, _unwrap_list
from app.task_daemon import recover_stale_queued


def setup_module() -> None:
    init_db()


def _session() -> Session:
    return Session(engine)


def test_unwrap_item_list_recursive():
    assert _unwrap_list({"item": {"item": ["a", "b"]}}) == ["a", "b"]
    assert _unwrap_list({"items": ["x"]}) == ["x"]
    assert _unwrap_list(["p", "q"]) == ["p", "q"]
    assert _unwrap_list(None) == []


def test_normalize_core_hook_derives_motivation_and_flattens():
    raw = {
        "title": "测试梗",
        "core_hook": "一句话梗",
        "tags": {"item": ["都市", "逆袭"]},
        "opening_beats": {"item": {"item": ["画面1", "画面2"]}},
        "crisis": "被当众夺走工牌",
        "four_step": {"hook_point": "第三次回退前必须抓出内鬼"},
    }
    out = _normalize_core_hook_candidate(raw)
    assert out["tags"] == ["都市", "逆袭"]
    assert out["opening_beats"] == ["画面1", "画面2"]
    assert out["motivation"] == "冲突线：被当众夺走工牌；追剧点：第三次回退前必须抓出内鬼"


def test_normalize_keeps_existing_motivation():
    raw = {"core_hook": "x", "motivation": "复仇线：夺回公司；事业线：重建团队"}
    out = _normalize_core_hook_candidate(raw)
    assert out["motivation"] == "复仇线：夺回公司；事业线：重建团队"


def test_recover_stale_queued_requeues_and_deads():
    """queued 且超过宽限期：无 Job → dead；有 Job → 幂等重入队（不重复）。"""
    from app import queue as queue_mod

    with _session() as session:
        p = Project(id=new_id(), title="恢复测试", format="manju", stage="S1_HOOK_BATCH", user_id="u1")
        session.add(p)
        stale = utcnow() - timedelta(hours=8)  # 超过 6h 窗口 → dead
        fresh = utcnow() - timedelta(minutes=10)  # 窗口内 → 重入队
        dead_run = AgentRun(
            id=new_id(),
            project_id=p.id,
            agent_id="topic.core_hook_batch",
            status="queued",
            created_at=stale,
        )
        dead_job = Job(
            id=new_id(),
            type="agent.run",
            payload={"runId": dead_run.id, "agentId": "topic.core_hook_batch", "input": {}},
            project_id=p.id,
            result_ref=dead_run.id,
            status="queued",
            user_id="u1",
        )
        fresh_run = AgentRun(
            id=new_id(),
            project_id=p.id,
            agent_id="char.bio_manju",
            status="queued",
            created_at=fresh,
        )
        fresh_job = Job(
            id=new_id(),
            type="agent.run",
            payload={"runId": fresh_run.id, "agentId": "char.bio_manju", "input": {}},
            project_id=p.id,
            result_ref=fresh_run.id,
            status="queued",
            user_id="u1",
        )
        session.add_all([dead_run, dead_job, fresh_run, fresh_job])
        session.commit()

        sent: list[str] = []
        queue_mod.enqueue_job = lambda job_id, payload=None: sent.append(job_id)  # type: ignore[method-assign]
        queue_mod.job_in_queue = lambda job_id, queue_key=None: False  # type: ignore[method-assign]

        result = recover_stale_queued(session, now=utcnow())
        session.refresh(dead_run)
        session.refresh(fresh_run)
        assert dead_run.status == "dead"
        assert fresh_run.status == "queued"
        assert fresh_job.id in sent
        assert result["dead"] >= 1 and result["requeued"] >= 1
