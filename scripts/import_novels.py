#!/usr/bin/env python3
"""批量导入本地小说/剧本到知识库（编码容错 + 持久化全文检索索引）。

用法（在仓库根目录）：
    PYTHONPATH=services/api:services/job-worker uv run --project services/api python scripts/import_novels.py [目录...]

默认导入「晋江顶流32位作家作品合集」与「绿江高收藏必存50本」两个目录。
- 按文件 hash 去重，可重复运行（增量）。
- 解析文件名得到书名/作者；正文用编码探测读取（GBK/GB18030/UTF-16/UTF-8）。
- 直接写库并建立 kb_fts / kb_doc_vector 索引，不经过 Redis 队列（适合一次性灌库）。
"""

from __future__ import annotations

import hashlib
import re
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
API_ROOT = REPO_ROOT / "services" / "api"
JOB_WORKER = REPO_ROOT / "services" / "job-worker"
for p in (API_ROOT, JOB_WORKER, REPO_ROOT):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from sqlmodel import Session, select  # noqa: E402

from app.db import engine, init_db  # noqa: E402
from app.models import KnowledgeDoc, new_id  # noqa: E402
from kb_retrieval import index_document, read_text_robust  # noqa: E402

DEFAULT_DIRS = [
    REPO_ROOT / "晋江顶流32位作家作品合集",
    REPO_ROOT / "绿江高收藏必存50本",
]

_TITLE_RE = re.compile(r"《([^》]+)》")
_AUTHOR_RE = re.compile(r"(?:by\s+|作者\s*[:：]\s*)([^\s【】（）()]+)", re.I)


def parse_filename(name: str) -> tuple[str, str | None, list[str]]:
    """从文件名解析书名/作者，附带频道前缀（如「言情」）。"""
    stem = Path(name).stem
    stem = re.sub(r"^\d+\s*", "", stem)
    extra: list[str] = []
    title = stem
    m = _TITLE_RE.search(stem)
    if m:
        title = m.group(1).strip()
        prefix = stem[: m.start()].strip()
        if prefix:
            extra.append(prefix)
    else:
        # 无书名号：去掉 【】 噪声，取主名
        title = re.sub(r"【.*?】", "", stem).strip()
    author = None
    am = _AUTHOR_RE.search(stem)
    if am:
        author = am.group(1).strip()
    return (title or stem), author, extra


def _doc_exists(session: Session, file_hash: str) -> bool:
    return session.exec(select(KnowledgeDoc).where(KnowledgeDoc.hash == file_hash)).first() is not None


def import_file(session: Session, path: Path, *, source_tag: str, doc_type: str = "novel") -> str | None:
    data = path.read_bytes()
    file_hash = hashlib.sha256(data).hexdigest()
    if _doc_exists(session, file_hash):
        return "skip"
    title, author, extra = parse_filename(path.name)
    text = read_text_robust(path)
    if not text.strip():
        return "empty"
    doc = KnowledgeDoc(
        id=new_id(),
        title=title[:200],
        source=source_tag,
        author=author,
        doc_type=doc_type,
        gender_channel="unknown",
        tags=[t[:20] for t in ([source_tag, *extra] if source_tag else extra)][:12],
        status="ready",
        word_count=len(text),
        storage_uri=str(path),
        hash=file_hash,
        user_id="00000000-0000-4000-8000-000000000001",
    )
    session.add(doc)
    session.commit()
    session.refresh(doc)
    index_document(doc.id, doc.title, text)
    return doc.id


def main() -> None:
    init_db()
    dirs = [Path(a) for a in sys.argv[1:]] or [d for d in DEFAULT_DIRS if d.exists()]
    files: list[Path] = []
    for d in dirs:
        if not d.is_dir():
            print(f"跳过（非目录）：{d}")
            continue
        for ext in ("*.txt", "*.TXT", "*.docx", "*.pdf"):
            files.extend(p for p in d.rglob(ext) if "__MACOSX" not in p.parts)

    # 去重（同一路径只导一次）
    files = sorted(set(files))
    print(f"发现 {len(files)} 个文件，开始导入…")

    stats = {"ok": 0, "skip": 0, "empty": 0, "error": 0}
    t0 = time.time()
    with Session(engine) as session:
        for i, path in enumerate(files, 1):
            source_tag = next((p for p in path.parts if "晋江" in p or "绿江" in p), None) or "本地"
            try:
                r = import_file(session, path, source_tag=source_tag)
                if r == "skip":
                    stats["skip"] += 1
                elif r == "empty":
                    stats["empty"] += 1
                elif r:
                    stats["ok"] += 1
                else:
                    stats["error"] += 1
            except Exception as exc:  # noqa: BLE001
                stats["error"] += 1
                print(f"  [error] {path.name}: {exc}")
            if i % 20 == 0 or i == len(files):
                el = time.time() - t0
                print(f"  {i}/{len(files)}  ok={stats['ok']} skip={stats['skip']} "
                      f"empty={stats['empty']} error={stats['error']}  {el:.1f}s")
    print(f"完成：{stats}")


if __name__ == "__main__":
    main()
