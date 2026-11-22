#!/usr/bin/env python3
"""Job worker — consumes Redis/in-memory queue for KB / crawler / eval / usage heavy work."""

from __future__ import annotations

import asyncio
import json
import logging
import sys
import time
from pathlib import Path

# Import API package modules
API_ROOT = Path(__file__).resolve().parents[1] / "api"
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from sqlalchemy import func, update  # noqa: E402
from sqlmodel import Session, select  # noqa: E402

from app.db import engine, init_db  # noqa: E402
from app.models import Job, KnowledgeDoc, utcnow  # noqa: E402
from app.queue import claim_job, is_cancelled, publish_job_event  # noqa: E402
from app.scheduling import MAINTENANCE_NOOP, WORKER_JOB_TYPES  # noqa: E402
from app.settings import get_settings  # noqa: E402
from worker_handlers import (  # noqa: E402
    JobCancelledError,
    handle_analytics_review,
    handle_crawler_run,
    handle_eval_patrol,
    handle_eval_run,
    handle_eval_score_artifact,
    handle_hotspot_refresh,
    handle_kb_analyze,
    handle_kb_ingest,
    handle_kb_reindex_all,
    handle_knowledge_reindex,
    handle_prioritize_proposals,
    handle_run_digest,
    handle_usage_rollup,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("job-worker")

def mark_job(session: Session, job: Job, status: str, error: str | None = None) -> None:
    job.status = status
    if status == "running" and not job.started_at:
        job.started_at = utcnow()
    if status in {"succeeded", "failed", "cancelled", "dead"}:
        job.finished_at = utcnow()
    if error:
        job.error = error
    job.attempts += 1 if status == "running" else 0
    session.add(job)
    session.commit()
    session.refresh(job)
    publish_job_event(job.id, {"type": "status", "status": status, "jobId": job.id, "error": error})


def recover_orphaned_jobs(session: Session) -> None:
    """worker 重启后，把上次进程中断遗留的 running 任务重置为 failed，并恢复文档状态。"""
    orphaned = list(session.exec(select(Job).where(
        Job.status == "running", Job.type.in_(WORKER_JOB_TYPES)
    )).all())
    if not orphaned:
        return
    for job in orphaned:
        job.status = "failed"
        job.finished_at = utcnow()
        job.error = "worker 重启，任务中断（已自动恢复为失败）"
        session.add(job)
        if job.type in {"kb.analyze", "kb.report"}:
            doc_id = (job.payload or {}).get("docId")
            doc = session.get(KnowledgeDoc, doc_id) if doc_id else None
            if doc and doc.status == "analyzing":
                doc.status = "ready"
                session.add(doc)
    session.commit()
    logger.info("recovered %d orphaned running job(s)", len(orphaned))


def _claim_run_digest(session: Session, job_id: str) -> bool:
    result = session.execute(update(Job).where(
        Job.id == job_id, Job.type == "run.digest", Job.status == "queued",
    ).values(status="running", started_at=func.coalesce(Job.started_at, utcnow()),
             attempts=Job.attempts + 1))
    session.commit()
    return result.rowcount == 1


async def process_one(job_id: str, envelope: dict) -> None:
    with Session(engine) as session:
        job = session.get(Job, job_id)
        if not job:
            logger.warning("job missing: %s", job_id)
            return
        if job.type == "run.digest":
            # A stale envelope must never restart inference or mutate a terminal job.
            if not _claim_run_digest(session, job_id):
                return
            if is_cancelled(job_id):
                mark_job(session, job, "cancelled")
                return
            publish_job_event(job_id, {"type": "status", "status": "running", "jobId": job_id, "error": None})
        elif job.status == "cancelled" or is_cancelled(job_id):
            mark_job(session, job, "cancelled")
            return
        else:
            mark_job(session, job, "running")
        publish_job_event(job.id, {"type": "token", "text": f"开始处理 {job.type}…\n"})

        try:
            if job.type == "kb.ingest":
                await handle_kb_ingest(session, job)
            elif job.type in {"kb.analyze", "kb.report"}:
                await handle_kb_analyze(session, job)
            elif job.type == "kb.reindex_all":
                await handle_kb_reindex_all(session, job)
            elif job.type in {"knowledge.vector_ingest", "knowledge.reindex"}:
                await handle_knowledge_reindex(session, job)
            elif job.type == "crawler.run":
                await handle_crawler_run(session, job)
            elif job.type == "hotspot.refresh":
                await handle_hotspot_refresh(session, job)
            elif job.type == "analytics.review":
                await handle_analytics_review(session, job)
            elif job.type == "run.digest":
                await handle_run_digest(session, job)
            elif job.type == "usage.rollup":
                await handle_usage_rollup(session, job)
            elif job.type == "gap_scan.prioritize":
                await handle_prioritize_proposals(session, job)
            elif job.type == "eval.run":
                await handle_eval_run(session, job)
            elif job.type == "eval.score_artifact":
                await handle_eval_score_artifact(session, job)
            elif job.type == "eval.patrol":
                await handle_eval_patrol(session, job)
            elif job.type == MAINTENANCE_NOOP:
                job.result_ref = job.result_ref or "noop"
            else:
                raise ValueError(f"未知任务类型 {job.type}")
            if is_cancelled(job_id):
                mark_job(session, job, "cancelled")
                return
            mark_job(session, job, "succeeded")
            publish_job_event(job.id, {"type": "done", "status": "succeeded"})
        except JobCancelledError as exc:
            mark_job(session, job, "cancelled", str(exc))
            publish_job_event(job.id, {"type": "done", "status": "cancelled"})
        except Exception as exc:  # noqa: BLE001
            logger.exception("job failed %s", job_id)
            if job.attempts + 1 >= job.max_attempts:
                mark_job(session, job, "dead", str(exc))
            else:
                mark_job(session, job, "failed", str(exc))
            publish_job_event(job.id, {"type": "error", "message": str(exc)})
            publish_job_event(job.id, {"type": "done", "status": job.status})


async def main_loop() -> None:
    init_db()
    settings = get_settings()
    logger.info("job-worker started redis=%s db=%s", settings.redis_url, settings.database_url)
    with Session(engine) as session:
        recover_orphaned_jobs(session)
    while True:
        envelope = claim_job(timeout_s=2.0)
        if not envelope:
            await asyncio.sleep(0.05)
            continue
        job_id = envelope.get("jobId") or envelope.get("job_id")
        if not job_id:
            continue
        await process_one(job_id, envelope)


if __name__ == "__main__":
    try:
        asyncio.run(main_loop())
    except KeyboardInterrupt:
        logger.info("job-worker stopped")
