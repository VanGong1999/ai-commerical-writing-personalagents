"""计价、用量重算、热点 CRUD、功能开关回归。"""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.db import engine, init_db
from app.main import app
from app.models import Project, ProviderConfig, UsageEvent
from app.pricing import DEFAULT_MODEL_PRICING, estimate_cost, upgrade_stale_deepseek_pricing
from app.seed import DEMO_USER


def test_estimate_cost_math():
    assert estimate_cost(None, 100, 50) is None
    # 1M 输入 ¥1 / 1M + 0.5M 输出 ¥4 / 1M = 1 + 2
    assert estimate_cost({"input": 1.0, "output": 4.0}, 1_000_000, 500_000) == 3.0
    # 缓存命中按 0.5 计：800k*0.5 + 200k*1 + 300k 输出*4 = 0.4 + 0.2 + 1.2
    value = estimate_cost(
        {"input": 1.0, "cachedInput": 0.5, "output": 4.0},
        1_000_000,
        300_000,
        cache_hit_tokens=800_000,
        cache_miss_tokens=200_000,
    )
    assert abs(value - 1.8) < 1e-6


def test_deepseek_default_pricing_uses_official_peak_rates():
    """默认估算按 DeepSeek 官方高峰时段价（元/百万 tokens）。"""
    assert DEFAULT_MODEL_PRICING["deepseek-flash"] == {
        "input": 2.0,
        "cachedInput": 0.04,
        "output": 8.0,
    }
    assert DEFAULT_MODEL_PRICING["deepseek-v4-pro"] == {
        "input": 9.0,
        "cachedInput": 0.30,
        "output": 27.0,
    }
    # 1M 全未命中输入 + 0.5M 输出：flash 高峰 = 2 + 4 = 6
    assert (
        estimate_cost(DEFAULT_MODEL_PRICING["deepseek-flash"], 1_000_000, 500_000) == 6.0
    )
    # 800k 命中 + 200k 未命中 + 100k 输出：flash = 800k*0.04 + 200k*2 + 100k*8
    peak_flash = estimate_cost(
        DEFAULT_MODEL_PRICING["deepseek-flash"],
        1_000_000,
        100_000,
        cache_hit_tokens=800_000,
        cache_miss_tokens=200_000,
    )
    assert abs(peak_flash - 1.232) < 1e-6


def test_upgrade_stale_deepseek_pricing_only_replaces_known_old_defaults():
    stale = {
        "deepseek-flash": {"input": 1.0, "cachedInput": 0.3, "output": 4.0},
        "deepseek-v4-pro": {"input": 2.0, "cachedInput": 0.5, "output": 8.0},
        "custom-model": {"input": 3.0, "cachedInput": 1.0, "output": 9.0},
    }
    custom_kept = {
        "deepseek-flash": {"input": 1.5, "cachedInput": 0.1, "output": 5.0},
        "deepseek-v4-pro": {"input": 9.0, "cachedInput": 0.30, "output": 27.0},
    }
    upgraded = upgrade_stale_deepseek_pricing(stale)
    assert upgraded["deepseek-flash"] == DEFAULT_MODEL_PRICING["deepseek-flash"]
    assert upgraded["deepseek-v4-pro"] == DEFAULT_MODEL_PRICING["deepseek-v4-pro"]
    assert upgraded["custom-model"] == {"input": 3.0, "cachedInput": 1.0, "output": 9.0}
    assert upgrade_stale_deepseek_pricing(custom_kept) == custom_kept


def test_usage_cost_computed_from_provider_pricing():
    init_db()
    with Session(engine) as session:
        session.add(
            ProviderConfig(
                name="测试商",
                base_url="https://example.test/v1",
                models=["test-model"],
                selected_model="test-model",
                enabled=True,
                is_default=True,
                pricing={
                    "pricing-test-model-xyz": {"input": 1.0, "cachedInput": 0.5, "output": 4.0}
                },
            )
        )
        session.add(
            UsageEvent(
                user_id=DEMO_USER,
                model="pricing-test-model-xyz",
                prompt_tokens=1_000_000,
                completion_tokens=500_000,
            )
        )
        session.add(
            UsageEvent(
                user_id=DEMO_USER,
                model="unknown-model-xyz",
                prompt_tokens=100,
                completion_tokens=50,
            )
        )
        session.commit()
    client = TestClient(app)
    rows = client.get("/api/v1/usage").json()
    by_model = {row["model"]: row for row in rows}
    assert by_model["pricing-test-model-xyz"]["costEst"] == 3.0
    assert by_model["unknown-model-xyz"]["costEst"] is None
    summary = client.get("/api/v1/usage/summary").json()
    assert summary["costEst"] >= 3.0


def test_list_usage_multiple_unknown_models_does_not_500():
    """多笔未知单价模型并存时，/usage 不能因把 None 写回 NOT NULL 的 cost_est 而 500。"""
    init_db()
    with Session(engine) as session:
        for i in range(2):
            session.add(
                UsageEvent(
                    user_id=DEMO_USER,
                    model=f"unknown-model-multi-{i}",
                    prompt_tokens=100,
                    completion_tokens=50,
                )
            )
        session.commit()
    client = TestClient(app)
    resp = client.get("/api/v1/usage")
    assert resp.status_code == 200
    by_model = {row["model"]: row for row in resp.json()}
    assert by_model["unknown-model-multi-0"]["costEst"] is None
    assert by_model["unknown-model-multi-1"]["costEst"] is None


def test_recalc_token_usage():
    init_db()
    with Session(engine) as session:
        project = Project(
            user_id=DEMO_USER,
            title="重算测试",
            format="manju",
            stage="S0_IDEA",
            token_used=999,
        )
        session.add(project)
        session.commit()
        session.refresh(project)
        pid = project.id
        session.add(
            UsageEvent(
                user_id=DEMO_USER,
                project_id=pid,
                model="test-model",
                prompt_tokens=1200,
                completion_tokens=300,
            )
        )
        session.commit()
    client = TestClient(app)
    result = client.post("/api/v1/maintenance/recalc-token-usage").json()
    assert result["updatedProjects"] >= 1
    assert result["events"] >= 1
    with Session(engine) as session:
        refreshed = session.get(Project, pid)
        assert refreshed.token_used == 1500


def test_hotspot_crud():
    init_db()
    client = TestClient(app)
    created = client.post(
        "/api/v1/kb/hotspots",
        json={"title": "手动热点", "genre": "重生", "source": "手动", "summary": "一句话卖点"},
    )
    assert created.status_code == 200, created.text
    item = created.json()
    updated = client.patch(
        f"/api/v1/kb/hotspots/{item['id']}",
        json={"title": "手动热点改", "genre": "重生", "source": "手动", "summary": "改后摘要"},
    )
    assert updated.status_code == 200
    assert updated.json()["title"] == "手动热点改"
    deleted = client.delete(f"/api/v1/kb/hotspots/{item['id']}")
    assert deleted.status_code == 200
    remaining_ids = {row["id"] for row in client.get("/api/v1/kb/hotspots").json()}
    assert item["id"] not in remaining_ids


def test_feature_toggles_roundtrip():
    init_db()
    client = TestClient(app)
    patched = client.patch(
        "/api/v1/settings/app",
        json={"featureToggles": {"qcDeAi": False}},
    )
    assert patched.status_code == 200
    toggles = patched.json()["featureToggles"]
    assert toggles["qcDeAi"] is False
    assert toggles["logicScan"] is True
    fetched = client.get("/api/v1/settings/app").json()
    assert fetched["featureToggles"]["qcDeAi"] is False
