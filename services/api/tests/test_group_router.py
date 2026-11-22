"""群聊路由与提及解析。"""

from __future__ import annotations

from app.bot_registry import CHIEF_BOT_ID, EGG_BOT_ID, resolve_mentions, seed_system_bots
from app.db import engine, init_db
from app.group_router import _lead_bot_id, _member_bots, _speak_policy
from app.models import Conversation
from sqlmodel import Session


def test_member_bots_and_lead():
    init_db()
    with Session(engine) as session:
        seed_system_bots(session)
        conv = Conversation(
            user_id="demo",
            source="assistant",
            kind="group",
            title="群",
            member_bot_ids=[CHIEF_BOT_ID, EGG_BOT_ID],
            group_rules={"speak_policy": "orchestrated", "lead_bot_id": CHIEF_BOT_ID},
        )
        session.add(conv)
        session.commit()
        members = _member_bots(session, conv)
        assert {m.id for m in members} >= {CHIEF_BOT_ID, EGG_BOT_ID}
        assert _lead_bot_id(session, conv, members) == CHIEF_BOT_ID
        assert _speak_policy(session, conv) == "orchestrated"


def test_mention_only_ids():
    init_db()
    with Session(engine) as session:
        bots = seed_system_bots(session)
        assert resolve_mentions("你好", bots) == []
        assert CHIEF_BOT_ID in resolve_mentions("@幕僚长 看看", bots)
