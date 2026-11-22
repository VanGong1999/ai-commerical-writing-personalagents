"""飞书互动卡片：确认 / 提案 / Markdown 结果。"""

from __future__ import annotations

from typing import Any

from app.feishu_markdown import md_card, md_cards, markdown_to_lark_md


def confirm_card(
    *,
    conversation_id: str,
    message_id: str,
    title: str,
    detail: str = "",
) -> dict[str, Any]:
    elements: list[dict[str, Any]] = [
        {
            "tag": "div",
            "text": {"tag": "lark_md", "content": markdown_to_lark_md(detail or title)},
        },
        {
            "tag": "action",
            "actions": [
                {
                    "tag": "button",
                    "text": {"tag": "plain_text", "content": "批准"},
                    "type": "primary",
                    "value": {
                        "action": "confirm",
                        "approve": True,
                        "conversation_id": conversation_id,
                        "message_id": message_id,
                    },
                },
                {
                    "tag": "button",
                    "text": {"tag": "plain_text", "content": "拒绝"},
                    "type": "danger",
                    "value": {
                        "action": "confirm",
                        "approve": False,
                        "conversation_id": conversation_id,
                        "message_id": message_id,
                    },
                },
            ],
        },
    ]
    return {
        "config": {"wide_screen_mode": True},
        "header": {
            "title": {"tag": "plain_text", "content": title or "需要确认"},
            "template": "orange",
        },
        "elements": elements,
    }


def proposal_card(
    *,
    proposal_id: str,
    message: str,
    priority: int = 0,
) -> dict[str, Any]:
    level = "高" if priority >= 2 else ("中" if priority == 1 else "低")
    return {
        "config": {"wide_screen_mode": True},
        "header": {
            "title": {"tag": "plain_text", "content": f"主动提案（优先级 {level}）"},
            "template": "blue",
        },
        "elements": [
            {"tag": "div", "text": {"tag": "lark_md", "content": markdown_to_lark_md(message)}},
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


def result_card(*, title: str, body: str, continue_url: str | None = None) -> dict[str, Any]:
    return md_card(title=title, markdown=body, template="green", continue_url=continue_url)


def result_cards(
    *, title: str, body: str, continue_url: str | None = None
) -> list[dict[str, Any]]:
    return md_cards(title=title, markdown=body, template="green", continue_url=continue_url)
