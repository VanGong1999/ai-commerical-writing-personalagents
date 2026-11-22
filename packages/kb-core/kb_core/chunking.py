from __future__ import annotations

import re
from pathlib import Path


def extract_docx_text(path: str | Path) -> str:
    from docx import Document

    document = Document(str(path))
    return "\n".join(p.text for p in document.paragraphs if p.text.strip())


def extract_text(path: str | Path) -> str:
    p = Path(path)
    if p.suffix.lower() == ".docx":
        return extract_docx_text(p)
    return p.read_text(encoding="utf-8", errors="ignore")


def chunk_text(text: str, size: int = 800, overlap: int = 120) -> list[str]:
    text = re.sub(r"\r\n?", "\n", text).strip()
    if not text:
        return []
    chunks: list[str] = []
    i = 0
    while i < len(text):
        chunks.append(text[i : i + size])
        i += max(1, size - overlap)
    return chunks
