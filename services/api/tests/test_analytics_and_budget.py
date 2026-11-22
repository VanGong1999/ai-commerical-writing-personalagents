from __future__ import annotations

from datetime import datetime, timezone

import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine
from starlette.testclient import TestClient

from app.db import get_session
from app.main import api, app
from app.models import ProjectStageEvent, UsageEvent, new_id, utcnow
from app.seed import DEMO_USER

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
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


def _make_project(title: str = "图表流", fmt: str = "manju") -> dict:
    res = client.post("/api/v1/projects", json={"title": title, "format": fmt})
    assert res.status_code == 200, res.text
    return res.json()


def test_stage_events_recorded_on_transitions():
    project = _make_project()
    pid = project["id"]
    patched = client.patch(
        f"/api/v1/projects/{pid}",
        json={"stage": "S2_HOOK_SELECT"},
    )
    assert patched.status_code == 200, patched.text
    with Session(engine) as session:
        events = session.query(ProjectStageEvent).filter(
            ProjectStageEvent.project_id == pid
        ).all()
    stages = [e.to_stage for e in events]
    assert stages == ["S0_SETUP", "S2_HOOK_SELECT"]
    assert events[0].from_stage is None
    assert events[1].from_stage == "S0_SETUP"


def test_analytics_charts_returns_trend_adoption_durations():
    project = _make_project(fmt="short_novel")
    pid = project["id"]
    art = client.post(
        f"/api/v1/projects/{pid}/artifacts",
        json={
            "type": "manuscript",
            "title": "第一章",
            "status": "adopted",
            "viaOntologyAction": True,
            "bodyMarkdown": "　" + "正文内容" * 100,
        },
    ).json()
    assert art["id"]
    res = client.get(f"/api/v1/projects/{pid}/analytics-charts")
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["adoption"]["adopted"] == 1
    assert data["adoption"]["rate"] == 1.0
    assert data["totalWords"] > 0
    assert len(data["manuscriptTrend"]) == 1
    assert len(data["stageDurations"]) == 1
    assert data["stageDurations"][0]["stage"] == "S0_SETUP"


def test_app_settings_roundtrip_and_usage_summary_budget():
    settings0 = client.get("/api/v1/settings/app").json()
    assert settings0.get("usageBudgetMonthly") is None
    patched = client.patch(
        "/api/v1/settings/app",
        json={"usageBudgetMonthly": 1_000_000},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["usageBudgetMonthly"] == 1_000_000

    with Session(engine) as session:
        session.add(
            UsageEvent(
                user_id=DEMO_USER,
                model="deepseek-flash",
                prompt_tokens=100,
                completion_tokens=50,
            )
        )
        session.commit()
    summary = client.get("/api/v1/usage/summary").json()
    assert summary["used"] == 150
    assert summary["budget"] == 1_000_000
    assert summary["remaining"] == 999_850
    assert summary["over"] is False
    assert summary["byModel"][0]["model"] == "deepseek-flash"

    cleared = client.patch(
        "/api/v1/settings/app",
        json={"usageBudgetMonthly": None},
    ).json()
    assert cleared["usageBudgetMonthly"] is None
    summary2 = client.get("/api/v1/usage/summary").json()
    assert summary2["budget"] is None
    assert summary2["remaining"] is None


def test_usage_summary_counts_current_month_only():
    before = client.get("/api/v1/usage/summary").json()["used"]
    with Session(engine) as session:
        now = utcnow()
        session.add(
            UsageEvent(
                user_id=DEMO_USER,
                model="deepseek-flash",
                prompt_tokens=10,
                completion_tokens=0,
                created_at=now,
            )
        )
        old = now.replace(day=1)
        if old.month == 1:
            old = old.replace(year=old.year - 1, month=12)
        else:
            old = old.replace(month=old.month - 1)
        session.add(
            UsageEvent(
                user_id=DEMO_USER,
                model="deepseek-flash",
                prompt_tokens=999,
                completion_tokens=0,
                created_at=old,
            )
        )
        session.commit()
    summary = client.get("/api/v1/usage/summary").json()
    assert summary["used"] == before + 10


def test_dashboard_summary_days_window():
    res = client.get("/api/v1/dashboard/summary?days=30")
    assert res.status_code == 200, res.text
    assert len(res.json()["usageTrend"]) == 30
    res14 = client.get("/api/v1/dashboard/summary?days=14")
    assert len(res14.json()["usageTrend"]) == 14
