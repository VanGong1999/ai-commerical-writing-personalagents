from __future__ import annotations

from ..usage_attribution import record_model_usage

import io
import re
from html import escape
from pathlib import Path
from typing import Any, Literal, Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field, StrictInt
from sqlalchemy import update
from sqlmodel import Session

from ..db import get_session
from ..llm_service import chat_completion
from ..models import ActivityLog, Artifact, Project, utcnow
from .projects import _capture_baseline, _snapshot_version, _record_content_edit
from ..schemas import APIModel, ArtifactOut

router = APIRouter(prefix="/projects", tags=["export"])

TRANSLATE_SYSTEM = (
    "You are a professional literary translator working on Chinese web fiction "
    "(short drama scripts and novels). Translate the user's Chinese text into "
    "natural, fluent English suitable for submission. Rules:\n"
    "- Keep the original meaning and emotional tone exactly; do not summarize or skip content.\n"
    "- Keep structural markers (episode/scene headers, character names before dialogue, "
    "OS/VO/voiceover cues) but render them in natural English.\n"
    "- Output plain text only: no Markdown (no #, *, _ or backticks), no code fences, "
    "no quotation marks around the whole result, and no commentary before or after the translation.\n"
    "- Preserve paragraph breaks."
)


class TranslateArtifactIn(APIModel):
    text: Optional[str] = None
    target: Literal["en"] = "en"
    expected_version: Optional[StrictInt] = Field(default=None, ge=1)


def _chunk_text(text: str, limit: int = 3200) -> list[str]:
    """按段落累积切块，超长单行硬切，保证单次 LLM 调用不截断。"""
    lines = text.split("\n")
    chunks: list[str] = []
    buf: list[str] = []
    size = 0
    for line in lines:
        if len(line) > limit:
            if buf:
                chunks.append("\n".join(buf))
                buf, size = [], 0
            for i in range(0, len(line), limit):
                chunks.append(line[i : i + limit])
            continue
        if buf and size + len(line) + 1 > limit:
            chunks.append("\n".join(buf))
            buf, size = [], 0
        buf.append(line)
        size += len(line) + 1
    if buf:
        chunks.append("\n".join(buf))
    return [c for c in chunks if c.strip()]


def _clean_translation(content: str) -> str:
    text = content.strip()
    # 去掉模型偶发的代码围栏
    if text.startswith("```"):
        lines = text.split("\n")
        if lines and lines[0].strip().startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    for prefix in ("Here is the translation:", "译文：", "译文:"):
        if text.startswith(prefix):
            text = text[len(prefix) :].strip()
    return text


@router.post("/{project_id}/artifacts/{artifact_id}/translate", response_model=ArtifactOut)
async def translate_artifact(
    project_id: str,
    artifact_id: str,
    body: TranslateArtifactIn,
    session: Session = Depends(get_session),
) -> Artifact:
    """把产物正文翻译成英文：原文保留在 bodyMarkdown，译文写入 bodyJson.english。"""
    row = session.get(Artifact, artifact_id)
    if not row or row.project_id != project_id:
        raise HTTPException(404, "artifact not found")
    expected = row.version
    if body.expected_version is not None and body.expected_version != expected:
        raise HTTPException(409, detail={"code": "version_conflict", "currentVersion": expected,
                                         "message": "稿件已更新，请重新选择翻译来源"})
    source = (body.text or "").strip() or (row.body_markdown or "").strip()
    if not source:
        raise HTTPException(422, "正文为空，先写正文再翻译")

    chunks = _chunk_text(source)
    parts: list[str] = []
    for index, chunk in enumerate(chunks):
        context = f"（第 {index + 1}/{len(chunks)} 段，整篇较长，请独立译好本段）"
        user = f"{context}\n\n{chunk}" if len(chunks) > 1 else chunk
        try:
            result = await chat_completion(
                [
                    {"role": "system", "content": TRANSLATE_SYSTEM},
                    {"role": "user", "content": user},
                ],
                temperature=0.2,
                max_tokens=6000,
            )
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(502, f"翻译失败：{exc}") from exc
        record_model_usage(result, agent_id="system.translation", session=session, project_id=project_id)
        from ..personal_agent_output import validate_agent_output, IncompleteAgentOutput
        try:
            validate_agent_output(result)
            part = _clean_translation(result.content)
            if not part or getattr(result, "tool_calls", None):
                raise IncompleteAgentOutput("翻译段落没有返回正文")
        except IncompleteAgentOutput as exc:
            raise HTTPException(502, str(exc)) from exc
        parts.append(part)

    translated = "\n\n".join(p for p in parts if p.strip())
    if not translated.strip():
        raise HTTPException(502, "翻译返回为空，请重试")

    body_json = dict(row.body_json or {})
    body_json["english"] = translated
    body_json["englishAt"] = utcnow().isoformat()
    _capture_baseline(session, row, "before translation")
    result = session.execute(
        update(Artifact).where(Artifact.id == artifact_id, Artifact.project_id == project_id,
                               Artifact.version == expected)
        .values(body_json=body_json, version=expected + 1, updated_at=utcnow())
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        session.rollback()
        raise HTTPException(409, detail={"code": "version_conflict", "translatedText": translated,
                                         "message": "翻译期间稿件已更新，译文未写入；请复制候选后比较"})
    session.expire(row)
    session.refresh(row)
    # Translation adds metadata; keep source approval bound to the new version.
    _record_content_edit(session, row, expected, False)
    _snapshot_version(session, row)
    session.add(
        ActivityLog(
            actor="user",
            action="artifact_edit",
            summary=f"翻译 {row.title} 为英文",
            project_id=project_id,
            detail={"artifact_id": row.id, "kind": "translate_en"},
        )
    )
    session.commit()
    session.refresh(row)
    return row


class ExportSectionIn(APIModel):
    heading: str
    body: str


class ExportIn(APIModel):
    title: str = "未命名"
    format: Literal["txt", "md", "docx", "pdf"] = "docx"
    sections: list[ExportSectionIn] = []
    filename: Optional[str] = None


_INLINE_MD = re.compile(
    r"(\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`|!\[[^\]]*\]\([^)]*\)|\[[^\]]*\]\([^)]*\))"
)
_HEADING_MD = re.compile(r"^(#{1,6})\s+(.*)$")
_BULLET_MD = re.compile(r"^\s*[-*+]\s+(.*)$")
_NUMBER_MD = re.compile(r"^\s*(\d+)[.)]\s+(.*)$")


def _inline_pieces(text: str) -> list[tuple[str, str]]:
    """把一行拆成 (kind, content) 片段：kind ∈ {text, bold, italic, code, link}。"""
    pieces: list[tuple[str, str]] = []
    pos = 0
    for match in _INLINE_MD.finditer(text):
        if match.start() > pos:
            pieces.append(("text", text[pos : match.start()]))
        token = match.group(0)
        if token.startswith("**") or token.startswith("__"):
            pieces.append(("bold", token[2:-2]))
        elif token.startswith("*") or token.startswith("_"):
            pieces.append(("italic", token[1:-1]))
        elif token.startswith("`"):
            pieces.append(("code", token[1:-1]))
        elif token.startswith("!["):
            alt = token[2 : token.index("]")]
            pieces.append(("text", alt or "[图片]"))
        else:
            label = token[1 : token.index("]")]
            pieces.append(("link", label))
        pos = match.end()
    if pos < len(text):
        pieces.append(("text", text[pos:]))
    return pieces


def _plain_line(text: str) -> str:
    """去掉一行里残留的 Markdown 符号，得到纯文本。"""
    out = "".join(content for _, content in _inline_pieces(text))
    return out.replace("#", "").replace("*", "").replace("`", "")


def _plain_text(body: str) -> str:
    lines: list[str] = []
    for raw in body.split("\n"):
        line = raw.rstrip()
        heading = _HEADING_MD.match(line)
        if heading:
            lines.append(_plain_line(heading.group(2)))
            continue
        if line.strip() in {"---", "***", "___"}:
            continue
        bullet = _BULLET_MD.match(line)
        if bullet:
            lines.append(f"· {_plain_line(bullet.group(1))}")
            continue
        numbered = _NUMBER_MD.match(line)
        if numbered:
            lines.append(f"{numbered.group(1)}. {_plain_line(numbered.group(2))}")
            continue
        lines.append(_plain_line(line))
    while lines and not lines[-1].strip():
        lines.pop()
    return "\n".join(lines)


def _safe_filename(name: str, ext: str) -> str:
    cleaned = re.sub(r'[\\/:*?"<>|\r\n]+', "", name).strip() or "export"
    return f"{cleaned[:60]}.{ext}"


def _build_txt(sections: list[ExportSectionIn]) -> str:
    parts: list[str] = []
    for section in sections:
        if section.heading.strip():
            parts.append(section.heading.strip())
        body = _plain_text(section.body)
        if body.strip():
            parts.append(body.strip())
        parts.append("")
    return "\n".join(parts).strip() + "\n"


def _build_md(sections: list[ExportSectionIn]) -> str:
    parts: list[str] = []
    for section in sections:
        if section.heading.strip():
            parts.append(f"# {section.heading.strip()}")
        if section.body.strip():
            parts.append(section.body.strip())
        parts.append("")
    return "\n".join(parts).strip() + "\n"


def _add_docx_line(document: Any, line: str) -> None:
    heading = _HEADING_MD.match(line)
    if heading:
        level = min(len(heading.group(1)), 6)
        text = "".join(content for _, content in _inline_pieces(heading.group(2)))
        document.add_heading(text, level=level)
        return
    if line.strip() in {"---", "***", "___"}:
        return
    bullet = _BULLET_MD.match(line)
    if bullet:
        paragraph = document.add_paragraph(style="List Bullet")
        _fill_docx_runs(paragraph, bullet.group(1))
        return
    numbered = _NUMBER_MD.match(line)
    if numbered:
        paragraph = document.add_paragraph(style="List Number")
        _fill_docx_runs(paragraph, numbered.group(2))
        return
    paragraph = document.add_paragraph()
    _fill_docx_runs(paragraph, line)


def _fill_docx_runs(paragraph: Any, text: str) -> None:
    for kind, content in _inline_pieces(text):
        if kind == "code":
            paragraph.add_run(content).italic = True
        elif kind == "link":
            run = paragraph.add_run(content)
            run.underline = True
        else:
            run = paragraph.add_run(content)
            run.bold = kind == "bold"
            run.italic = kind == "italic"


def _build_docx(sections: list[ExportSectionIn]) -> bytes:
    from docx import Document
    from docx.oxml.ns import qn
    from docx.shared import Pt

    document = Document()
    style = document.styles["Normal"]
    style.font.name = "Calibri"
    style.font.size = Pt(11)
    rpr = style.element.get_or_add_rPr()
    rfonts = rpr.get_or_add_rFonts()
    rfonts.set(qn("w:eastAsia"), "宋体")
    for section in sections:
        if section.heading.strip():
            document.add_heading(section.heading.strip(), level=1)
        for line in section.body.split("\n"):
            _add_docx_line(document, line.rstrip())
        document.add_paragraph()
    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


_CN_FONT_NAME: str | None = None


def _cn_font_name() -> str:
    """注册可嵌入的中文字体：优先本机 TrueType，找不到再退回 CID 字体。"""
    global _CN_FONT_NAME
    if _CN_FONT_NAME:
        return _CN_FONT_NAME
    from reportlab.pdfbase import pdfmetrics

    candidates = [
        ("/System/Library/Fonts/STHeiti Light.ttc", 0),
        ("/System/Library/Fonts/STHeiti Medium.ttc", 0),
        ("/System/Library/Fonts/PingFang.ttc", 0),
        ("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", 2),
        ("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", 0),
        ("/usr/share/fonts/truetype/wqy/wqy-microhei.ttc", 0),
        ("/usr/share/fonts/truetype/arphic/uming.ttc", 0),
    ]
    for path, subfont in candidates:
        if not Path(path).exists():
            continue
        try:
            from reportlab.pdfbase.ttfonts import TTFont

            pdfmetrics.registerFont(TTFont("CNEmbed", path, subfontIndex=subfont))
            _CN_FONT_NAME = "CNEmbed"
            return _CN_FONT_NAME
        except Exception:  # noqa: BLE001
            continue
    from reportlab.pdfbase.cidfonts import UnicodeCIDFont

    pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
    _CN_FONT_NAME = "STSong-Light"
    return _CN_FONT_NAME


def _build_pdf(sections: list[ExportSectionIn]) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

    font_name = _cn_font_name()
    heading_style = ParagraphStyle(
        "HeadingCN",
        fontName=font_name,
        fontSize=16,
        leading=22,
        spaceBefore=14,
        spaceAfter=8,
        textColor=colors.HexColor("#1f2937"),
    )
    body_style = ParagraphStyle(
        "BodyCN",
        fontName=font_name,
        fontSize=11,
        leading=18,
        spaceAfter=4,
    )
    bullet_style = ParagraphStyle(
        "BulletCN",
        parent=body_style,
        leftIndent=18,
        bulletIndent=6,
    )

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=56,
        rightMargin=56,
        topMargin=52,
        bottomMargin=52,
        title=sections[0].heading if sections else "",
    )
    story: list[Any] = []
    for section in sections:
        if section.heading.strip():
            story.append(Paragraph(escape(section.heading.strip()), heading_style))
        for raw in section.body.split("\n"):
            line = raw.rstrip()
            if not line.strip():
                story.append(Spacer(1, 6))
                continue
            heading = _HEADING_MD.match(line)
            if heading:
                story.append(Paragraph(escape(_plain_line(heading.group(2))), heading_style))
                continue
            if line.strip() in {"---", "***", "___"}:
                continue
            bullet = _BULLET_MD.match(line)
            if bullet:
                story.append(
                    Paragraph(f"• {escape(_plain_line(bullet.group(1)))}", bullet_style)
                )
                continue
            numbered = _NUMBER_MD.match(line)
            if numbered:
                story.append(
                    Paragraph(
                        f"{numbered.group(1)}. {escape(_plain_line(numbered.group(2)))}",
                        bullet_style,
                    )
                )
                continue
            story.append(Paragraph(escape(_plain_line(line)), body_style))
    doc.build(story)
    return buffer.getvalue()


@router.post("/{project_id}/export")
def export_project(
    project_id: str,
    body: ExportIn,
    session: Session = Depends(get_session),
) -> Response:
    """把投稿内容导出为 txt / md / docx / pdf；正文剥离 Markdown 语法。"""
    if session.get(Project, project_id) is None:
        raise HTTPException(404, "project not found")
    if not body.sections:
        raise HTTPException(422, "没有可导出的内容")

    ext = body.format
    media_types = {
        "txt": "text/plain; charset=utf-8",
        "md": "text/markdown; charset=utf-8",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "pdf": "application/pdf",
    }
    if ext == "txt":
        content = _build_txt(body.sections).encode("utf-8")
    elif ext == "md":
        content = _build_md(body.sections).encode("utf-8")
    elif ext == "docx":
        content = _build_docx(body.sections)
    else:
        content = _build_pdf(body.sections)

    filename = _safe_filename(body.filename or body.title, ext)
    ascii_fallback = re.sub(r"[^\x20-\x7e]+", "_", filename) or f"export.{ext}"
    disposition = f"attachment; filename=\"{ascii_fallback}\"; filename*=UTF-8''{quote(filename)}"
    return Response(
        content=content,
        media_type=media_types[ext],
        headers={"Content-Disposition": disposition},
    )
