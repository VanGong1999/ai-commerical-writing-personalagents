"""飞书出站：文本 / lark_md 卡片 / 进度批处理。"""

from __future__ import annotations

import json
import logging
import time
from typing import Any

from app.feishu_markdown import looks_like_markdown, md_cards
from app.feishu_notify import send_interactive, send_text
from app.settings import get_settings

from cards import confirm_card, result_cards

logger = logging.getLogger("feishu.delivery")


class Delivery:
    """持有可选的 lark Client；无 client 时走 feishu_notify 全局 client。"""

    def __init__(self, client=None):
        self.client = client
        # chat_id -> {lines, last_flush}
        self._progress_buf: dict[str, dict[str, Any]] = {}

    def text(self, chat_id: str, text: str) -> None:
        if not text:
            return
        # 含 Markdown 或较长内容 → 卡片渲染
        if looks_like_markdown(text):
            self.md(chat_id, "消息", text)
            return
        if self.client is None:
            send_text(chat_id, text)
            return
        try:
            from lark_oapi.api.im.v1 import CreateMessageRequest, CreateMessageRequestBody

            req = (
                CreateMessageRequest.builder()
                .receive_id_type("chat_id")
                .request_body(
                    CreateMessageRequestBody.builder()
                    .receive_id(chat_id)
                    .msg_type("text")
                    .content(json.dumps({"text": text}, ensure_ascii=False))
                    .build()
                )
                .build()
            )
            self.client.im.v1.message.create(req)
            logger.info("replied text to %s: %.60s", chat_id, text)
        except Exception:  # noqa: BLE001
            logger.exception("reply text failed")

    def card(self, chat_id: str, card: dict[str, Any]) -> None:
        if self.client is None:
            send_interactive(chat_id, card)
            return
        try:
            from lark_oapi.api.im.v1 import CreateMessageRequest, CreateMessageRequestBody

            req = (
                CreateMessageRequest.builder()
                .receive_id_type("chat_id")
                .request_body(
                    CreateMessageRequestBody.builder()
                    .receive_id(chat_id)
                    .msg_type("interactive")
                    .content(json.dumps(card, ensure_ascii=False))
                    .build()
                )
                .build()
            )
            self.client.im.v1.message.create(req)
            logger.info("replied card to %s", chat_id)
        except Exception:  # noqa: BLE001
            logger.exception("reply card failed")

    def md(self, chat_id: str, title: str, markdown: str) -> None:
        for c in md_cards(title=title, markdown=markdown):
            self.card(chat_id, c)

    def _verbose_progress(self) -> bool:
        return bool(getattr(get_settings(), "feishu_progress_verbose", False))

    def _buffer_progress(self, chat_id: str, line: str, *, flush: bool = False) -> None:
        buf = self._progress_buf.setdefault(chat_id, {"lines": [], "t": time.time()})
        if line:
            buf["lines"].append(line)
        now = time.time()
        should_flush = flush or len(buf["lines"]) >= 4 or (now - float(buf["t"])) >= 2.5
        if not should_flush or not buf["lines"]:
            return
        text = "\n".join(buf["lines"])
        buf["lines"] = []
        buf["t"] = now
        # 短进度保持纯文本
        if self.client is None:
            send_text(chat_id, text)
            return
        try:
            from lark_oapi.api.im.v1 import CreateMessageRequest, CreateMessageRequestBody

            req = (
                CreateMessageRequest.builder()
                .receive_id_type("chat_id")
                .request_body(
                    CreateMessageRequestBody.builder()
                    .receive_id(chat_id)
                    .msg_type("text")
                    .content(json.dumps({"text": text}, ensure_ascii=False))
                    .build()
                )
                .build()
            )
            self.client.im.v1.message.create(req)
        except Exception:  # noqa: BLE001
            logger.exception("progress flush failed")

    def progress(self, chat_id: str, event: str, data: dict[str, Any]) -> None:
        """Supervisor emit → 进度批处理 / MD 结果卡。"""
        verbose = self._verbose_progress()
        if event == "plan":
            goal = data.get("goal") or ""
            steps = data.get("steps") or []
            n = len(steps) if isinstance(steps, list) else 0
            line = f"计划：{goal}" + (f"（{n} 步）" if n else "")
            if verbose:
                self._buffer_progress(chat_id, line)
            else:
                self._buffer_progress(chat_id, line)
        elif event == "tool_call":
            if not verbose:
                return
            tool = data.get("tool") or "?"
            self._buffer_progress(chat_id, f"执行：{tool}")
        elif event == "tool_result":
            tool = data.get("tool") or "?"
            detail = data.get("detail") or {}
            if isinstance(detail, dict) and (
                detail.get("run_id") or detail.get("job_id") or detail.get("runId")
            ):
                rid = detail.get("run_id") or detail.get("runId") or detail.get("job_id")
                self._buffer_progress(chat_id, f"已启动 {tool}（{rid}），完成后通知。", flush=True)
            elif verbose:
                self._buffer_progress(chat_id, f"{tool} 完成")
            # 若 detail 带 markdown 摘要
            summary = ""
            if isinstance(detail, dict):
                summary = str(detail.get("summary") or detail.get("reply") or "")
            if summary and looks_like_markdown(summary):
                self._buffer_progress(chat_id, "", flush=True)
                self.md(chat_id, f"{tool} 结果", summary)
        elif event == "error":
            self._buffer_progress(chat_id, "", flush=True)
            self.text(chat_id, f"出错：{data.get('message') or '未知错误'}")
        elif event == "confirm":
            self._buffer_progress(chat_id, "", flush=True)
            mid = data.get("messageId") or ""
            cid = data.get("conversationId") or ""
            msg = data.get("message") or "需要你确认"
            if cid and mid:
                self.card(
                    chat_id,
                    confirm_card(
                        conversation_id=cid,
                        message_id=mid,
                        title="需要确认",
                        detail=msg,
                    ),
                )
            else:
                self.text(chat_id, f"{msg}\n（也可回复「批准」或「拒绝」）")
        elif event == "done":
            self._buffer_progress(chat_id, "", flush=True)
            reply = data.get("reply")
            if reply:
                conv_id = data.get("conversationId") or ""
                continue_url = None
                if conv_id:
                    # 本地 Web 续聊入口（用户可在浏览器打开）
                    continue_url = f"http://127.0.0.1:5173/agent?c={conv_id}"
                for c in result_cards(title="处理完成", body=str(reply), continue_url=continue_url):
                    self.card(chat_id, c)
