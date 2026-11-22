"""持久化知识库检索层：中文 bigram 全文检索 + 文档级特征向量 + RRF 混合重排。

设计要点（对齐 docs/prd/02-knowledge-base-prd.md 第 7 节「检索栈」）：
- 关键词：SQLite FTS5（`unicode61`）+ 自写 CJK bigram 分词，写入侧与查询侧共用同一套
  分词器，避免词表漂移；ASCII/Latin 单词整体保留（不做 bigram）。
- 语义：文档级 256 维 feature-hash 向量（bigram + 单字 bag），无需外部 embedding 即可
  做词汇重叠召回；embedding API 可用时由上层决定是否覆盖（此处不依赖）。
- 融合：Reciprocal Rank Fusion（RRF，k=60），关键词通道权重高于向量通道（精确优先）。
- 单字查询 / 零命中兜底：对 `raw` 列做 LIKE 精确子串回退（等价 grep 语义）。

本模块只依赖 `app.db.engine`（与 api / job-worker 共享同一 SQLite），不依赖任何
外部服务，故在无 Redis / MinIO / Milvus 时也可独立工作。
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import re
from pathlib import Path
from typing import Any, Iterable

logger = logging.getLogger("kb_retrieval")

# ---------------------------------------------------------------------------
# 常量与正则
# ---------------------------------------------------------------------------

_CJK = re.compile(r"[\u4e00-\u9fff]+")
_WORD = re.compile(r"[A-Za-z0-9]+")
_RUN = re.compile(r"[\u4e00-\u9fff]+|[A-Za-z0-9]+")
_QUERY_SEP = re.compile(r"[\s,，、;；+]+")

FTS_TABLE = "kb_fts"
DOC_VECTOR_TABLE = "kb_doc_vector"
VECTOR_DIM = 256
RRF_K = 60.0
# 精确关键词通道权重大于语义向量通道（避免噪声向量稀释精确命中）
KEYWORD_WEIGHT = 2.0
VECTOR_WEIGHT = 1.0

# 章节 / 分集 / 卷首等结构边界（用于按结构切片，产出 locator）
_CHAPTER_HEAD = re.compile(
    r"^\s*(?:"
    r"第\s*[0-9一二三四五六七八九十百千万零〇两]+\s*[章回节集卷话部篇]"
    r"|Chapter\s+\d+"
    r"|楔子|序[章言]|番外(?:篇)?|尾声|终章|后记"
    r")[^\n]{0,60}$",
    re.MULTILINE,
)

_ENCODINGS = ("utf-8-sig", "utf-8", "gb18030", "gbk", "utf-16", "big5")


# ---------------------------------------------------------------------------
# 文本读取（编码容错）
# ---------------------------------------------------------------------------


def read_text_robust(path: str | Path) -> str:
    """按编码探测读取 txt（兼容 GBK/GB18030/UTF-16），docx 走 python-docx。

    晋江 / 绿江导出 txt 多为 GBK 编码，历史代码用 utf-8 直读会乱码或抛错，此处统一兜底。
    """
    p = Path(path)
    if p.suffix.lower() == ".docx":
        from docx import Document

        return "\n".join(x.text for x in Document(str(p)).paragraphs if x.text.strip())
    if p.suffix.lower() == ".pdf":
        from pypdf import PdfReader

        return "\n".join((page.extract_text() or "") for page in PdfReader(str(p)).pages).strip()
    data = p.read_bytes()
    # BOM 处理
    if data[:3] == b"\xef\xbb\xbf":
        data = data[3:]
    elif data[:2] == b"\xff\xfe":
        return data.decode("utf-16")
    elif data[:2] == b"\xfe\xff":
        return data.decode("utf-16-be", errors="ignore")
    for enc in _ENCODINGS:
        try:
            return data.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
    return data.decode("utf-8", errors="ignore")


# ---------------------------------------------------------------------------
# CJK bigram 分词（写入 / 查询共用）
# ---------------------------------------------------------------------------


def _runs(text: str) -> Iterable[str]:
    return (m.group(0) for m in _RUN.finditer((text or "").lower()))


def index_tokens(text: str) -> str:
    """写入侧：中文切成 bigram，ASCII/Latin 单词整体保留，空格连接供 FTS5 分词。"""
    toks: list[str] = []
    for seg in _runs(text):
        if _CJK.fullmatch(seg):
            toks.extend(seg[i : i + 2] for i in range(len(seg) - 1))
        else:
            toks.append(seg)
    return " ".join(toks)


def query_tokens(term: str) -> list[str]:
    """查询侧：中文长度≥2 切成 bigram，单字保留；ASCII 单词整体保留。"""
    toks: list[str] = []
    for seg in _runs(term):
        if _CJK.fullmatch(seg):
            if len(seg) == 1:
                toks.append(seg)
            else:
                toks.extend(seg[i : i + 2] for i in range(len(seg) - 1))
        else:
            toks.append(seg)
    return toks


def split_query_terms(query: str) -> list[str]:
    return [t for t in _QUERY_SEP.split(query or "") if t.strip()]


# ---------------------------------------------------------------------------
# 结构切片（章节 / 分集 / 固定窗口）
# ---------------------------------------------------------------------------


def segment_text(text: str, *, min_chapters: int = 3, chunk_size: int = 1500, overlap: int = 120) -> list[tuple[str, str]]:
    """按章节/分集头切分，返回 (locator, body)。结构过少时退化为固定窗口。"""
    text = re.sub(r"\r\n?", "\n", text or "").strip()
    if not text:
        return [("", "")]
    heads = list(_CHAPTER_HEAD.finditer(text))
    if len(heads) >= min_chapters:
        segs: list[tuple[str, str]] = []
        if heads[0].start() > 0:
            lead = text[: heads[0].start()].strip()
            if lead:
                segs.append(("卷首/简介", lead))
        for i, h in enumerate(heads):
            start = h.start()
            end = heads[i + 1].start() if i + 1 < len(heads) else len(text)
            body = text[start:end].strip()
            if body:
                segs.append((h.group(0).strip()[:60], body))
        return segs
    step = max(1, chunk_size - overlap)
    return [("", text[i : i + chunk_size]) for i in range(0, len(text), step)]


# ---------------------------------------------------------------------------
# 文档级特征向量（feature hash）
# ---------------------------------------------------------------------------


def feature_vector(text: str, dim: int = VECTOR_DIM) -> list[float]:
    """bag-of-bigram/word 特征哈希向量（带符号），L2 归一化。"""
    vec = [0.0] * dim
    for seg in _runs(text):
        if _CJK.fullmatch(seg):
            toks: Iterable[str] = (seg[i : i + 2] for i in range(len(seg) - 1))
            # 单字也计入，增强短文本 / 题材词汇信号
            toks = list(toks) + list(seg)
        else:
            toks = [seg]
        for tok in toks:
            h = int(hashlib.md5(tok.encode("utf-8")).hexdigest()[:16], 16)
            bucket = h % dim
            sign = 1.0 if (h >> 8) & 1 else -1.0
            vec[bucket] += sign
    norm = math.sqrt(sum(x * x for x in vec)) or 1.0
    return [x / norm for x in vec]


def _sample_text(text: str, max_chars: int = 120_000) -> str:
    text = text or ""
    if len(text) <= max_chars:
        return text
    third = max_chars // 3
    mid = len(text) // 2
    return text[:third] + text[mid - third // 2 : mid + third // 2] + text[-third:]


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b:
        return 0.0
    n = min(len(a), len(b))
    dot = sum(a[i] * b[i] for i in range(n))
    na = math.sqrt(sum(x * x for x in a)) or 1.0
    nb = math.sqrt(sum(x * x for x in b)) or 1.0
    return dot / (na * nb)


# ---------------------------------------------------------------------------
# 持久化索引（FTS5 + 文档向量表）
# ---------------------------------------------------------------------------

_FTS_DDL = (
    f"CREATE VIRTUAL TABLE IF NOT EXISTS {FTS_TABLE} USING fts5("
    "title, body, doc_id UNINDEXED, locator UNINDEXED, raw UNINDEXED, "
    "tokenize='unicode61 remove_diacritics 2')"
)
_VEC_DDL = (
    f"CREATE TABLE IF NOT EXISTS {DOC_VECTOR_TABLE} ("
    "doc_id TEXT PRIMARY KEY, vector TEXT NOT NULL)"
)


def ensure_index() -> None:
    from app.db import engine

    with engine.begin() as conn:
        conn.exec_driver_sql(_FTS_DDL)
        conn.exec_driver_sql(_VEC_DDL)


def index_document(doc_id: str, title: str, text: str) -> dict[str, Any]:
    """索引一篇文档：删除旧索引 → 写入 FTS 切片 → 写入文档向量。幂等。"""
    from app.db import engine

    segs = segment_text(text)
    idx_title = index_tokens(title)
    with engine.begin() as conn:
        conn.exec_driver_sql(_FTS_DDL)
        conn.exec_driver_sql(_VEC_DDL)
        conn.exec_driver_sql(f"DELETE FROM {FTS_TABLE} WHERE doc_id = ?", (doc_id,))
        for locator, body in segs:
            conn.exec_driver_sql(
                f"INSERT INTO {FTS_TABLE} (title, body, doc_id, locator, raw) VALUES (?,?,?,?,?)",
                (idx_title, index_tokens(body), doc_id, locator, body),
            )
        vec = feature_vector(_sample_text(text))
        conn.exec_driver_sql(
            f"INSERT OR REPLACE INTO {DOC_VECTOR_TABLE} (doc_id, vector) VALUES (?,?)",
            (doc_id, json.dumps(vec)),
        )
    return {"docId": doc_id, "segments": len(segs), "backend": "sqlite-fts5"}


def delete_document_index(doc_id: str) -> None:
    from app.db import engine

    ensure_index()
    with engine.begin() as conn:
        conn.exec_driver_sql(f"DELETE FROM {FTS_TABLE} WHERE doc_id = ?", (doc_id,))
        conn.exec_driver_sql(f"DELETE FROM {DOC_VECTOR_TABLE} WHERE doc_id = ?", (doc_id,))


# ---------------------------------------------------------------------------
# 检索
# ---------------------------------------------------------------------------


def _escape_like(s: str) -> str:
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _build_match(terms: list[str]) -> str | None:
    """构建 FTS5 MATCH 表达式：词内 bigram OR，词间 AND；单字词跳过（走 LIKE 兜底）。"""
    clauses: list[str] = []
    for t in terms:
        multi = [tok for tok in query_tokens(t) if len(tok) > 1 and '"' not in tok]
        if not multi:
            continue
        clauses.append("(" + " OR ".join(f'"{tok}"' for tok in multi) + ")")
    return " AND ".join(clauses) if clauses else None


def _fts_search(query: str, limit: int) -> tuple[list[str], dict[str, list[dict[str, Any]]]]:
    """关键词检索：FTS5 bigram；无结果或纯单字时回退 raw LIKE（grep 语义）。

    返回 (按相关度排序的 doc_id 列表, doc_id -> 切片详情)。
    """
    from app.db import engine

    terms = split_query_terms(query)
    if not terms:
        return [], {}
    rows: list[tuple[str, str, str, float | None]] = []
    match = _build_match(terms)
    if match:
        try:
            with engine.connect() as conn:
                rows = [
                    (r[0], r[1], r[2], float(r[3]) if r[3] is not None else None)
                    for r in conn.exec_driver_sql(
                        f"SELECT doc_id, locator, raw, bm25({FTS_TABLE}) AS r "
                        f"FROM {FTS_TABLE} WHERE {FTS_TABLE} MATCH ? ORDER BY r LIMIT ?",
                        (match, limit * 8),
                    ).fetchall()
                ]
        except Exception as exc:  # noqa: BLE001
            logger.warning("fts search failed, fallback to LIKE: %s", exc)
            rows = []

    if not rows:
        with engine.connect() as conn:
            like_clauses = " AND ".join([f"raw LIKE ? ESCAPE '\\'"] * len(terms))
            params = tuple(f"%{_escape_like(t)}%" for t in terms)
            rows = [
                (r[0], r[1], r[2], None)
                for r in conn.exec_driver_sql(
                    f"SELECT doc_id, locator, raw FROM {FTS_TABLE} WHERE {like_clauses} LIMIT ?",
                    (*params, limit * 8),
                ).fetchall()
            ]

    # 聚合到文档：每文档保留 bm25 最优的若干切片
    by_doc: dict[str, list[dict[str, Any]]] = {}
    for doc_id, locator, raw, rank in rows:
        by_doc.setdefault(doc_id, []).append(
            {"docId": doc_id, "locator": locator, "raw": raw or "", "rank": rank}
        )
    for doc_id in by_doc:
        by_doc[doc_id].sort(key=lambda h: (h["rank"] if h["rank"] is not None else 0.0))
    return list(by_doc.keys()), by_doc


def _vector_search(query: str, limit: int) -> list[str]:
    from app.db import engine

    qvec = feature_vector(query)
    scored: list[tuple[str, float]] = []
    try:
        with engine.connect() as conn:
            rows = conn.exec_driver_sql(
                f"SELECT doc_id, vector FROM {DOC_VECTOR_TABLE}"
            ).fetchall()
    except Exception as exc:  # noqa: BLE001
        logger.warning("vector search skipped: %s", exc)
        return []
    for doc_id, vec_json in rows:
        try:
            vec = json.loads(vec_json)
        except (TypeError, ValueError):
            continue
        scored.append((doc_id, _cosine(qvec, vec)))
    scored.sort(key=lambda x: -x[1])
    return [doc_id for doc_id, _ in scored[:limit]]


def _rrf(keyword_ranked: list[str], vector_ranked: list[str], k: float = RRF_K) -> list[tuple[str, float]]:
    scores: dict[str, float] = {}
    for rank, doc_id in enumerate(keyword_ranked):
        scores[doc_id] = scores.get(doc_id, 0.0) + KEYWORD_WEIGHT / (k + rank)
    for rank, doc_id in enumerate(vector_ranked):
        scores[doc_id] = scores.get(doc_id, 0.0) + VECTOR_WEIGHT / (k + rank)
    return sorted(scores.items(), key=lambda x: -x[1])


def _make_snippet(raw: str, query: str, radius: int = 80) -> str:
    raw = (raw or "").strip()
    if not raw:
        return ""
    needles: set[str] = set()
    for term in split_query_terms(query):
        needles.add(term)
        if len(term) >= 2:
            needles.update(term[i : i + 2] for i in range(len(term) - 1))
        for ch in term:
            if _CJK.fullmatch(ch):
                needles.add(ch)
    best = -1
    for n in needles:
        if not n:
            continue
        idx = raw.find(n)
        if idx != -1 and (best == -1 or idx < best):
            best = idx
    if best == -1:
        return raw[: radius * 2]
    start = max(0, best - radius)
    end = min(len(raw), best + radius + 2)
    prefix = "…" if start > 0 else ""
    suffix = "…" if end < len(raw) else ""
    return prefix + raw[start:end].replace("\n", " ").strip() + suffix


def _snippets_for_doc(doc_id: str, query: str, fts_by_doc: dict[str, list[dict[str, Any]]], max_snippets: int = 3) -> list[dict[str, str]]:
    hits = fts_by_doc.get(doc_id) or []
    out: list[dict[str, str]] = []
    for h in hits[:max_snippets]:
        out.append({"locator": h.get("locator") or "", "text": _make_snippet(h.get("raw") or "", query)})
    return out


def search_documents(
    session: Any,
    query: str,
    *,
    limit: int = 8,
    mode: str = "hybrid",
    max_snippets: int = 3,
) -> list[dict[str, Any]]:
    """混合检索入口：返回按 RRF 得分排序的文档命中，含片段与 locator。

    mode: keyword | vector | hybrid
    """
    from sqlmodel import select

    from app.models import KnowledgeDoc

    query = (query or "").strip()
    if not query:
        return []

    ensure_index()
    mode_l = (mode or "hybrid").lower()
    kw_ranked, fts_by_doc = (
        _fts_search(query, limit) if mode_l in {"keyword", "hybrid"} else ([], {})
    )
    vec_ranked = _vector_search(query, limit) if mode_l in {"vector", "hybrid"} else []

    if mode_l == "keyword":
        fused = [(doc_id, 0.0) for doc_id in kw_ranked]
    elif mode_l == "vector":
        fused = [(doc_id, 0.0) for doc_id in vec_ranked]
    else:
        # 混合模式：关键词通道无命中时不再单独采纳 feature-hash 向量
        # （无真实 embedding 时向量即 bigram 哈希，关键词已覆盖其信号，避免碰撞噪声）。
        if not kw_ranked:
            fused = []
        else:
            fused = _rrf(kw_ranked, vec_ranked)

    top = fused[:limit]
    if not top:
        return []

    ids = [doc_id for doc_id, _ in top]
    docs = {d.id: d for d in session.exec(select(KnowledgeDoc).where(KnowledgeDoc.id.in_(ids))).all()}

    out: list[dict[str, Any]] = []
    for doc_id, score in top:
        d = docs.get(doc_id)
        sources: list[str] = []
        if doc_id in kw_ranked:
            sources.append("fts")
        if doc_id in vec_ranked:
            sources.append("vector")
        out.append(
            {
                "docId": doc_id,
                "title": d.title if d else doc_id,
                "author": (d.author or "") if d else "",
                "docType": (d.doc_type or "") if d else "",
                "tags": list(d.tags or []) if d else [],
                "score": round(score, 5),
                "snippets": _snippets_for_doc(doc_id, query, fts_by_doc, max_snippets),
                "matchedTerms": split_query_terms(query),
                "sources": sources,
            }
        )
    return out
