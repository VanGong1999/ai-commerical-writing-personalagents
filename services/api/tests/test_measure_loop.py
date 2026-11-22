import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlmodel import Session, select

# job-worker handlers share app.* via PYTHONPATH; ensure sibling package is importable
_job_worker = Path(__file__).resolve().parents[2] / "job-worker"
if str(_job_worker) not in sys.path:
    sys.path.insert(0, str(_job_worker))

from app.db import engine, init_db  # noqa: E402
from app.models import Job, TaskProposal  # noqa: E402
from app.routers.workbench import _analytics_changed  # noqa: E402
from app.seed import DEMO_USER  # noqa: E402
from worker_handlers import handle_analytics_review  # noqa: E402


@pytest.fixture(autouse=True)
def _init():
    init_db()


def test_first_snapshot_not_changed():
    assert _analytics_changed(None, SimpleNamespace(views=10, favorites=2, retention={})) is False


def test_changed_values_true():
    prev = SimpleNamespace(views=10, favorites=2, retention={})
    assert _analytics_changed(prev, SimpleNamespace(views=20, favorites=2, retention={})) is True


def test_unchanged_false():
    prev = SimpleNamespace(views=10, favorites=2, retention={})
    assert _analytics_changed(prev, SimpleNamespace(views=10, favorites=2, retention={})) is False


def test_handle_analytics_review_creates_proposal():
    with Session(engine) as s:
        job = Job(
            type="analytics.review",
            payload={"project_id": "p1"},
            user_id=DEMO_USER,
            status="queued",
        )
        s.add(job)
        s.commit()
        asyncio.run(handle_analytics_review(s, job))
        prop = s.exec(select(TaskProposal).where(TaskProposal.type == "revise")).first()
        assert prop is not None
        assert prop.actions[0].get("inputJson") == {"project_id": "p1"}


def test_handle_analytics_review_dedupes():
    with Session(engine) as s:
        job = Job(
            type="analytics.review",
            payload={"project_id": "p1"},
            user_id=DEMO_USER,
            status="queued",
        )
        s.add(job)
        s.commit()
        asyncio.run(handle_analytics_review(s, job))
        asyncio.run(handle_analytics_review(s, job))
        props = list(s.exec(select(TaskProposal).where(TaskProposal.type == "revise")))
        assert len(props) == 1
