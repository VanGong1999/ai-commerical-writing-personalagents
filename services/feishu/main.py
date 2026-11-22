#!/usr/bin/env python3
"""飞书 WebSocket 长连接：单聊/群聊 → Personal Agent（手机入口）。

凭据：FEISHU_APP_ID / FEISHU_APP_SECRET（.env）。
群聊策略：FEISHU_GROUP_POLICY=mention|always。
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1] / "api"
FEISHU_ROOT = Path(__file__).resolve().parent
for p in (API_ROOT, FEISHU_ROOT):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from app.db import init_db
from app.settings import get_settings

from delivery import Delivery
from handler import (
    ensure_async_runtime,
    handle_card_event_sync,
    handle_message_event_sync,
    set_delivery,
    stop_async_runtime,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("feishu")


def main() -> None:
    init_db()
    settings = get_settings()
    if not settings.feishu_app_id or not settings.feishu_app_secret:
        logger.error("缺少 FEISHU_APP_ID / FEISHU_APP_SECRET，请在 .env 中配置。")
        return

    try:
        import lark_oapi as lark  # noqa: F401
    except ImportError:
        logger.error("未安装 lark-oapi。请在 services/api 依赖中加入 lark-oapi 后 uv sync。")
        return

    from lark_oapi import Client, EventDispatcherHandler, LogLevel, ws
    from lark_oapi.event.callback.model.p2_card_action_trigger import (
        CallBackCard,
        CallBackToast,
        P2CardActionTriggerResponse,
    )

    api_client = Client.builder().app_id(settings.feishu_app_id).app_secret(settings.feishu_app_secret).build()
    set_delivery(Delivery(api_client))
    ensure_async_runtime()

    def on_message(data):
        handle_message_event_sync(data)

    def on_card(data):
        result = handle_card_event_sync(data)
        resp = P2CardActionTriggerResponse()
        toast = result.get("toast") if isinstance(result, dict) else None
        card = result.get("card") if isinstance(result, dict) else None
        if toast:
            t = CallBackToast()
            t.type = toast.get("type") or "info"
            t.content = toast.get("content") or ""
            resp.toast = t
        if card:
            c = CallBackCard()
            c.type = "raw"
            c.data = card
            resp.card = c
        return resp

    dispatcher = (
        EventDispatcherHandler.builder("", "")
        .register_p2_im_message_receive_v1(on_message)
        .register_p2_card_action_trigger(on_card)
        .build()
    )
    client = ws.Client(
        settings.feishu_app_id,
        settings.feishu_app_secret,
        event_handler=dispatcher,
        log_level=LogLevel.INFO,
    )
    logger.info(
        "feishu ws starting… group_policy=%s default_chat=%s",
        settings.feishu_group_policy,
        settings.feishu_default_chat_id or "(latest bind)",
    )
    try:
        client.start()
    finally:
        stop_async_runtime()


if __name__ == "__main__":
    main()
