"""按 Bot 汇总用量。"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.bot_registry import CHIEF_BOT_ID, seed_system_bots
from app.db import engine, init_db
from app.main import app
from app.models import UsageEvent
from app.seed import DEMO_USER
from sqlmodel import Session


def test_usage_summary_by_bot():
    init_db()
    with Session(engine) as session:
        seed_system_bots(session)
        session.add(
            UsageEvent(
                user_id=DEMO_USER,
                bot_id=CHIEF_BOT_ID,
                model="test-model",
                prompt_tokens=100,
                completion_tokens=50,
                cost_est=0.01,
            )
        )
        session.commit()
    client = TestClient(app)
    r = client.get("/api/v1/usage/summary")
    assert r.status_code == 200
    body = r.json()
    assert "byBot" in body or "by_bot" in body or any(
        k.lower().endswith("bot") for k in body.keys()
    )
    # CamelJSONResponse → byBot
    by_bot = body.get("byBot") or body.get("by_bot") or []
    assert any(x.get("botId") == CHIEF_BOT_ID or x.get("bot_id") == CHIEF_BOT_ID for x in by_bot)
