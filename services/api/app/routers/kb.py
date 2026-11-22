from __future__ import annotations

import hashlib
import math
import re
import sys
import uuid
from sqlalchemy.exc import IntegrityError
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlmodel import Session, select

from ..db import get_session
from ..models import (
    ActivityLog,
    AgentRun,
    AnalysisReport,
    Artifact,
    ArtifactVersion,
    GraphSnapshot,
    Hotspot,
    Job,
    KbBinding,
    KbFolder,
    KnowledgeDoc,
    Project,
    SwapPlan,
    StoryFingerprint,
    TropeClip,
    new_id,
    utcnow,
)
from ..queue import enqueue_job, publish_job_event
from ..schemas import (
    APIModel,
    AnalysisReportOut,
    BindHotspotIn,
    HotspotUpsertIn,
    ComposeSwapIn,
    CreateFolderIn,
    GraphOut,
    HotspotOut,
    KbBindingOut,
    KbFolderOut,
    KnowledgeDocOut,
    MoveDocIn,
    PushToProjectIn,
    ReportPatchIn,
    TropeClipOut,
)
from ..settings import get_settings
from ..source_paths import read_source_text
from .projects import _set_stage

router = APIRouter(prefix="/kb", tags=["kb"])

# knowledge/ 蒸馏库检索（kb-core）
_KB_CORE = Path(__file__).resolve().parents[4] / "packages" / "kb-core"
if _KB_CORE.exists() and str(_KB_CORE) not in sys.path:
    sys.path.insert(0, str(_KB_CORE))

# 上传文档全文检索（kb_retrieval，位于 job-worker，与 worker 共享同一实现）
_JOB_WORKER = Path(__file__).resolve().parents[3] / "job-worker"
if _JOB_WORKER.exists() and str(_JOB_WORKER) not in sys.path:
    sys.path.insert(0, str(_JOB_WORKER))

from kb_retrieval import delete_document_index, search_documents  # noqa: E402

UPLOAD_DIR = Path(__file__).resolve().parents[2] / "data" / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50MB
ALLOWED_DOC_TYPES = {"novel", "short", "script_manju", "script_duanju", "notes", "other"}


def _user() -> str:
    return get_settings().demo_user_id


@router.get("/knowledge/search")
def search_distilled_knowledge(
    q: str = Query(..., min_length=1, description="关键词"),
    category: str | None = Query(default=None),
    limit: int = Query(default=8, ge=1, le=40),
    mode: str = Query(default="hybrid", description="keyword | vector | hybrid"),
    format: str | None = Query(default=None, description="当前写作格式，用于场景化排序"),
) -> dict:
    """检索 knowledge/ 蒸馏文：关键词 ∪ 向量（Milvus/本地回退）。"""
    try:
        from kb_core import search_knowledge  # type: ignore
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(503, f"知识索引不可用：{exc}") from exc

    index_path = Path(__file__).resolve().parents[4] / "knowledge" / "00-meta" / "search-index.json"
    if not index_path.exists():
        raise HTTPException(503, f"找不到索引文件：{index_path}")

    format_category = {
        "manju": "02-manju",
        "duanju": "03-duanju",
        "short_novel": "04-webnovel",
        "male_long": "16-male-long",
        "female_long": "12-female-long",
        "ip_adapt": "11-ip-adapt",
    }
    cat = category if isinstance(category, str) and category.strip() else None
    if not cat and format in format_category:
        cat = format_category[format]
    lim = int(limit) if not hasattr(limit, "default") else 8
    mode_l = (mode or "hybrid").lower()

    out: list[dict] = []
    if mode_l in {"keyword", "hybrid"}:
        hits = search_knowledge(
            q,
            {"category": cat, "limit": lim},
            index_path=index_path,
        )
        for h in hits:
            if hasattr(h, "to_dict"):
                d = h.to_dict()
            elif isinstance(h, dict):
                d = h
            else:
                d = {"title": str(h)}
            d.setdefault("source", "keyword")
            out.append(d)

    if mode_l in {"vector", "hybrid"}:
        try:
            import sys

            worker_root = Path(__file__).resolve().parents[3] / "job-worker"
            if str(worker_root) not in sys.path:
                sys.path.insert(0, str(worker_root))
            from knowledge_vector import search_knowledge_vectors  # type: ignore

            vhits = search_knowledge_vectors(q, limit=lim, category=cat)
            seen = {str(x.get("id") or x.get("path")) for x in out}
            for vh in vhits:
                key = str(vh.get("id") or vh.get("path"))
                if key in seen:
                    continue
                seen.add(key)
                out.append(vh)
        except Exception:
            pass

    if cat:
        def _rank(item: dict) -> tuple[int, int]:
            c = str(item.get("category") or item.get("path") or "")
            return (0 if cat in c else 1, 0)
        out.sort(key=_rank)

    out = out[:lim]
    return {
        "query": q,
        "hits": out,
        "count": len(out),
        "mode": mode_l,
        "indexPath": str(index_path),
        "category": cat,
    }


@router.get("/knowledge/docs/{doc_id:path}")
def get_knowledge_doc(
    doc_id: str,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=24000, ge=1, le=24000),
) -> dict:
    """按蒸馏库 id 或 path 读取 knowledge/ 正文（与 /knowledge/search 命中字段对齐）。

    Agents 的 kb_search 返回 id/path；kb_read 必须能读到同一套语料，否则会 404→tool_crash 熔断。
    """
    try:
        from kb_core import load_knowledge_index  # type: ignore
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(503, f"知识索引不可用：{exc}") from exc

    index_path = Path(__file__).resolve().parents[4] / "knowledge" / "00-meta" / "search-index.json"
    knowledge_root = Path(__file__).resolve().parents[4] / "knowledge"
    if not index_path.exists():
        raise HTTPException(503, f"找不到索引文件：{index_path}")

    key = (doc_id or "").strip().lstrip("/")
    if not key:
        raise HTTPException(400, "doc_id required")
    articles = load_knowledge_index(index_path)
    hit: dict | None = None
    for a in articles:
        aid = str(a.get("id") or "")
        apath = str(a.get("path") or "").lstrip("/")
        if key in {aid, apath} or apath.endswith(key) or key.endswith(apath):
            hit = dict(a)
            break
    if not hit:
        raise HTTPException(404, "knowledge doc not found")

    rel = str(hit.get("path") or "").lstrip("/")
    if not rel or ".." in rel.split("/"):
        raise HTTPException(400, "invalid knowledge path")
    body_file = (knowledge_root / rel).resolve()
    try:
        body_file.relative_to(knowledge_root.resolve())
    except ValueError as exc:
        raise HTTPException(400, "path escapes knowledge root") from exc
    if not body_file.is_file():
        raise HTTPException(404, f"knowledge file missing: {rel}")
    text = body_file.read_text(encoding="utf-8", errors="ignore")
    # 控制工具回传体积，避免撑爆上下文
    start = offset if isinstance(offset, int) else 0
    max_chars = limit if isinstance(limit, int) else 24000
    end = min(len(text), start + max_chars)
    truncated = end < len(text)
    return {
        "id": hit.get("id"),
        "path": rel,
        "title": hit.get("title"),
        "category": hit.get("category"),
        "tags": hit.get("tags") or [],
        "summary": hit.get("summary"),
        "text": text[start:end],
        "offset": start,
        "totalChars": len(text),
        "nextOffset": end if truncated else None,
        "truncated": truncated,
        "source": "knowledge",
    }


@router.post("/knowledge/reindex")
def reindex_knowledge_vectors(session: Session = Depends(get_session)) -> dict:
    """入队蒸馏知识向量灌库（Milvus 或内存回退）。"""
    from ..models import Job
    from ..queue import enqueue_job, publish_job_event
    from ..settings import get_settings

    settings = get_settings()
    job = Job(
        type="knowledge.vector_ingest",
        payload={},
        user_id=settings.demo_user_id,
        status="queued",
    )
    session.add(job)
    session.commit()
    session.refresh(job)
    enqueue_job(job.id, {"type": job.type, "payload": job.payload})
    publish_job_event(job.id, {"type": "status", "status": "queued", "jobId": job.id})
    return {"ok": True, "jobId": job.id, "hint": "蒸馏 knowledge/ → kb_knowledge 向量集合"}


@router.post("/reindex")
def reindex_documents(session: Session = Depends(get_session)) -> dict:
    """入队全量重建上传文档全文检索索引（FTS5 + 文档向量）。"""
    job = Job(type="kb.reindex_all", payload={}, user_id=_user(), status="queued")
    session.add(job)
    session.commit()
    session.refresh(job)
    enqueue_job(job.id, {"type": job.type, "payload": job.payload})
    publish_job_event(job.id, {"type": "status", "status": "queued", "jobId": job.id})
    return {"ok": True, "jobId": job.id, "hint": "重建 kb_fts / kb_doc_vector 索引"}


@router.get("/document-options")
def owned_document_options(session: Session = Depends(get_session)) -> list[dict]:
    rows = session.exec(select(KnowledgeDoc.id, KnowledgeDoc.title).where(KnowledgeDoc.user_id == _user())
                        .order_by(KnowledgeDoc.updated_at.desc()))
    return [dict(id=identity, title=title) for identity, title in rows]


@router.get("/docs", response_model=list[KnowledgeDocOut])
def list_docs(session: Session = Depends(get_session)) -> list[KnowledgeDoc]:
    return list(session.exec(select(KnowledgeDoc).where(KnowledgeDoc.user_id == _user()).order_by(KnowledgeDoc.updated_at.desc())))


@router.get("/folders", response_model=list[KbFolderOut])
def list_folders(session: Session = Depends(get_session)) -> list[KbFolder]:
    return list(session.exec(select(KbFolder).order_by(KbFolder.created_at)))


@router.post("/folders", response_model=KbFolderOut)
def create_folder(body: CreateFolderIn, session: Session = Depends(get_session)) -> KbFolder:
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, "文件夹名不能为空")
    folder = KbFolder(name=name[:80], user_id=_user())
    session.add(folder)
    session.commit()
    session.refresh(folder)
    return folder


@router.post("/docs/{doc_id}/move")
def move_doc(doc_id: str, body: MoveDocIn, session: Session = Depends(get_session)) -> dict:
    doc = session.get(KnowledgeDoc, doc_id)
    if not doc:
        raise HTTPException(404, "doc not found")
    doc.folder_id = body.folder_id
    doc.updated_at = utcnow()
    session.add(doc)
    session.commit()
    return {"ok": True, "doc_id": doc_id, "folder_id": body.folder_id}


@router.get("/docs/{doc_id}", response_model=KnowledgeDocOut)
def get_doc(
    doc_id: str,
    session: Session = Depends(get_session),
) -> KnowledgeDoc:
    doc = session.get(KnowledgeDoc, doc_id)
    if not doc:
        raise HTTPException(404, "doc not found")
    return doc


def _doc_text(doc: KnowledgeDoc) -> str:
    uri = doc.storage_uri or ""
    try:
        if uri.startswith("inline:"):
            text = uri[len("inline:"):]
            if doc.word_count and doc.word_count > len(text):
                raise ValueError("历史内联原文疑似被截断，请重新上传完整源文件")
        elif uri and (uri.startswith("file://") or "://" not in uri):
            text = read_source_text(uri.removeprefix("file://"))
        else:
            raise ValueError("原文存储地址缺失或不受支持，请重新上传源文件")
        if not text.strip():
            raise ValueError("未提取到原文正文，请检查源文件")
        return text
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except Exception as exc:
        detail = str(exc) if isinstance(exc, ValueError) else "原文解析失败，请检查源文件"
        raise HTTPException(422, detail) from exc


@router.get("/docs/{doc_id}/text")
def get_doc_text(
    doc_id: str,
    offset: int = Query(default=0, ge=0),
    limit: int | None = Query(default=None, ge=1, le=12000),
    session: Session = Depends(get_session),
) -> dict:
    """原文读取；传 limit 时按字符分页，旧旁注调用保留全文响应。"""
    doc = session.get(KnowledgeDoc, doc_id)
    if not doc:
        raise HTTPException(404, "doc not found")
    return doc_text_page(doc, _doc_text(doc), offset, limit)


def doc_text_page(doc, text, offset, limit):
    doc_id = doc.id
    if not isinstance(limit, int):
        return {"doc_id": doc_id, "title": doc.title, "text": text}
    start = offset if isinstance(offset, int) else 0
    end = min(len(text), start + limit)
    return {
        "doc_id": doc_id, "title": doc.title, "source": "documents",
        "text": text[start:end], "offset": start, "totalChars": len(text),
        "nextOffset": end if end < len(text) else None,
        "truncated": end < len(text),
    }


@router.post("/docs", response_model=KnowledgeDocOut)
async def create_doc(
    title: str = Query(...),
    doc_type: str = Query("notes"),
    tags: str | None = Query(default=None, description="逗号分隔的标签，如 对标书/我的草稿"),
    content: str | None = Form(default=None),
    file: UploadFile | None = File(default=None),
    session: Session = Depends(get_session),
) -> KnowledgeDoc:
    doc_id = new_id()
    storage_uri = ""
    raw = b""
    if file is not None:
        raw = await file.read()
        if len(raw) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, "文件过大：单文件上限 50MB")
        suffix = Path(file.filename or "upload.bin").suffix or ".bin"
        dest = UPLOAD_DIR / f"{doc_id}{suffix}"
        dest.write_bytes(raw)
        storage_uri = str(dest)
        if not title:
            title = file.filename or title
    elif content:
        if len(content.encode("utf-8")) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, "文本过长：单篇上限 50MB")
        storage_uri = f"inline:{content}"
        raw = content.encode("utf-8")

    if doc_type not in ALLOWED_DOC_TYPES:
        raise HTTPException(400, f"不支持的文档类型：{doc_type}")

    tag_list = [
        t.strip() for t in (tags or "").split(",") if t.strip()
    ][:12]

    doc = KnowledgeDoc(
        id=doc_id,
        title=title,
        doc_type=doc_type,
        status="indexed",
        user_id=_user(),
        tags=tag_list,
        word_count=len(raw.decode("utf-8", errors="ignore")) if raw else 0,
        storage_uri=storage_uri or None,
        hash=hashlib.sha256(raw).hexdigest() if raw else None,
    )
    session.add(doc)
    job = Job(
        type="kb.ingest",
        payload={"docId": doc.id},
        user_id=_user(),
        status="queued",
    )
    session.add(job)
    session.commit()
    session.refresh(doc)
    session.refresh(job)
    enqueue_job(job.id, {"type": job.type, "payload": job.payload})
    publish_job_event(job.id, {"type": "status", "status": "queued", "jobId": job.id})
    return doc


@router.delete("/docs/{doc_id}")
def delete_doc(
    doc_id: str,
    session: Session = Depends(get_session),
) -> dict[str, str]:
    doc = session.get(KnowledgeDoc, doc_id)
    if not doc:
        raise HTTPException(404, "doc not found")
    for r in session.exec(select(AnalysisReport).where(AnalysisReport.doc_id == doc_id)):
        session.delete(r)
    for g in session.exec(select(GraphSnapshot).where(GraphSnapshot.doc_id == doc_id)):
        session.delete(g)
    for t in session.exec(select(TropeClip).where(TropeClip.source_doc_id == doc_id)):
        session.delete(t)
    for f in session.exec(select(StoryFingerprint).where(StoryFingerprint.doc_id == doc_id)):
        session.delete(f)
    for b in session.exec(select(KbBinding).where(KbBinding.doc_id == doc_id)):
        session.delete(b)
    session.delete(doc)
    session.commit()

    # 清理对象/向量/本地文件（best-effort，不影响主流程）
    storage_uri = doc.storage_uri or ""
    try:
        from minio_store import delete_object

        if storage_uri.startswith("minio://"):
            bucket = get_settings().minio_bucket
            obj = storage_uri.removeprefix(f"minio://{bucket}/")
            delete_object(obj)
    except Exception:
        pass
    if storage_uri.startswith("file://") or (
        storage_uri and Path(storage_uri).exists() and str(Path(storage_uri).parent).startswith(str(UPLOAD_DIR))
    ):
        try:
            Path(storage_uri).unlink(missing_ok=True)
        except Exception:
            pass
    try:
        from vector_store import delete_chunks

        delete_chunks(doc_id)
    except Exception:
        pass
    try:
        delete_document_index(doc_id)
    except Exception:
        pass
    return {"status": "deleted"}


class AnalyzeDocIn(APIModel):
    analysis_scope: Literal["sample", "full"] = "sample"


@router.post("/docs/{doc_id}/analyze")
def analyze_doc(
    doc_id: str,
    body: AnalyzeDocIn | None = None,
    session: Session = Depends(get_session),
) -> dict:
    doc = session.get(KnowledgeDoc, doc_id)
    if not doc:
        raise HTTPException(404, "doc not found")
    doc.status = "analyzing"
    doc.updated_at = utcnow()
    scope = body.analysis_scope if body else "sample"
    job = Job(type="kb.analyze", payload={"docId": doc_id, "analysisScope": scope}, user_id=_user(), status="queued")
    session.add(doc)
    session.add(job)
    session.commit()
    session.refresh(job)
    enqueue_job(job.id, {"type": job.type, "payload": job.payload})
    publish_job_event(job.id, {"type": "status", "status": "queued", "jobId": job.id})
    chunks = math.ceil(doc.word_count / 8000) if doc.word_count else None
    return {"jobId": job.id, "status": "queued", "analysisScope": scope,
        "sourceChars": doc.word_count, "estimatedChunks": chunks if scope == "full" else 1,
        "estimatedCalls": (2 * chunks + 11) if scope == "full" and chunks else (12 if scope == "sample" else None)}


@router.get("/docs/{doc_id}/reports", response_model=list[AnalysisReportOut])
def list_reports(
    doc_id: str,
    session: Session = Depends(get_session),
) -> list[AnalysisReport]:
    if not session.get(KnowledgeDoc, doc_id):
        raise HTTPException(404, "doc not found")
    return list(session.exec(select(AnalysisReport).where(AnalysisReport.doc_id == doc_id).order_by(AnalysisReport.created_at.desc())))


@router.patch("/docs/{doc_id}/reports/{report_id}", response_model=AnalysisReportOut)
def patch_report(
    doc_id: str,
    report_id: str,
    body: ReportPatchIn,
    session: Session = Depends(get_session),
) -> AnalysisReport:
    row = session.get(AnalysisReport, report_id)
    if not row or row.doc_id != doc_id:
        raise HTTPException(404, "report not found")
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(row, k, v)
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@router.get("/search")
async def search_kb(
    q: str = "",
    include_web: bool | None = Query(None, alias="includeWeb"),
    session: Session = Depends(get_session),
) -> dict:
    docs = list(session.exec(select(KnowledgeDoc)))
    tropes = list(session.exec(select(TropeClip)))
    ql = q.lower().strip()

    # 标题 / 标签兜底匹配（保留历史语义，与全文检索结果合并去重）
    title_matched = [
        d
        for d in docs
        if not ql
        or ql in d.title.lower()
        or any(ql in t.lower() for t in d.tags)
        or (d.storage_uri and ql in (d.storage_uri or "").lower())
    ]

    # 全文检索（FTS5 bigram + 文档向量 + RRF），主路径
    matches: list[dict] = []
    if ql:
        try:
            matches = search_documents(session, ql, limit=20)
        except Exception as exc:  # noqa: BLE001
            matches = []

    fulltext_ids = [m["docId"] for m in matches]
    ordered: list[KnowledgeDoc] = []
    seen: set[str] = set()
    for doc_id in fulltext_ids:
        d = session.get(KnowledgeDoc, doc_id)
        if d and d.id not in seen:
            seen.add(d.id)
            ordered.append(d)
    for d in title_matched:
        if d.id not in seen:
            seen.add(d.id)
            ordered.append(d)
    if not ql:
        ordered = docs

    matched_docs = [
        KnowledgeDocOut.model_validate(d).model_dump(by_alias=True) for d in ordered
    ]
    matched_tropes = [
        TropeClipOut.model_validate(t).model_dump(by_alias=True)
        for t in tropes
        if not ql or ql in t.name.lower() or ql in t.summary.lower()
    ]
    local_answer = (
        f"本地库命中 {len(matched_docs)} 篇文档、{len(matched_tropes)} 条桥段。"
        if ql
        else "显示全部本地知识库条目。"
    )
    payload: dict = {
        "docs": matched_docs,
        "matches": matches,
        "tropes": matched_tropes,
        "answer": local_answer,
        "local": {
            "docs": matched_docs,
            "tropes": matched_tropes,
            "answer": local_answer,
        },
    }
    if include_web is True or (include_web is None and get_settings().web_search_enabled):
        from ..web_search import web_search

        web = await web_search(q or "短剧漫剧题材趋势")
        payload["web"] = web
        payload["answer"] = f"{local_answer} | 联网：{(web.get('summary') or '')[:200]}"
    return payload


@router.get("/graph/{doc_id}", response_model=GraphOut)
def get_graph(
    doc_id: str,
    session: Session = Depends(get_session),
) -> GraphSnapshot:
    if not session.get(KnowledgeDoc, doc_id):
        raise HTTPException(404, "doc not found")
    graph = session.exec(select(GraphSnapshot).where(GraphSnapshot.doc_id == doc_id)).first()
    if not graph:
        raise HTTPException(404, "graph not found")
    return graph


@router.get("/tropes", response_model=list[TropeClipOut])
def list_tropes(session: Session = Depends(get_session)) -> list[TropeClip]:
    return list(session.exec(select(TropeClip)))


class _TropeSearchBookOut(APIModel):
    doc_id: str
    title: str
    matched_tags: list[str] = []
    genre: str = ""


class TropeSearchOut(APIModel):
    tropes: list[TropeClipOut]
    books: list[_TropeSearchBookOut]


@router.get("/search/tropes", response_model=TropeSearchOut)
def search_tropes(
    q: str = Query(default=""),
    limit: int = Query(default=50, ge=1, le=500),
    session: Session = Depends(get_session),
) -> dict:
    """按梗/情节关键词搜索：桥段（名称/标签/适用题材）+ 书指纹（梗标签/梗类别/题材/金手指）。"""
    ql = (q or "").strip().lower()
    if not ql:
        return {"tropes": [], "books": []}

    tropes: list[TropeClip] = []
    for t in session.exec(select(TropeClip)):
        if (
            ql in t.name.lower()
            or any(ql in tag.lower() for tag in t.tags or [])
            or any(ql in g.lower() for g in t.applicable_genres or [])
        ):
            tropes.append(t)
            if len(tropes) >= limit:
                break

    matched_fps: list[StoryFingerprint] = []
    for fp in session.exec(select(StoryFingerprint)):
        if not (
            any(ql in tag.lower() for tag in fp.trope_tags or [])
            or (fp.hook_category and ql in fp.hook_category.lower())
            or (fp.genre and ql in fp.genre.lower())
            or (fp.gold_finger and ql in fp.gold_finger.lower())
        ):
            continue
        matched_fps.append(fp)
        if len(matched_fps) >= limit:
            break

    titles: dict[str, str] = {}
    if matched_fps:
        titles = {
            doc.id: doc.title
            for doc in session.exec(
                select(KnowledgeDoc).where(
                    KnowledgeDoc.id.in_([fp.doc_id for fp in matched_fps])
                )
            )
        }

    books: list[dict[str, Any]] = [
        {
            "doc_id": fp.doc_id,
            "title": titles.get(fp.doc_id, fp.doc_id),
            "matched_tags": [tag for tag in fp.trope_tags or [] if ql in tag.lower()],
            "genre": fp.genre,
        }
        for fp in matched_fps
    ]

    return {"tropes": tropes, "books": books}


class _TropeCountOut(APIModel):
    tag: str
    count: int


class _GenreCountOut(APIModel):
    genre: str
    count: int


class _CategoryCountOut(APIModel):
    category: str
    count: int


class TropeStatsOut(APIModel):
    trope_counts: list[_TropeCountOut]
    genre_counts: list[_GenreCountOut]
    hook_category_counts: list[_CategoryCountOut]
    total_tropes: int
    total_docs: int


@router.get("/tropes/stats", response_model=TropeStatsOut)
def trope_stats(session: Session = Depends(get_session)) -> dict:
    """聚合桥段标签 + 书指纹标签/题材/梗类别的频次，供「哪些相似梗/情节最多」排行。"""
    trope_counter: dict[str, int] = {}
    for clip in session.exec(select(TropeClip)):
        for tag in clip.tags or []:
            if tag:
                trope_counter[tag] = trope_counter.get(tag, 0) + 1

    genre_counter: dict[str, int] = {}
    hook_counter: dict[str, int] = {}
    fingerprints = list(session.exec(select(StoryFingerprint)))
    for fp in fingerprints:
        for tag in fp.trope_tags or []:
            if tag:
                trope_counter[tag] = trope_counter.get(tag, 0) + 1
        if fp.genre:
            genre_counter[fp.genre] = genre_counter.get(fp.genre, 0) + 1
        if fp.hook_category:
            hook_counter[fp.hook_category] = hook_counter.get(fp.hook_category, 0) + 1

    def _top(counter: dict[str, int], key: str) -> list[dict[str, Any]]:
        return [
            {key: name, "count": cnt}
            for name, cnt in sorted(counter.items(), key=lambda kv: (-kv[1], kv[0]))[:50]
        ]

    return {
        "trope_counts": _top(trope_counter, "tag"),
        "genre_counts": _top(genre_counter, "genre"),
        "hook_category_counts": _top(hook_counter, "category"),
        "total_tropes": len(trope_counter),
        "total_docs": len(fingerprints),
    }


@router.patch("/tropes/{trope_id}/favorite", response_model=TropeClipOut)
def toggle_trope_favorite(
    trope_id: str,
    favorited: bool = Query(...),
    session: Session = Depends(get_session),
) -> TropeClip:
    t = session.get(TropeClip, trope_id)
    if not t:
        raise HTTPException(404, "trope not found")
    t.favorited = favorited
    session.add(t)
    session.commit()
    session.refresh(t)
    return t


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b:
        return 0.0
    n = min(len(a), len(b))
    dot = sum(a[i] * b[i] for i in range(n))
    na = math.sqrt(sum(x * x for x in a[:n])) or 1.0
    nb = math.sqrt(sum(x * x for x in b[:n])) or 1.0
    return dot / (na * nb)


@router.get("/similar/{doc_id}")
def similar_docs(
    doc_id: str,
    session: Session = Depends(get_session),
) -> dict:
    """按故事指纹返回相似书：梗/题材/金手指/情绪曲线/桥段标签的向量相似度。"""
    doc = session.get(KnowledgeDoc, doc_id)
    if not doc:
        raise HTTPException(404, "doc not found")
    fp = session.exec(
        select(StoryFingerprint).where(StoryFingerprint.doc_id == doc_id)
    ).first()
    if not fp:
        return {
            "doc_id": doc_id,
            "title": doc.title,
            "items": [],
            "hint": "尚未生成故事指纹，请先对该书重新拆解分析。",
        }
    rows = list(
        session.exec(select(StoryFingerprint).where(StoryFingerprint.doc_id != doc_id)).all()
    )
    scored: list[dict[str, Any]] = []
    for other in rows:
        sim = _cosine(fp.vector or [], other.vector or [])
        shared = sorted(set(fp.trope_tags or []) & set(other.trope_tags or []))
        reasons: list[str] = []
        if fp.genre and fp.genre == other.genre:
            reasons.append("题材相似")
        if fp.gold_finger and fp.gold_finger == other.gold_finger:
            reasons.append("金手指相似")
        if fp.hook_category and fp.hook_category == other.hook_category:
            reasons.append("梗类相似")
        if shared:
            reasons.append(f"桥段标签重叠 {len(shared)}")
        unit_overlap = sorted(set(fp.unit_purposes or []) & set(other.unit_purposes or []))
        if unit_overlap:
            reasons.append("单元结构相似")
        scored.append(
            {
                "doc_id": other.doc_id,
                "score": round(sim, 4),
                "shared_tags": shared[:6],
                "same_genre": bool(fp.genre and fp.genre == other.genre),
                "same_hook": bool(fp.hook_category and fp.hook_category == other.hook_category),
                "reasons": reasons[:4],
            }
        )
    scored.sort(key=lambda x: (-x["score"], -len(x["shared_tags"])))
    out: list[dict[str, Any]] = []
    for it in scored[:8]:
        d = session.get(KnowledgeDoc, it["doc_id"])
        it["title"] = d.title if d else it["doc_id"]
        out.append(it)
    return {"doc_id": doc_id, "title": doc.title, "items": out}


@router.get("/hotspots", response_model=list[HotspotOut])
def list_hotspots(session: Session = Depends(get_session)) -> list[HotspotOut]:
    rows = list(session.exec(select(Hotspot).order_by(Hotspot.fetched_at.desc())))
    out: list[HotspotOut] = []
    for r in rows:
        meta = getattr(r, "meta", None) or {}
        out.append(
            HotspotOut(
                id=r.id,
                title=r.title,
                genre=r.genre,
                source=r.source,
                summary=r.summary,
                fetched_at=r.fetched_at,
                status=r.status,
                meta=meta,
                project_id=meta.get("project_id") if isinstance(meta, dict) else None,
            )
        )
    return out


@router.post("/hotspots/{hotspot_id}/bind")
def bind_hotspot(
    hotspot_id: str,
    body: BindHotspotIn,
    session: Session = Depends(get_session),
) -> dict:
    """把榜单条目绑定到项目（写 meta.project_id，作为扫榜回流对标记录）。"""
    h = session.get(Hotspot, hotspot_id)
    if not h:
        raise HTTPException(404, "hotspot not found")
    project = session.get(Project, body.project_id)
    if not project:
        raise HTTPException(404, "project not found")
    meta = dict(getattr(h, "meta", None) or {})
    meta["project_id"] = body.project_id
    h.meta = meta
    project.cover_meta = {
        **(project.cover_meta or {}),
        "benchmark": h.title,
        "hotspotId": hotspot_id,
    }
    project.updated_at = utcnow()
    session.add(h)
    session.add(project)
    session.commit()
    return {"ok": True, "hotspot_id": h.id, "project_id": body.project_id}


@router.post("/hotspots", response_model=HotspotOut)
def create_hotspot(
    body: HotspotUpsertIn,
    session: Session = Depends(get_session),
) -> HotspotOut:
    """手动登记一条热点（记录灵感 / 自选题材）。"""
    row = Hotspot(
        title=body.title.strip(),
        genre=body.genre.strip(),
        source=body.source.strip() or "手动",
        summary=body.summary.strip(),
        status="ok",
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return HotspotOut(
        id=row.id,
        title=row.title,
        genre=row.genre,
        source=row.source,
        summary=row.summary,
        fetched_at=row.fetched_at,
        status=row.status,
        meta=row.meta or {},
        project_id=(row.meta or {}).get("project_id"),
    )


@router.patch("/hotspots/{hotspot_id}", response_model=HotspotOut)
def update_hotspot(
    hotspot_id: str,
    body: HotspotUpsertIn,
    session: Session = Depends(get_session),
) -> HotspotOut:
    row = session.get(Hotspot, hotspot_id)
    if not row:
        raise HTTPException(404, "hotspot not found")
    row.title = body.title.strip()
    row.genre = body.genre.strip()
    row.source = body.source.strip() or row.source
    row.summary = body.summary.strip()
    session.add(row)
    session.commit()
    session.refresh(row)
    return HotspotOut(
        id=row.id,
        title=row.title,
        genre=row.genre,
        source=row.source,
        summary=row.summary,
        fetched_at=row.fetched_at,
        status=row.status,
        meta=row.meta or {},
        project_id=(row.meta or {}).get("project_id"),
    )


@router.delete("/hotspots/{hotspot_id}")
def delete_hotspot(hotspot_id: str, session: Session = Depends(get_session)) -> dict:
    row = session.get(Hotspot, hotspot_id)
    if not row:
        raise HTTPException(404, "hotspot not found")
    session.delete(row)
    session.commit()
    return {"status": "deleted"}


@router.post("/docs/{doc_id}/push-to-project")
def push_to_project(
    doc_id: str,
    body: PushToProjectIn,
    session: Session = Depends(get_session),
) -> dict:
    doc = session.get(KnowledgeDoc, doc_id)
    project = session.get(Project, body.project_id)
    if not doc or not project:
        raise HTTPException(404, "doc or project not found")

    # 选择要带进项目的报告正文
    report = None
    if body.mode == "dissect":
        report = session.exec(
            select(AnalysisReport).where(
                AnalysisReport.doc_id == doc_id,
                AnalysisReport.report_type == "dissect_params",
            )
        ).first()
    elif body.mode == "imitate":
        report = session.exec(
            select(AnalysisReport).where(
                AnalysisReport.doc_id == doc_id,
                AnalysisReport.report_type == "style_extract",
            )
        ).first() or session.exec(
            select(AnalysisReport).where(
                AnalysisReport.doc_id == doc_id,
                AnalysisReport.report_type == "dissect_params",
            )
        ).first()

    target_type = "project_meta"
    target_id = project.id
    created_artifact_id: str | None = None

    if report:
        art_type = "dissect_params" if body.mode == "dissect" else "framework"
        art_title = (
            f"拆书参数 · {doc.title}"
            if body.mode == "dissect"
            else f"文风参考 · {doc.title}"
        )
        art = Artifact(
            project_id=project.id,
            type=art_type,
            title=art_title,
            status="candidate",
            body_markdown=report.body_markdown,
            body_json={
                "sourceDocId": doc.id,
                "reportId": report.id,
                "reportType": report.report_type,
                "mode": body.mode,
                "benchmark": doc.title,
            },
        )
        session.add(art)
        session.flush()
        session.add(
            ArtifactVersion(
                artifact_id=art.id,
                version=art.version,
                title=art.title,
                status=art.status,
                body_markdown=art.body_markdown,
                body_json=art.body_json,
                note="初始版本",
                actor="user",
            )
        )
        target_type = "artifact"
        target_id = art.id
        created_artifact_id = art.id
    elif body.mode == "swap":
        swap = session.exec(
            select(SwapPlan)
            .where(SwapPlan.source_doc_id == doc_id, SwapPlan.project_id == project.id)
            .order_by(SwapPlan.updated_at.desc())
        ).first()
        if swap:
            target_type = "swap_plan"
            target_id = swap.id
        else:
            # 无既有换元方案时，落地真实 SwapPlan 行（源已填、目标空，由 swap.master 填充映射）
            base_elems = _extract_doc_elements(session, doc)
            mapping = [
                {
                    "key": key,
                    "label": _ELEMENT_LABELS[key],
                    "source": base_elems.get(key) or "",
                    "target": "",
                    "sourceDocId": doc.id,
                    "sourceDocTitle": doc.title,
                    "swappable": key != "subject",
                }
                for key in ("event", "structure", "subject", "background", "character", "prop")
            ]
            plan = SwapPlan(
                user_id=_user(),
                project_id=project.id,
                source_doc_id=doc_id,
                degree="one",
                mapping_json=mapping,
            )
            session.add(plan)
            session.flush()
            target_type = "swap_plan"
            target_id = plan.id

    # 跳转到对应格式的对应阶段
    if body.mode == "dissect":
        if project.format == "short_novel":
            _set_stage(session, project, "S1_DISSECT", reason="知识库拆书应用到写作台")
        elif project.format == "male_long":
            _set_stage(session, project, "S1_TOPIC_SCAN", reason="知识库拆书应用到写作台")
        elif project.format == "female_long":
            _set_stage(session, project, "S1_TOPIC", reason="知识库拆书应用到写作台")
        elif project.format == "ip_adapt":
            _set_stage(session, project, "S1_IP_EVAL", reason="知识库拆书应用到写作台")
    elif body.mode == "swap":
        if project.format == "short_novel":
            _set_stage(session, project, "S2_SWAP", reason="知识库换元方案应用到写作台")
        elif project.format == "ip_adapt":
            _set_stage(session, project, "S2_UNIT_SPLIT", reason="知识库换元方案应用到写作台")
    elif body.mode == "imitate":
        if project.format == "short_novel":
            _set_stage(session, project, "S2_SWAP", reason="知识库模仿应用到写作台")
        elif project.format == "ip_adapt":
            _set_stage(session, project, "S2_UNIT_SPLIT", reason="知识库模仿应用到写作台")
        elif project.format == "female_long":
            _set_stage(session, project, "S1_FOUR_SWAP", reason="知识库模仿应用到写作台")

    project.cover_meta = {
        **project.cover_meta,
        "benchmark": doc.title,
        "sourceDocId": doc.id,
        "pushMode": body.mode,
    }
    project.updated_at = utcnow()
    session.add(project)
    session.add(
        KbBinding(
            user_id=_user(),
            doc_id=doc_id,
            project_id=project.id,
            target_type=target_type,
            target_id=target_id,
            mode=body.mode,
        )
    )
    session.add(
        ActivityLog(
            user_id=_user(),
            actor="user",
            action="kb_push_to_project",
            summary=f"知识库应用到写作台 · {body.mode}",
            project_id=project.id,
            detail={
                "doc_id": doc.id,
                "mode": body.mode,
                "target_type": target_type,
                "target_id": target_id,
                "artifact_id": created_artifact_id,
            },
        )
    )
    session.commit()
    return {
        "ok": True,
        "projectId": project.id,
        "stage": project.stage,
        "targetType": target_type,
        "targetId": target_id,
    }


_ELEMENT_LABELS = {
    "event": "事件",
    "structure": "结构",
    "subject": "主体/价值观",
    "background": "背景",
    "character": "人物",
    "prop": "道具/金手指",
}


def _report_json(session: Session, doc_id: str, report_type: str) -> dict[str, Any]:
    row = session.exec(
        select(AnalysisReport).where(
            AnalysisReport.doc_id == doc_id,
            AnalysisReport.report_type == report_type,
        )
    ).first()
    return (row.body_json or {}) if row and isinstance(row.body_json, dict) else {}


def _first_text(*values: Any) -> str:
    for v in values:
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def _extract_doc_elements(session: Session, doc: KnowledgeDoc) -> dict[str, str]:
    dissect = _report_json(session, doc.id, "dissect_params")
    hook = _report_json(session, doc.id, "core_hook_extract")
    unit = _report_json(session, doc.id, "unit_story")
    basic = dissect.get("basic") or {}
    setting = dissect.get("setting") or {}
    storyline = dissect.get("storyline") or {}
    rhythm = dissect.get("rhythmStyle") or {}
    relationships = dissect.get("relationships") or []
    conflicts = dissect.get("conflicts") or []
    hooks = hook.get("hooks") or []
    units = unit.get("units") or []

    rel_text = ""
    if relationships:
        first = relationships[0] if isinstance(relationships[0], dict) else {}
        a = _first_text(first.get("from"), first.get("a"))
        b = _first_text(first.get("to"), first.get("b"))
        rel_text = f"{a}↔{b}" if a and b else (a or b)

    hook_text = ""
    if hooks:
        h = hooks[0] if isinstance(hooks[0], dict) else {}
        hook_text = _first_text(h.get("coreHook"), h.get("titleHook"))

    unit_text = ""
    if units:
        u = units[0] if isinstance(units[0], dict) else {}
        unit_text = _first_text(u.get("purpose"), u.get("title"), u.get("summary"))

    return {
        "character": _first_text(
            rel_text,
            setting.get("protagonist"),
            basic.get("protagonist"),
        ),
        "background": _first_text(
            setting.get("background"),
            setting.get("world"),
            dissect.get("world"),
        ),
        "prop": _first_text(
            setting.get("goldFinger"),
            setting.get("gold_finger"),
            basic.get("goldFinger"),
        ),
        "event": _first_text(
            conflicts[0] if conflicts else "",
            storyline.get("coreContent"),
            hook_text,
        ),
        "structure": _first_text(
            unit_text,
            rhythm.get("rhythm"),
            rhythm.get("structure"),
        ),
        "subject": _first_text(basic.get("genre"), basic.get("typeLabel")),
    }


@router.post("/docs/{doc_id}/compose")
def compose_swap(
    doc_id: str,
    body: ComposeSwapIn,
    session: Session = Depends(get_session),
) -> dict:
    """多书组合复用：自动拆解基准书与来源书，生成带来源标注的六元素换元映射。"""
    base = session.get(KnowledgeDoc, doc_id)
    if not base:
        raise HTTPException(404, "doc not found")
    combos: list[KnowledgeDoc] = []
    for cid in body.combo_doc_ids[:3]:
        combo = session.get(KnowledgeDoc, cid)
        if combo and combo.id != doc_id:
            combos.append(combo)

    base_elems = _extract_doc_elements(session, base)
    mapping: list[dict[str, Any]] = []
    used_sources: dict[str, list[str]] = {}
    for key in ("event", "structure", "subject", "background", "character", "prop"):
        source = base_elems.get(key) or ""
        target = ""
        source_doc_id = None
        source_doc_title = None
        for combo in combos:
            combo_elems = _extract_doc_elements(session, combo)
            candidate = combo_elems.get(key) or ""
            if candidate:
                target = candidate
                source_doc_id = combo.id
                source_doc_title = combo.title
                used_sources.setdefault(combo.id, []).append(key)
                break
        mapping.append(
            {
                "key": key,
                "label": _ELEMENT_LABELS[key],
                "source": source,
                "target": target,
                "sourceDocId": source_doc_id,
                "sourceDocTitle": source_doc_title,
                "swappable": key != "subject",
            }
        )

    swap_plan_id = None
    if body.project_id:
        project = session.get(Project, body.project_id)
        if project:
            plan = SwapPlan(
                user_id=_user(),
                project_id=project.id,
                source_doc_id=doc_id,
                degree=body.degree,
                mapping_json=mapping,
            )
            session.add(plan)
            session.commit()
            session.refresh(plan)
            swap_plan_id = plan.id

    return {
        "degree": body.degree,
        "base": {"docId": base.id, "title": base.title},
        "sources": [
            {"docId": c.id, "title": c.title, "usedFor": used_sources.get(c.id, [])}
            for c in combos
        ],
        "mapping": mapping,
        "swapPlanId": swap_plan_id,
    }


@router.get("/docs/{doc_id}/bindings", response_model=list[KbBindingOut])
def list_bindings(
    doc_id: str,
    session: Session = Depends(get_session),
) -> list[KbBinding]:
    if not session.get(KnowledgeDoc, doc_id):
        raise HTTPException(404, "doc not found")
    return list(
        session.exec(
            select(KbBinding).where(KbBinding.doc_id == doc_id).order_by(KbBinding.created_at.desc())
        ).all()
    )


@router.delete("/docs/{doc_id}/bindings/{binding_id}")
def revoke_binding(
    doc_id: str,
    binding_id: str,
    session: Session = Depends(get_session),
) -> dict[str, str]:
    if not session.get(KnowledgeDoc, doc_id):
        raise HTTPException(404, "doc not found")
    binding = session.get(KbBinding, binding_id)
    if not binding or binding.doc_id != doc_id:
        raise HTTPException(404, "binding not found")
    if binding.target_type == "swap_plan":
        target = session.get(SwapPlan, binding.target_id)
        if target:
            session.delete(target)
    elif binding.target_type == "artifact":
        target = session.get(Artifact, binding.target_id)
        if target:
            session.delete(target)
    session.delete(binding)
    session.commit()
    return {"status": "revoked"}


_REPORT_TYPES = {"dissect_params", "seven_steps", "core_hook_extract", "emotion_curve",
                 "cool_point_map", "hook_map", "style_extract", "redline", "gap_report", "unit_cut"}


class SavedReportIn(APIModel):
    run_id: str
    project_id: str
    title: str
    body_markdown: str


def _save_report(session, doc_id, report_type, body):
    run = session.get(AgentRun, body.run_id)
    source = run.input_json if run else {}
    if (not run or run.project_id != body.project_id or run.agent_id != "kb.report_pipeline"
            or (source.get("doc_id") or source.get("sourceDocId")) != doc_id):
        raise HTTPException(409, "report run/project/document mismatch")
    markdown = body.body_markdown.strip()
    if (report_type not in _REPORT_TYPES or not body.title.strip() or len(markdown) < 40
            or re.search(r"分析任务已入队|请稍后刷新|\[待(?:补充|填写)\]|\b(?:placeholder|TODO)\b", markdown, re.I)):
        raise HTTPException(422, "invalid report type, title or report content")
    identity = str(uuid.uuid5(uuid.NAMESPACE_URL, f"kb-report/{run.id}/{doc_id}/{report_type}"))
    def existing():
        row = session.get(AnalysisReport, identity)
        if row and (row.body_markdown != markdown or row.title != body.title.strip()):
            raise HTTPException(409, "run already saved different report content")
        return row
    row = existing()
    if row:
        return row
    art = Artifact(project_id=run.project_id, type="analysis_report", status="candidate",
                   created_by_run_id=run.id, title=body.title.strip(), body_markdown=markdown,
                   body_json={"reportId": identity, "docId": doc_id, "reportType": report_type})
    row = AnalysisReport(id=identity, doc_id=doc_id, report_type=report_type, title=art.title,
                         body_markdown=markdown, body_json={"status":"completed", "runId":run.id,
                         "artifactId":art.id, "projectId":run.project_id,
                         "contentHash":hashlib.sha256(markdown.encode()).hexdigest()})
    session.add_all([row, art, ArtifactVersion(artifact_id=art.id, version=1, title=art.title,
                     status=art.status, body_markdown=markdown, body_json=art.body_json, actor="agent:"+run.agent_id)])
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        saved = existing()
        if not saved:
            raise
        return saved
    session.refresh(row)
    return row


@router.post("/docs/{doc_id}/reports/{report_type}", response_model=AnalysisReportOut)
def generate_report(
    doc_id: str,
    report_type: str,
    session: Session = Depends(get_session),
    body: SavedReportIn | None = None,
) -> AnalysisReport:
    """Enqueue single-report regeneration via analyze job (typed)."""
    doc = session.get(KnowledgeDoc, doc_id)
    if not doc:
        raise HTTPException(404, "doc not found")
    if body is not None:
        return _save_report(session, doc_id, report_type, body)
    job = Job(
        type="kb.analyze",
        payload={"docId": doc_id, "reportType": report_type},
        user_id=_user(),
        status="queued",
    )
    session.add(job)
    session.commit()
    session.refresh(job)
    enqueue_job(job.id, {"type": job.type, "payload": job.payload})
    # return placeholder until worker finishes — clients should poll reports
    existing = session.exec(
        select(AnalysisReport).where(
            AnalysisReport.doc_id == doc_id,
            AnalysisReport.report_type == report_type,
        )
    ).first()
    if existing:
        return existing
    row = AnalysisReport(
        doc_id=doc_id,
        report_type=report_type,
        title=report_type,
        body_markdown="（分析任务已入队，请稍后刷新）",
        body_json={"jobId": job.id, "pending": True},
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row
