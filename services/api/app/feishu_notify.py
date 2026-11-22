"""飞书出站通知（供 scheduler / job-worker / personal_agent 共用）。

凭 Settings 中的 FEISHU_APP_ID/SECRET 发消息；无凭据时静默跳过。
"""

from __future__ import annotations

import json
import logging
from typing import Any

from sqlmodel import Session, select

from .models import Conversation, FeishuDeliveryBind, utcnow
from .settings import get_settings

logger = logging.getLogger("feishu_notify")

_client = None
_client_key: tuple[str, str] | None = None


def _get_client():
    global _client, _client_key
    settings = get_settings()
    if not settings.feishu_app_id or not settings.feishu_app_secret:
        return None
    key = (settings.feishu_app_id, settings.feishu_app_secret)
    if _client is not None and _client_key == key:
        return _client
    try:
        from lark_oapi import Client
    except ImportError:
        logger.warning("lark-oapi 未安装，跳过飞书推送")
        return None
    _client = Client.builder().app_id(key[0]).app_secret(key[1]).timeout(15).build()
    _client_key = key
    return _client


def upsert_delivery_bind(
    session: Session,
    *,
    conversation_id: str,
    chat_id: str,
    open_id: str | None = None,
) -> FeishuDeliveryBind:
    row = session.exec(
        select(FeishuDeliveryBind).where(FeishuDeliveryBind.conversation_id == conversation_id)
    ).first()
    if row:
        row.chat_id = chat_id
        if open_id:
            row.open_id = open_id
        row.updated_at = utcnow()
    else:
        row = FeishuDeliveryBind(
            conversation_id=conversation_id,
            chat_id=chat_id,
            open_id=open_id,
        )
        session.add(row)
    session.commit()
    session.refresh(row)
    return row


def resolve_announce_chat_id(session: Session, conversation_id: str | None = None) -> str | None:
    settings = get_settings()
    if conversation_id:
        bind = session.exec(
            select(FeishuDeliveryBind).where(FeishuDeliveryBind.conversation_id == conversation_id)
        ).first()
        if bind and bind.chat_id:
            return bind.chat_id
        conv = session.get(Conversation, conversation_id)
        if conv and conv.external_chat_id:
            return conv.external_chat_id
    if settings.feishu_default_chat_id:
        return settings.feishu_default_chat_id
    latest = session.exec(
        select(FeishuDeliveryBind).order_by(FeishuDeliveryBind.updated_at.desc())
    ).first()
    if latest:
        return latest.chat_id
    feishu_convs = list(
        session.exec(
            select(Conversation)
            .where(Conversation.source == "feishu")
            .order_by(Conversation.updated_at.desc())
        )
    )
    for feishu_conv in feishu_convs:
        if feishu_conv.external_chat_id and not str(feishu_conv.external_chat_id).startswith("archived:"):
            return feishu_conv.external_chat_id
    return None


def create_message(client, chat_id: str, msg_type: str, content: str, *, request_uuid: str | None = None):
    from lark_oapi.api.im.v1 import CreateMessageRequest, CreateMessageRequestBody

    body = CreateMessageRequestBody.builder().receive_id(chat_id).msg_type(msg_type).content(content)
    if request_uuid:
        body.uuid(request_uuid)
    request = CreateMessageRequest.builder().receive_id_type("chat_id").request_body(body.build()).build()
    return client.im.v1.message.create(request)


def _send(chat_id: str, msg_type: str, body: dict[str, Any]) -> bool:
    client = _get_client()
    if not client or not chat_id:
        return False
    try:
        response = create_message(client, chat_id, msg_type, json.dumps(body, ensure_ascii=False))
        if response is None or not response.success():
            logger.warning("feishu send %s failed: %s", msg_type, getattr(response, "code", None))
            return False
        return True
    except Exception:
        logger.exception("feishu send %s error", msg_type)
        return False


def send_text(chat_id: str, text: str) -> bool:
    return bool(text) and _send(chat_id, "text", {"text": text})


def send_interactive(chat_id: str, card: dict[str, Any]) -> bool:
    return bool(card) and _send(chat_id, "interactive", card)


def announce_text(
    session: Session,
    text: str,
    *,
    conversation_id: str | None = None,
    chat_id: str | None = None,
    title: str = "通知",
) -> bool:
    target = chat_id or resolve_announce_chat_id(session, conversation_id)
    if not target:
        logger.info("no feishu chat to announce: %.60s", text)
        return False
    from .feishu_markdown import looks_like_markdown, md_cards

    if looks_like_markdown(text):
        ok = True
        for card in md_cards(title=title, markdown=text, template="blue"):
            ok = send_interactive(target, card) and ok
        return ok
    return send_text(target, text)


def announce_card(
    session: Session,
    card: dict[str, Any],
    *,
    conversation_id: str | None = None,
    chat_id: str | None = None,
) -> bool:
    target = chat_id or resolve_announce_chat_id(session, conversation_id)
    if not target:
        logger.info("no feishu chat to announce card")
        return False
    return send_interactive(target, card)


def announce_run_finished(
    session: Session,
    *,
    conversation_id: str | None,
    status: str,
    summary: str,
    project_title: str | None = None,
) -> bool:
    prefix = f"《{project_title}》" if project_title else ""
    text = f"{prefix}任务{status}：{summary}"
    return announce_text(session, text, conversation_id=conversation_id)


def proposal_card_payload(*, proposal_id: str, message: str, priority: int = 0) -> dict[str, Any]:
    level = "高" if priority >= 2 else ("中" if priority == 1 else "低")
    return {
        "config": {"wide_screen_mode": True},
        "header": {
            "title": {"tag": "plain_text", "content": f"主动提案（优先级 {level}）"},
            "template": "blue",
        },
        "elements": [
            {"tag": "div", "text": {"tag": "lark_md", "content": message}},
            {
                "tag": "action",
                "actions": [
                    {
                        "tag": "button",
                        "text": {"tag": "plain_text", "content": "批准提案"},
                        "type": "primary",
                        "value": {
                            "action": "proposal",
                            "approve": True,
                            "proposal_id": proposal_id,
                        },
                    },
                    {
                        "tag": "button",
                        "text": {"tag": "plain_text", "content": "稍后"},
                        "type": "default",
                        "value": {
                            "action": "proposal",
                            "approve": False,
                            "proposal_id": proposal_id,
                        },
                    },
                ],
            },
        ],
    }


def announce_proposals(session: Session, proposals: list[Any], *, limit: int = 5) -> int:
    """把待处理提案推到飞书；高优先级优先。返回推送条数。"""
    from .models import TaskProposal

    pending = [p for p in proposals if getattr(p, "status", None) == "pending"]
    pending.sort(key=lambda p: int(getattr(p, "priority", 0) or 0), reverse=True)
    sent = 0
    for prop in pending[:limit]:
        if not isinstance(prop, TaskProposal):
            continue
        # 低风险（priority==0）可只发文本；中高发卡片
        if int(prop.priority or 0) >= 1:
            ok = announce_card(
                session,
                proposal_card_payload(
                    proposal_id=prop.id,
                    message=prop.message,
                    priority=int(prop.priority or 0),
                ),
            )
        else:
            ok = announce_text(session, f"💡 主动提案：{prop.message}\n（可在工作台批准，或回复相关指令）")
        if ok:
            sent += 1
    return sent
