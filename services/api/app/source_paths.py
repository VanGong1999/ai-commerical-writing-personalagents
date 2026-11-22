"""Read known local KB sources, including the exact legacy move into others/."""
from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]


def resolve_source_path(path: str | Path) -> Path:
    """Prefer the original file; relocate only its exact repo-relative suffix.

    No filename search, external directory scan, or storage mutation occurs.
    Inferred relocation rejects symlinks escaping the known others directory;
    already-existing trusted imports retain their original location semantics.
    """
    root = REPO_ROOT.resolve()
    original = Path(path)
    if not original.is_absolute():
        original = root / original
    original = original.resolve()
    # Persisted source paths were accepted by the original import workflow.
    # Preserve those existing files; confinement applies to inferred relocation.
    if original.is_file():
        return original
    try:
        suffix = original.relative_to(root)
    except ValueError as exc:
        raise ValueError("原文路径不在已知本地资料目录内，请重新上传源文件") from exc
    candidates: set[Path] = set()
    if suffix.parts and suffix.parts[0] != "others":
        relocated = (root / "others" / suffix).resolve()
        if not relocated.is_relative_to(root / "others"):
            raise ValueError("原文迁移路径越出已知资料目录")
        if relocated.is_file():
            candidates.add(relocated)
    if len(candidates) > 1:
        raise ValueError("原文迁移地址不唯一，请重新上传源文件")
    if candidates:
        return candidates.pop()
    raise FileNotFoundError("原文文件不存在，请重新上传源文件")


def read_source_text(path: str | Path) -> str:
    path = resolve_source_path(path)
    try:
        if path.suffix.lower() == ".docx":
            from docx import Document
            text = "\n".join(p.text for p in Document(str(path)).paragraphs if p.text.strip())
        elif path.suffix.lower() == ".pdf":
            from pypdf import PdfReader
            text = "\n".join(p.extract_text() or "" for p in PdfReader(str(path)).pages)
        else:
            if path.suffix.lower() not in {"", ".txt", ".md", ".text", ".csv", ".log"}:
                raise ValueError("不支持的原文格式，请转换为 TXT、DOCX 或可提取文字的 PDF")
            data = path.read_bytes()
            if data.startswith((b"\xff\xfe", b"\xfe\xff")):
                text = data.decode("utf-16")
            else:
                for encoding in ("utf-8-sig", "gb18030", "gbk", "big5"):
                    try:
                        text = data.decode(encoding)
                        break
                    except UnicodeDecodeError:
                        continue
                else:
                    raise ValueError("无法无损解码原文，请转换为 UTF-8 后重新上传")
        if not text.strip() or any(ord(ch) < 32 and ch not in "\n\r\t" for ch in text):
            raise ValueError("未提取到有效原文正文，请检查文件或先完成 OCR")
        return text
    except (OSError, ValueError):
        raise
    except Exception as exc:
        raise ValueError("原文解析失败，请检查源文件是否损坏") from exc
