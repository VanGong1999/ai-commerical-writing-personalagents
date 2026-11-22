from __future__ import annotations

from app.routers.export import (
    ExportSectionIn,
    _build_docx,
    _build_pdf,
    _build_txt,
    _chunk_text,
    _clean_translation,
    _plain_line,
)


def test_plain_line_strips_markdown():
    assert _plain_line("卖点：**重生**逆袭，*爽*") == "卖点：重生逆袭，爽"
    assert _plain_line("`代码` 和 [链接](https://x)" ) == "代码 和 链接"


def test_build_txt_strips_markdown():
    sections = [
        ExportSectionIn(
            heading="《测试》投稿包",
            body=(
                "# 作品信息\n"
                "- 作品名：测试\n"
                "- 卖点：**反转**很强\n\n"
                "## 正文\n"
                "场1-1：**办公室**【时间：日】\n"
                "1. 第一步\n2. 第二步"
            ),
        )
    ]
    text = _build_txt(sections)
    assert "反转很强" in text
    assert "· 卖点" in text
    assert "#" not in text
    assert "*" not in text


def test_build_docx_and_pdf_render_without_markdown_symbols():
    sections = [
        ExportSectionIn(
            heading="正文",
            body="场1-1：**办公室**【时间：日】\n△主角推门而入\n- 打脸\n- 反转",
        )
    ]
    docx = _build_docx(sections)
    assert docx.startswith(b"PK")
    pdf = _build_pdf(sections)
    assert pdf.startswith(b"%PDF")


def test_chunk_and_clean_translation():
    text = "短句。" * 500
    chunks = _chunk_text(text, limit=400)
    assert len(chunks) >= 2
    assert _clean_translation("```\nHello world\n```") == "Hello world"
    assert _clean_translation("译文：你好") == "你好"
