"""飞书 @Bot名 路由与控制命令。"""

from __future__ import annotations

from app.bot_registry import CHIEF_BOT_ID, seed_system_bots
from app.db import engine, init_db
from app.ingress_policy import decide, parse_control
from sqlmodel import Session


def test_parse_bots_team_commands():
    assert parse_control("/bots") == ("bots", "")
    assert parse_control("/team list") == ("team", "list")
    assert parse_control("/help") == ("help", "")


def test_feishu_bot_alias_decision():
    init_db()
    with Session(engine) as session:
        seed_system_bots(session)
    d = decide(
        source="feishu",
        text="@幕僚长 帮我看看进度",
        chat_type="group",
        mentioned=False,
        group_policy="mention",
    )
    assert d.action == "must"
    assert d.target_bot_id == CHIEF_BOT_ID or (d.mention_bot_ids and CHIEF_BOT_ID in d.mention_bot_ids)
