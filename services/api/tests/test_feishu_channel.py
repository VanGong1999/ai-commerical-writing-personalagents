"""飞书通道：入站策略、会话隔离、确认卡片 payload。"""

from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.feishu_notify import proposal_card_payload, upsert_delivery_bind
from app.models import Conversation, FeishuDeliveryBind, FeishuIdentity
from app.seed import DEMO_USER

FEISHU_ROOT = Path(__file__).resolve().parents[2] / "feishu"
if str(FEISHU_ROOT) not in sys.path:
    sys.path.insert(0, str(FEISHU_ROOT))

from cards import confirm_card  # noqa: E402
from ingress import decide_ingress, strip_mentions  # noqa: E402
from session import find_or_create_conversation, reset_conversation  # noqa: E402

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
SQLModel.metadata.create_all(engine)


def test_strip_mentions():
    assert strip_mentions("@_user_1 帮我写大纲") == "帮我写大纲"
    assert strip_mentions("  hello  ") == "hello"


def test_ingress_p2p_and_group_mention():
    d = decide_ingress(chat_type="p2p", text="生成核心梗", mentioned=False)
    assert d.action == "process"

    d = decide_ingress(chat_type="group", text="随便聊聊", mentioned=False, group_policy="mention")
    assert d.action == "silent_buffer"

    d = decide_ingress(chat_type="group", text="帮我写大纲", mentioned=False, group_policy="mention")
    assert d.action == "process"
    assert d.reason == "silent_writing_trigger"

    d = decide_ingress(chat_type="group", text="写一下", mentioned=True, group_policy="mention")
    assert d.action == "process"

    d = decide_ingress(chat_type="p2p", text="/status", mentioned=False)
    assert d.action == "control"
    assert d.command == "status"


def test_conversation_isolated_by_chat_id():
    with Session(engine) as session:
        a = find_or_create_conversation(session, open_id="ou_a", chat_id="oc_1", chat_type="p2p")
        b = find_or_create_conversation(session, open_id="ou_a", chat_id="oc_1", chat_type="p2p")
        c = find_or_create_conversation(session, open_id="ou_b", chat_id="oc_2", chat_type="group")
        assert a.id == b.id
        assert a.id != c.id
        assert a.user_id == DEMO_USER
        assert a.external_chat_id == "oc_1"
        assert c.external_chat_id == "oc_2"

        identities = list(session.exec(select(FeishuIdentity)))
        assert {i.open_id for i in identities} >= {"ou_a", "ou_b"}

        binds = list(session.exec(select(FeishuDeliveryBind)))
        assert any(x.chat_id == "oc_1" for x in binds)

        reset = reset_conversation(session, a)
        assert reset.id != a.id
        assert reset.external_chat_id == "oc_1"


def test_confirm_and_proposal_cards():
    card = confirm_card(
        conversation_id="conv1",
        message_id="msg1",
        title="需要确认",
        detail="即将写正文",
    )
    assert card["header"]["title"]["content"] == "需要确认"
    values = [a["value"] for a in card["elements"][1]["actions"]]
    assert values[0]["approve"] is True
    assert values[0]["conversation_id"] == "conv1"

    prop = proposal_card_payload(proposal_id="p1", message="缺大纲", priority=2)
    assert "主动提案" in prop["header"]["title"]["content"]
    assert prop["elements"][1]["actions"][0]["value"]["proposal_id"] == "p1"


def test_upsert_delivery_bind():
    with Session(engine) as session:
        conv = Conversation(user_id=DEMO_USER, source="feishu", title="t", external_chat_id="oc_x")
        session.add(conv)
        session.commit()
        session.refresh(conv)
        b1 = upsert_delivery_bind(session, conversation_id=conv.id, chat_id="oc_x", open_id="ou_x")
        b2 = upsert_delivery_bind(session, conversation_id=conv.id, chat_id="oc_y", open_id="ou_x")
        assert b1.id == b2.id
        assert b2.chat_id == "oc_y"
