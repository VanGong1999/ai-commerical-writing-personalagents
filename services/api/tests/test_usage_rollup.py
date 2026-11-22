"""usage.rollup worker handler aggregates UsageEvent by UTC day."""

from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

# job-worker handlers share app.* via PYTHONPATH; ensure sibling package is importable
_job_worker = Path(__file__).resolve().parents[2] / "job-worker"
if str(_job_worker) not in sys.path:
    sys.path.insert(0, str(_job_worker))

from app.models import Job, UsageEvent, new_id  # noqa: E402
from worker_handlers import handle_usage_rollup  # noqa: E402

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
SQLModel.metadata.create_all(engine)


async def test_usage_rollup_yesterday() -> None:
    yesterday = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    ) - timedelta(days=1)

    with Session(engine) as session:
        session.add(
            UsageEvent(
                id=new_id(),
                user_id="u1",
                model="test",
                prompt_tokens=100,
                completion_tokens=50,
                cost_est=0.01,
                created_at=yesterday + timedelta(hours=2),
            )
        )
        session.add(
            UsageEvent(
                id=new_id(),
                user_id="u1",
                model="test",
                prompt_tokens=20,
                completion_tokens=10,
                cost_est=0.002,
                created_at=yesterday + timedelta(hours=5),
            )
        )
        session.add(
            UsageEvent(
                id=new_id(),
                user_id="u2",
                model="test",
                prompt_tokens=5,
                completion_tokens=5,
                cost_est=0.001,
                created_at=yesterday + timedelta(hours=1),
            )
        )
        session.add(
            UsageEvent(
                id=new_id(),
                user_id="u1",
                model="test",
                prompt_tokens=999,
                completion_tokens=999,
                cost_est=1.0,
                created_at=yesterday - timedelta(days=2),
            )
        )
        job = Job(type="usage.rollup", payload={}, status="running", user_id="sys")
        session.add(job)
        session.commit()
        session.refresh(job)

        await handle_usage_rollup(session, job)
        session.refresh(job)

        assert job.result_ref is not None
        assert job.result_ref != "noop"
        summary = json.loads(job.result_ref)
        assert summary["eventCount"] == 3
        assert summary["userCount"] == 2
        assert summary["promptTokens"] == 125
        assert summary["completionTokens"] == 65
