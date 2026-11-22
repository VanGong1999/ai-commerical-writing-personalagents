"""飞书 Markdown / 表格适配：GFM → 卡片 2.0 元素，或 lark_md 降级。"""

from __future__ import annotations

import os
import re
from typing import Any

# 飞书互动卡片单 div 建议上限
CARD_CHUNK_SIZE = 3500

_MD_HINT = re.compile(
    r"(^|\n)\s{0,3}#{1,6}\s|(\*\*[^*]+\*\*)|(__[^_]+__)|(`[^`]+`)|(^|\n)\s*[-*+]\s|(^|\n)\s*\d+\.\s|\[.+\]\(.+\)|(^|\n)\|",
    re.MULTILINE,
)

_TABLE_SEP = re.compile(r"^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$")


def looks_like_markdown(text: str) -> bool:
    if not text or not str(text).strip():
        return False
    s = str(text)
    if len(s) > 400:
        return True
    return bool(_MD_HINT.search(s))


def use_card_v2() -> bool:
    raw = os.environ.get("FEISHU_CARD_V2", "true").lower()
    return raw in {"1", "true", "yes"}


def _split_table_row(line: str) -> list[str]:
    s = line.strip()
    if s.startswith("|"):
        s = s[1:]
    if s.endswith("|"):
        s = s[:-1]
    cells: list[str] = []
    buf = ""
    escaped = False
    for ch in s:
        if escaped:
            buf += ch
            escaped = False
            continue
        if ch == "\\":
            escaped = True
            continue
        if ch == "|":
            cells.append(buf.strip())
            buf = ""
            continue
        buf += ch
    cells.append(buf.strip())
    return cells


def _is_table_header_block(lines: list[str], i: int) -> bool:
    if i + 1 >= len(lines):
        return False
    header = lines[i]
    sep = lines[i + 1]
    if "|" not in header:
        return False
    return bool(_TABLE_SEP.match(sep))


def table_to_bullet_list(rows: list[list[str]]) -> str:
    """降级：表格 → 「• a · b · c」列表。"""
    if not rows:
        return ""
    header = rows[0]
    body = rows[1:]
    lines: list[str] = []
    for row in body:
        # 对齐列数
        cells = list(row) + [""] * max(0, len(header) - len(row))
        cells = cells[: len(header)] if header else cells
        if header and len(header) >= 2:
            lines.append("• " + " · ".join(c for c in cells if c))
        else:
            lines.append("• " + " · ".join(cells))
    if not lines and header:
        lines.append("• " + " · ".join(header))
    return "\n".join(lines)


def parse_markdown_segments(text: str) -> list[dict[str, Any]]:
    """按 fence / 表格 / 普通文本分段。"""
    if not text:
        return []
    raw_lines = str(text).splitlines()
    segments: list[dict[str, Any]] = []
    i = 0
    buf: list[str] = []
    in_fence = False

    def flush_text() -> None:
        nonlocal buf
        if not buf:
            return
        body = "\n".join(buf).strip("\n")
        if body.strip():
            segments.append({"type": "text", "content": body})
        buf = []

    while i < len(raw_lines):
        line = raw_lines[i]
        stripped = line.strip()
        if stripped.startswith("```"):
            if not in_fence:
                flush_text()
                in_fence = True
                lang = stripped[3:].strip()
                code_lines: list[str] = []
                i += 1
                while i < len(raw_lines) and not raw_lines[i].strip().startswith("```"):
                    code_lines.append(raw_lines[i])
                    i += 1
                segments.append({"type": "code", "lang": lang, "content": "\n".join(code_lines)})
                in_fence = False
                i += 1
                continue
        if not in_fence and _is_table_header_block(raw_lines, i):
            flush_text()
            header = _split_table_row(raw_lines[i])
            i += 2  # skip header + separator
            rows = [header]
            while i < len(raw_lines) and "|" in raw_lines[i] and not raw_lines[i].strip().startswith("```"):
                if not raw_lines[i].strip():
                    break
                if _TABLE_SEP.match(raw_lines[i]):
                    i += 1
                    continue
                rows.append(_split_table_row(raw_lines[i]))
                i += 1
            segments.append({"type": "table", "rows": rows})
            continue
        buf.append(line)
        i += 1
    flush_text()
    return segments


def markdown_to_lark_md(text: str) -> str:
    """轻量适配为飞书 lark_md 子集；表格降级为列表。"""
    if not text:
        return ""
    segments = parse_markdown_segments(text)
    parts: list[str] = []
    for seg in segments:
        if seg["type"] == "table":
            parts.append(table_to_bullet_list(seg["rows"]))
            continue
        if seg["type"] == "code":
            code = seg["content"]
            parts.append("\n".join(f"`{ln}`" if ln else "" for ln in code.splitlines()))
            continue
        # text：标题 → 粗体
        lines: list[str] = []
        for raw in str(seg["content"]).splitlines():
            line = raw.rstrip()
            m = re.match(r"^(#{1,6})\s+(.*)$", line)
            if m:
                level = len(m.group(1))
                title = m.group(2).strip()
                lines.append(f"**{title}**" if level <= 2 else title)
            else:
                lines.append(line)
        parts.append("\n".join(lines))
    out = "\n\n".join(p for p in parts if p is not None)
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out.strip()


def _text_to_lark_md_inline(text: str) -> str:
    lines: list[str] = []
    for raw in str(text).splitlines():
        line = raw.rstrip()
        m = re.match(r"^(#{1,6})\s+(.*)$", line)
        if m:
            level = len(m.group(1))
            title = m.group(2).strip()
            lines.append(f"**{title}**" if level <= 2 else title)
        else:
            lines.append(line)
    return "\n".join(lines).strip()


def build_card_elements(markdown: str, *, continue_url: str | None = None) -> list[dict[str, Any]]:
    """构造卡片 elements：v2 用 table/markdown；否则全走 lark_md。"""
    elements: list[dict[str, Any]] = []
    if use_card_v2():
        for seg in parse_markdown_segments(markdown):
            if seg["type"] == "table":
                rows = seg["rows"]
                if not rows:
                    continue
                header = rows[0]
                body = rows[1:] or []
                columns = [
                    {
                        "name": f"c{i}",
                        "display_name": h or f"列{i+1}",
                        "data_type": "text",
                        "horizontal_align": "left",
                        "width": "auto",
                    }
                    for i, h in enumerate(header)
                ]
                data = []
                for row in body:
                    item: dict[str, str] = {}
                    for i, _h in enumerate(header):
                        item[f"c{i}"] = row[i] if i < len(row) else ""
                    data.append(item)
                elements.append(
                    {
                        "tag": "table",
                        "page_size": 10,
                        "row_height": "low",
                        "header_style": {
                            "text_align": "left",
                            "text_size": "normal",
                            "background_style": "grey",
                            "text_color": "default",
                            "bold": True,
                            "lines": 1,
                        },
                        "columns": columns,
                        "rows": data,
                    }
                )
            elif seg["type"] == "code":
                code = seg["content"] or ""
                # markdown 组件对 fence 更友好；降级也可用 lark_md
                elements.append(
                    {
                        "tag": "markdown",
                        "content": f"```{seg.get('lang') or ''}\n{code}\n```",
                    }
                )
            else:
                content = _text_to_lark_md_inline(seg["content"])
                if content:
                    elements.append({"tag": "markdown", "content": content})
    else:
        body = markdown_to_lark_md(markdown)[:CARD_CHUNK_SIZE]
        elements.append({"tag": "div", "text": {"tag": "lark_md", "content": body or "（空）"}})

    if continue_url:
        elements.append({"tag": "hr"})
        elements.append(
            {
                "tag": "div",
                "text": {
                    "tag": "lark_md",
                    "content": f"[在网页中继续]({continue_url})",
                },
            }
        )
    if not elements:
        elements.append({"tag": "div", "text": {"tag": "lark_md", "content": "（空）"}})
    return elements


def split_md_chunks(text: str, size: int = CARD_CHUNK_SIZE) -> list[str]:
    body = markdown_to_lark_md(text)
    if len(body) <= size:
        return [body] if body else []
    chunks: list[str] = []
    rest = body
    while rest:
        if len(rest) <= size:
            chunks.append(rest)
            break
        cut = rest.rfind("\n", 0, size)
        if cut < size // 3:
            cut = size
        chunks.append(rest[:cut].rstrip())
        rest = rest[cut:].lstrip()
    return [c for c in chunks if c]


def md_card(
    *,
    title: str,
    markdown: str,
    template: str = "green",
    continue_url: str | None = None,
) -> dict[str, Any]:
    """单张 MD 卡片。"""
    elements = build_card_elements(markdown[: CARD_CHUNK_SIZE * 2], continue_url=continue_url)
    return {
        "config": {"wide_screen_mode": True},
        "header": {
            "title": {"tag": "plain_text", "content": (title or "消息")[:50]},
            "template": template,
        },
        "elements": elements,
    }


def md_cards(
    *,
    title: str,
    markdown: str,
    template: str = "green",
    continue_url: str | None = None,
) -> list[dict[str, Any]]:
    if use_card_v2():
        # v2：整卡一次，表格保留结构；过长时按段落粗切
        body = str(markdown or "")
        if len(body) <= CARD_CHUNK_SIZE * 2:
            return [md_card(title=title, markdown=body, template=template, continue_url=continue_url)]
        # 超长：先降级分片（列表形式），末卡带续聊链接
        chunks = split_md_chunks(body)
        cards: list[dict[str, Any]] = []
        for i, chunk in enumerate(chunks, 1):
            url = continue_url if i == len(chunks) else None
            cards.append(
                md_card(
                    title=f"{title} ({i}/{len(chunks)})",
                    markdown=chunk,
                    template=template,
                    continue_url=url,
                )
            )
        return cards or [md_card(title=title, markdown="（空）", template=template)]

    chunks = split_md_chunks(markdown)
    if not chunks:
        return [md_card(title=title, markdown="（空）", template=template, continue_url=continue_url)]
    if len(chunks) == 1:
        return [md_card(title=title, markdown=chunks[0], template=template, continue_url=continue_url)]
    cards = []
    for i, chunk in enumerate(chunks, 1):
        url = continue_url if i == len(chunks) else None
        cards.append(
            md_card(title=f"{title} ({i}/{len(chunks)})", markdown=chunk, template=template, continue_url=url)
        )
    return cards
