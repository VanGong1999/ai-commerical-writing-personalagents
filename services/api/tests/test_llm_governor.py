"""LLM Governor：自适应并发、admit、节流掉队。"""

from __future__ import annotations

import pytest
from app import llm_governor as gov


@pytest.fixture(autouse=True)
def isolated_backend(monkeypatch):
    monkeypatch.setattr(gov, "_get_redis", lambda: None)
    monkeypatch.setenv("LLM_MIN_REQUEST_INTERVAL_S", "0")


def setup_function() -> None:
    gov.reset_memory_for_tests()
    # Force in-memory path: pretend redis unavailable by resetting queue client
    from app.queue import reset_queue_clients

    reset_queue_clients()
    # Mark redis failed so governor uses memory
    import app.queue as q

    q._redis_failed = True
    gov.reset_memory_for_tests()
    cfg = gov.TrafficConfig(worker_concurrency_cap=3, adaptive_enabled=True, failover_enabled=True)
    gov._sync_cap_to_hot(cfg)


def teardown_function() -> None:
    # Governor tests intentionally leave admission counters and cooldowns hot.
    # Clear those process globals before daemon/integration tests share them.
    gov.reset_memory_for_tests()
    from app.queue import reset_queue_clients
    reset_queue_clients()


def test_admit_and_release_slots():
    assert gov.try_admit(priority="agent_run")
    assert gov.try_admit(priority="agent_run")
    assert gov.try_admit(priority="agent_run")
    # at cap
    assert not gov.try_admit(priority="agent_run")
    assert not gov.slots_available(priority="fleet")
    # Every model call shares the subscription capacity, including meta.
    assert not gov.try_admit(priority="pa_meta")
    gov.release()
    gov.release()
    gov.release()
    gov.release()
    assert gov.slots_available(priority="fleet")


def test_throttle_lowers_effective_and_blocks():
    assert gov.try_admit(priority="agent_run")
    gov.release()
    gov.report_throttle(retry_after_s=30, provider_id="minimax")
    st = gov.status()
    assert st.effective == 2  # 3 -> 2
    assert st.throttled
    assert not gov.slots_available(priority="fleet")
    assert gov.provider_in_cooldown("minimax")
    # Metadata model calls also respect the provider cooldown.
    assert not gov.slots_available(priority="pa_meta")


def test_success_streak_recovers_effective():
    gov.report_throttle(retry_after_s=0.01, provider_id="x")
    # clear throttle window manually
    with gov._LOCK:
        gov._MEM["throttle_until"] = 0.0
    before = gov.status().effective
    for _ in range(8):
        gov.report_success()
    after = gov.status().effective
    assert after >= before
    assert after <= gov.status().cap


def test_worker_view_shape():
    view = gov.worker_view()
    assert "cap" in view and "effective" in view and "throttled" in view


def test_llm_traffic_api_roundtrip():
    from sqlalchemy.pool import StaticPool
    from sqlmodel import Session, SQLModel, create_engine
    from starlette.testclient import TestClient

    from app.db import get_session
    from app.main import api, app

    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)

    def override_session():
        with Session(engine) as session:
            yield session

    api.dependency_overrides[get_session] = override_session
    client = TestClient(app)
    try:
        got = client.get("/api/v1/settings/llm-traffic")
        assert got.status_code == 200, got.text
        body = got.json()
        assert "cap" in body and "effective" in body

        patched = client.patch(
            "/api/v1/settings/llm-traffic",
            json={"workerConcurrencyCap": 2, "failoverEnabled": True, "adaptiveEnabled": True},
        )
        assert patched.status_code == 200, patched.text
        assert patched.json()["cap"] == 2

        report = client.post(
            "/api/v1/internal/llm-governor/report",
            json={"event": "throttle", "retryAfterS": 10, "providerId": "test"},
        )
        assert report.status_code == 200, report.text
        assert report.json()["effective"] <= 2
    finally:
        api.dependency_overrides.pop(get_session, None)
