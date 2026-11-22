from __future__ import annotations

import logging
from typing import Any

from app.llm_service import get_gateway
from app.settings import get_settings

logger = logging.getLogger("vector_store")

_COLLECTION = None
_MEMORY: dict[str, list[dict[str, Any]]] = {}


def _use_milvus() -> bool:
    try:
        from pymilvus import connections

        s = get_settings()
        connections.connect(alias="default", uri=s.milvus_uri)
        return True
    except Exception as exc:  # noqa: BLE001
        logger.info("Milvus unavailable, using memory vectors: %s", exc)
        return False


def _local_embed(texts: list[str], dim: int = 64) -> list[list[float]]:
    """确定性本地嵌入，禁止 dim=1 退化向量。"""
    import hashlib
    import math
    import re

    tok_re = re.compile(r"[\w\u4e00-\u9fff]+", re.UNICODE)
    out: list[list[float]] = []
    for text in texts:
        vec = [0.0] * dim
        for tok in tok_re.findall((text or "").lower()):
            h = int(hashlib.md5(tok.encode("utf-8")).hexdigest(), 16)
            vec[h % dim] += 1.0
        n = math.sqrt(sum(x * x for x in vec)) or 1.0
        out.append([x / n for x in vec])
    return out


async def upsert_chunks(doc_id: str, chunks: list[str]) -> None:
    if not chunks:
        return
    gateway = get_gateway()
    try:
        vectors = await gateway.embed(chunks)
        if not vectors or not vectors[0] or len(vectors[0]) < 8:
            raise RuntimeError("embed dim too small")
    except Exception as exc:  # noqa: BLE001
        logger.warning("embed failed, using local hash embed: %s", exc)
        vectors = _local_embed(chunks)

    if _use_milvus():
        try:
            from pymilvus import Collection, CollectionSchema, DataType, FieldSchema, utility

            s = get_settings()
            name = s.milvus_collection
            dim = len(vectors[0]) if vectors and vectors[0] else 8
            if not utility.has_collection(name):
                fields = [
                    FieldSchema(name="id", dtype=DataType.VARCHAR, is_primary=True, max_length=64),
                    FieldSchema(name="doc_id", dtype=DataType.VARCHAR, max_length=64),
                    FieldSchema(name="text", dtype=DataType.VARCHAR, max_length=2000),
                    FieldSchema(name="embedding", dtype=DataType.FLOAT_VECTOR, dim=dim),
                ]
                schema = CollectionSchema(fields, description="kb chunks")
                col = Collection(name, schema)
                col.create_index(
                    "embedding",
                    {"index_type": "IVF_FLAT", "metric_type": "L2", "params": {"nlist": 128}},
                )
            else:
                col = Collection(name)
            ids = [f"{doc_id}_{i}" for i in range(len(chunks))]
            col.insert([ids, [doc_id] * len(chunks), [c[:1900] for c in chunks], vectors])
            col.flush()
            return
        except Exception as exc:  # noqa: BLE001
            logger.warning("milvus upsert failed: %s", exc)

    _MEMORY[doc_id] = [
        {"id": f"{doc_id}_{i}", "text": chunks[i], "embedding": vectors[i]}
        for i in range(len(chunks))
    ]


def delete_chunks(doc_id: str) -> None:
    """按 doc_id 清理向量：Milvus 删除 + 内存回退删除。失败不抛出，仅记日志。"""
    try:
        from pymilvus import Collection

        s = get_settings()
        col = Collection(s.milvus_collection)
        col.delete(f'doc_id == "{doc_id}"')
        col.flush()
    except Exception as exc:  # noqa: BLE001
        logger.info("milvus delete skipped: %s", exc)
    _MEMORY.pop(doc_id, None)


async def search_chunks(query: str, limit: int = 8) -> list[dict[str, Any]]:
    gateway = get_gateway()
    try:
        qvec = (await gateway.embed([query]))[0]
        if not qvec or len(qvec) < 8:
            raise RuntimeError("bad query embed")
    except Exception:
        qvec = _local_embed([query])[0]

    if _use_milvus():
        try:
            from pymilvus import Collection

            s = get_settings()
            col = Collection(s.milvus_collection)
            col.load()
            res = col.search(
                [qvec],
                "embedding",
                param={"metric_type": "L2", "params": {"nprobe": 10}},
                limit=limit,
                output_fields=["doc_id", "text"],
            )
            hits: list[dict[str, Any]] = []
            for batch in res:
                for hit in batch:
                    hits.append(
                        {
                            "id": hit.id,
                            "docId": hit.entity.get("doc_id"),
                            "text": hit.entity.get("text"),
                            "score": float(hit.distance),
                        }
                    )
            return hits
        except Exception as exc:  # noqa: BLE001
            logger.info("milvus search failed: %s", exc)

    # memory cosine/L2 fallback
    scored: list[dict[str, Any]] = []
    for doc_id, rows in _MEMORY.items():
        for row in rows:
            emb = row["embedding"]
            dist = sum((a - b) ** 2 for a, b in zip(qvec, emb)) if emb else 999
            scored.append(
                {"id": row["id"], "docId": doc_id, "text": row["text"], "score": float(dist)}
            )
    scored.sort(key=lambda x: x["score"])
    return scored[:limit]
