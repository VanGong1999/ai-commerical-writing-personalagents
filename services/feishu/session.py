"""飞书会话：open_id 映射 + 按 chat_id 隔离 Conversation。"""

from __future__ import annotations

from sqlmodel import Session, select

from app.feishu_notify import upsert_delivery_bind
from app.models import Conversation, FeishuIdentity, Message, utcnow
from app.seed import DEMO_USER


def resolve_user(session: Session, open_id: str) -> str:
    row = session.exec(select(FeishuIdentity).where(FeishuIdentity.open_id == open_id)).first()
    if row:
        return row.user_id
    session.add(FeishuIdentity(open_id=open_id, user_id=DEMO_USER))
    session.commit()
    return DEMO_USER


def find_or_create_conversation(
    session: Session,
    *,
    open_id: str,
    chat_id: str,
    chat_type: str = "p2p",
) -> Conversation:
    """单用户 DEMO_USER；按 external_chat_id 隔离（单聊/群聊各一会话）。"""
    resolve_user(session, open_id)
    conv = session.exec(
        select(Conversation).where(
            Conversation.source == "feishu",
            Conversation.user_id == DEMO_USER,
            Conversation.external_chat_id == chat_id,
        )
    ).first()
    if conv:
        if open_id and conv.external_open_id != open_id:
            conv.external_open_id = open_id
            conv.updated_at = utcnow()
            session.add(conv)
            session.commit()
            session.refresh(conv)
        upsert_delivery_bind(session, conversation_id=conv.id, chat_id=chat_id, open_id=open_id)
        return conv

    title = "飞书单聊" if chat_type == "p2p" else f"飞书群聊 {chat_id[:8]}"
    conv = Conversation(
        user_id=DEMO_USER,
        source="feishu",
        title=title,
        external_chat_id=chat_id,
        external_open_id=open_id,
    )
    session.add(conv)
    session.commit()
    session.refresh(conv)
    upsert_delivery_bind(session, conversation_id=conv.id, chat_id=chat_id, open_id=open_id)
    return conv


def reset_conversation(session: Session, conv: Conversation) -> Conversation:
    """新建同 chat 会话，旧会话保留账本但不再使用（/reset）。"""
    chat_id = conv.external_chat_id or ""
    open_id = conv.external_open_id or ""
    # 清空 external 绑定，避免唯一逻辑冲突（同一 chat 只查最新有 external 的）
    old_chat = conv.external_chat_id
    conv.external_chat_id = f"archived:{conv.id}:{old_chat or ''}"
    conv.updated_at = utcnow()
    session.add(conv)
    session.commit()
    return find_or_create_conversation(
        session,
        open_id=open_id,
        chat_id=chat_id,
        chat_type="p2p" if "单聊" in (conv.title or "") else "group",
    )


def find_pending_confirm(session: Session, conversation_id: str) -> Message | None:
    rows = list(
        session.exec(
            select(Message)
            .where(Message.conversation_id == conversation_id)
            .order_by(Message.created_at.desc())
        )
    )
    for m in rows:
        for act in m.actions or []:
            if act.get("type") == "confirm_required":
                return m
    return None
