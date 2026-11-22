"""飞书 lark_md 适配与 Supervisor CORE 工具面。"""

from __future__ import annotations

from app.feishu_markdown import (
    build_card_elements,
    looks_like_markdown,
    markdown_to_lark_md,
    md_card,
    md_cards,
    parse_markdown_segments,
    split_md_chunks,
    table_to_bullet_list,
)
from app.routers.personal_agent import (
    CORE_SUPERVISOR_TOOLS,
    SUPERVISOR_TOOLS_ALL,
    _compact_history,
    _TOOL_INDEX,
)


def test_looks_like_markdown():
    assert looks_like_markdown("## 标题\n- a\n- b")
    assert looks_like_markdown("这是 **粗体** 文本")
    assert looks_like_markdown("| a | b |\n| --- | --- |\n| 1 | 2 |")
    assert not looks_like_markdown("短句ok")


def test_markdown_to_lark_md_headings():
    out = markdown_to_lark_md("# 大标题\n\n正文")
    assert "**大标题**" in out
    assert "正文" in out


def test_table_to_bullet_list():
    md = "| 项目 | 类型 | 阶段 |\n| --- | --- | --- |\n| 英雄救美 | 短篇 | 准备中 |\n| 未命名短剧 | 短剧 | 产品阶段 |"
    out = markdown_to_lark_md(md)
    assert "• 英雄救美 · 短篇 · 准备中" in out
    assert "• 未命名短剧 · 短剧 · 产品阶段" in out
    assert "|" not in out


def test_table_cell_escaped_pipe():
    # 单元格内 \| 应保留为 |
    md = "| a | b\\|c |\n| --- | --- |\n| 1 | 2 |"
    segs = parse_markdown_segments(md)
    assert segs[0]["type"] == "table"
    assert segs[0]["rows"][0][1] == "b|c"


def test_table_to_bullet_helper():
    text = table_to_bullet_list([["项目", "阶段"], ["A", "准备中"]])
    assert text == "• A · 准备中"


def test_card_v2_table_element(monkeypatch):
    monkeypatch.setenv("FEISHU_CARD_V2", "true")
    md = "| 项目 | 阶段 |\n| --- | --- |\n| 英雄救美 | 准备中 |"
    els = build_card_elements(md, continue_url="http://127.0.0.1:5173/agent?c=abc")
    assert any(e.get("tag") == "table" for e in els)
    assert any("在网页中继续" in str(e) for e in els)


def test_card_v1_fallback(monkeypatch):
    monkeypatch.setenv("FEISHU_CARD_V2", "false")
    one = md_card(title="短", markdown="**ok**")
    assert one["elements"][0]["text"]["tag"] == "lark_md"
    assert "ok" in one["elements"][0]["text"]["content"]


def test_split_and_md_cards(monkeypatch):
    monkeypatch.setenv("FEISHU_CARD_V2", "false")
    long = "# 报告\n\n" + ("段落内容。" * 800)
    chunks = split_md_chunks(long, size=500)
    assert len(chunks) > 1
    cards = md_cards(title="完成", markdown=long)
    assert len(cards) >= 2
    assert cards[0]["elements"][0]["text"]["tag"] == "lark_md"


def test_core_tools_subset():
    core_names = {(t.get("function") or {}).get("name") for t in CORE_SUPERVISOR_TOOLS}
    assert "tool_search" in core_names
    assert "invoke_tool" not in core_names  # 兼容别名不进 CORE
    assert "run_agent" in core_names
    assert len(CORE_SUPERVISOR_TOOLS) < len(SUPERVISOR_TOOLS_ALL)
    assert "create_fleet" in _TOOL_INDEX
    # Independent same-project teams must be discoverable alongside daemon groups.
    assert "create_fleet" in core_names
    fleet_tool = next(t for t in CORE_SUPERVISOR_TOOLS if t["function"]["name"] == "create_fleet")
    assert fleet_tool["function"]["parameters"]["properties"]["members"]["items"]["type"] == "object"
    assert "search_tools" in _TOOL_INDEX  # 旧名仍可执行


def test_compact_history_truncates_tool():
    history = [
        {"role": "user", "content": "hi"},
        {"role": "tool", "content": "x" * 5000},
        {"role": "assistant", "content": "done"},
    ]
    out = _compact_history(history, trigger_chars=10_000_000)
    tool = next(m for m in out if m["role"] == "tool")
    assert "truncated" in tool["content"]
    assert len(tool["content"]) < 5000
