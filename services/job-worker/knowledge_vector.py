"""蒸馏 knowledge/ 灌入向量库（Milvus 或进程内回退）。

固定本地 hash 嵌入维度，避免 API embed 失败时退化成 dim=1。
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import re
from pathlib import Path
from typing import Any

logger = logging.getLogger("knowledge_vector")

REPO_ROOT = Path(__file__).resolve().parents[2]
INDEX_PATH = REPO_ROOT / "knowledge" / "00-meta" / "search-index.json"
KNOWLEDGE_ROOT = REPO_ROOT / "knowledge"
LOCAL_DIM = 64
COLLECTION_NAME = "kb_knowledge"

_TOKEN_RE = re.compile(r"[\w\u4e00-\u9fff]+", re.UNICODE)
_MEMORY: list[dict[str, Any]] = []


def local_embed(texts: list[str], dim: int = LOCAL_DIM) -> list[list[float]]:
    out: list[list[float]] = []
    for text in texts:
        vec = [0.0] * dim
        for tok in _TOKEN_RE.findall((text or "").lower()):
            h = int(hashlib.md5(tok.encode("utf-8")).hexdigest(), 16)
            vec[h % dim] += 1.0 + (h % 7) * 0.01
        norm = math.sqrt(sum(x * x for x in vec)) or 1.0
        out.append([x / norm for x in vec])
    return out


def _use_milvus() -> bool:
    try:
        from pymilvus import connections
        from app.settings import get_settings

        s = get_settings()
        connections.connect(alias="default", uri=s.milvus_uri)
        return True
    except Exception as exc:  # noqa: BLE001
        logger.info("Milvus unavailable for knowledge vectors: %s", exc)
        return False


def _load_articles() -> list[dict[str, Any]]:
    if not INDEX_PATH.exists():
        return []
    raw = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    if isinstance(raw, dict) and "articles" in raw:
        return list(raw["articles"])
    if isinstance(raw, list):
        return raw
    return []


def _article_text(article: dict[str, Any]) -> str:
    path = str(article.get("path") or "")
    body = ""
    if path:
        fp = KNOWLEDGE_ROOT / path
        if fp.exists():
            body = fp.read_text(encoding="utf-8")[:1800]
    parts = [
        str(article.get("title") or ""),
        str(article.get("summary") or ""),
        " ".join(str(t) for t in (article.get("tags") or [])),
        body,
    ]
    return "\n".join(p for p in parts if p).strip()


def _ensure_collection(dim: int):
    from pymilvus import Collection, CollectionSchema, DataType, FieldSchema, utility

    name = COLLECTION_NAME
    if utility.has_collection(name):
        return Collection(name)
    fields = [
        FieldSchema(name="id", dtype=DataType.VARCHAR, is_primary=True, max_length=96),
        FieldSchema(name="path", dtype=DataType.VARCHAR, max_length=256),
        FieldSchema(name="title", dtype=DataType.VARCHAR, max_length=256),
        FieldSchema(name="category", dtype=DataType.VARCHAR, max_length=64),
        FieldSchema(name="text", dtype=DataType.VARCHAR, max_length=2000),
        FieldSchema(name="embedding", dtype=DataType.FLOAT_VECTOR, dim=dim),
    ]
    col = Collection(name, CollectionSchema(fields, description="distilled knowledge"))
    col.create_index(
        "embedding",
        {"index_type": "IVF_FLAT", "metric_type": "IP", "params": {"nlist": 128}},
    )
    return col


async def reindex_knowledge(*, limit: int | None = None) -> dict[str, Any]:
    global _MEMORY
    articles = _load_articles()
    if limit:
        articles = articles[:limit]
    texts = [_article_text(a) or str(a.get("title") or a.get("id") or "") for a in articles]
    vectors = local_embed(texts)
    # 可选：若配置了 embedding API，尝试覆盖（失败则保留 local）
    try:
        from app.llm_service import get_gateway

        gateway = get_gateway()
        api_vecs = await gateway.embed(texts)
        if api_vecs and len(api_vecs) == len(texts) and len(api_vecs[0]) >= 8:
            # 映射到 LOCAL_DIM 以便与现有 collection 对齐
            mapped = []
            for v in api_vecs:
                if len(v) == LOCAL_DIM:
                    mapped.append(v)
                else:
                    # 折叠到 LOCAL_DIM
                    folded = [0.0] * LOCAL_DIM
                    for i, x in enumerate(v):
                        folded[i % LOCAL_DIM] += float(x)
                    n = math.sqrt(sum(x * x for x in folded)) or 1.0
                    mapped.append([x / n for x in folded])
            vectors = mapped
    except Exception as exc:  # noqa: BLE001
        logger.info("API embed skipped, using local hash embed: %s", exc)

    if _use_milvus():
        try:
            from pymilvus import utility

            if utility.has_collection(COLLECTION_NAME):
                utility.drop_collection(COLLECTION_NAME)
            col = _ensure_collection(LOCAL_DIM)
            ids = [str(a.get("id") or f"k_{i}")[:90] for i, a in enumerate(articles)]
            paths = [str(a.get("path") or "")[:250] for a in articles]
            titles = [str(a.get("title") or "")[:250] for a in articles]
            cats = [str(a.get("category") or "")[:60] for a in articles]
            texts_trim = [t[:1900] for t in texts]
            col.insert([ids, paths, titles, cats, texts_trim, vectors])
            col.flush()
            _MEMORY = []
            return {"ok": True, "backend": "milvus", "count": len(articles), "collection": COLLECTION_NAME}
        except Exception as exc:  # noqa: BLE001
            logger.warning("milvus knowledge reindex failed: %s", exc)

    _MEMORY = [
        {
            "id": str(a.get("id") or f"k_{i}"),
            "path": str(a.get("path") or ""),
            "title": str(a.get("title") or ""),
            "category": str(a.get("category") or ""),
            "text": texts[i][:1900],
            "embedding": vectors[i],
        }
        for i, a in enumerate(articles)
    ]
    return {"ok": True, "backend": "memory", "count": len(_MEMORY), "collection": COLLECTION_NAME}


def search_knowledge_vectors(query: str, limit: int = 8, category: str | None = None) -> list[dict[str, Any]]:
    qvec = local_embed([query])[0]
    if _use_milvus():
        try:
            from pymilvus import Collection, utility

            if utility.has_collection(COLLECTION_NAME):
                col = Collection(COLLECTION_NAME)
                col.load()
                expr = f'category == "{category}"' if category else None
                res = col.search(
                    [qvec],
                    "embedding",
                    param={"metric_type": "IP", "params": {"nprobe": 10}},
                    limit=limit,
                    expr=expr,
                    output_fields=["path", "title", "category", "text"],
                )
                hits: list[dict[str, Any]] = []
                for batch in res:
                    for hit in batch:
                        hits.append(
                            {
                                "id": hit.id,
                                "path": hit.entity.get("path"),
                                "title": hit.entity.get("title"),
                                "category": hit.entity.get("category"),
                                "summary": (hit.entity.get("text") or "")[:240],
                                "score": float(hit.distance),
                                "source": "vector",
                            }
                        )
                return hits
        except Exception as exc:  # noqa: BLE001
            logger.info("milvus knowledge search failed: %s", exc)

    scored: list[dict[str, Any]] = []
    for row in _MEMORY:
        if category and category not in str(row.get("category") or ""):
            continue
        emb = row["embedding"]
        score = sum(a * b for a, b in zip(qvec, emb))
        scored.append(
            {
                "id": row["id"],
                "path": row["path"],
                "title": row["title"],
                "category": row["category"],
                "summary": row["text"][:240],
                "score": float(score),
                "source": "vector-memory",
            }
        )
    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored[:limit]
