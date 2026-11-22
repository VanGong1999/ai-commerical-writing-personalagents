"""Lossless local KB ingest and honest excerpt provenance; no external services."""
from __future__ import annotations

import asyncio
import hashlib
import importlib
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlmodel import Session, SQLModel, create_engine, select
from app.models import AnalysisReport, Job, KnowledgeDoc


@pytest.fixture
def pipeline(monkeypatch, tmp_path):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2] / "job-worker"))
    module = importlib.import_module("kb_pipeline")
    monkeypatch.setattr(importlib.import_module("app.source_paths"), "REPO_ROOT", tmp_path)
    monkeypatch.setattr(module, "UPLOAD_DIR", tmp_path / "uploads", raising=False)
    monkeypatch.setattr(module, "publish_job_event", lambda *_args: None)
    monkeypatch.setattr(module, "is_cancelled", lambda _id: False)
    monkeypatch.setattr(importlib.import_module("worker_handlers"), "publish_job_event", lambda *_args: None)
    monkeypatch.setattr(module, "get_settings", lambda: SimpleNamespace(minio_bucket="test"))
    async def vector(*_args):
        return None
    def unavailable(*_args, **_kwargs):
        raise OSError("storage unavailable")
    monkeypatch.setitem(sys.modules, "minio_store", SimpleNamespace(upload_bytes=unavailable))
    monkeypatch.setitem(sys.modules, "vector_store", SimpleNamespace(upsert_chunks=vector))
    monkeypatch.setitem(sys.modules, "knowledge_vector", SimpleNamespace(local_embed=lambda *_args, **_kwargs: [[0.0]]))
    async def chat(*_args, **_kwargs):
        return SimpleNamespace(content='{"markdown":"只分析可见摘录","tags":[],"nodes":[],"edges":[],"tropes":[]}')
    monkeypatch.setattr(module, "chat_completion", chat)
    monkeypatch.setattr(module, "index_document", lambda *_args: {"segments": 1})
    monkeypatch.setattr(module, "_load_agent_skill_body", lambda *_args: "")
    monkeypatch.setattr(module, "REPORT_TYPES", [("dissect_params", "测试报告")])
    engine = create_engine(f"sqlite:///{tmp_path / 'kb.db'}")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield module, session
    engine.dispose()


def doc_job(session, uri):
    doc = KnowledgeDoc(title="完整长篇", doc_type="novel", storage_uri=uri, user_id="test", status="processing")
    session.add(doc)
    session.commit()
    job = Job(type="kb.ingest", payload={"docId": doc.id}, user_id="test")
    session.add(job)
    session.commit()
    return doc, job


def test_minio_outage_preserves_full_source_and_original_upload(pipeline, tmp_path, monkeypatch):
    module, session = pipeline
    text = "第一章 开始\n" + "中文小说" * 60000 + "\n最后一章 不可丢失的尾部"
    original = tmp_path / "original.txt"
    original.write_text(text, encoding="utf-8")
    indexed = []
    monkeypatch.setattr(module, "index_document", lambda _id, _title, source: indexed.append(source) or {"segments": 1})
    doc, job = doc_job(session, str(original))
    asyncio.run(module.ingest_document(session, doc, job))
    assert not doc.storage_uri.startswith("inline:")
    stored = Path(doc.storage_uri.removeprefix("file://"))
    assert stored.is_relative_to(module.UPLOAD_DIR)
    assert stored.read_text(encoding="utf-8") == text
    assert original.read_text(encoding="utf-8") == text
    assert module._extract_text_from_storage(doc) == text
    assert indexed == [text]
    assert doc.word_count == len(text)
    assert doc.hash == hashlib.sha256(text.encode()).hexdigest()


@pytest.mark.parametrize("source", ["missing.txt", "empty.txt", "broken.docx"])
def test_missing_empty_or_unparseable_source_fails_instead_of_using_title(pipeline, tmp_path, source):
    module, session = pipeline
    path = tmp_path / source
    if source == "empty.txt":
        path.write_text("")
    elif source == "broken.docx":
        path.write_bytes(b"not a zip document")
    doc, job = doc_job(session, str(path))
    handlers = importlib.import_module("worker_handlers")
    with pytest.raises((ValueError, OSError, RuntimeError)):
        asyncio.run(handlers.handle_kb_ingest(session, job))
    session.refresh(doc)
    assert doc.status == "failed"


def test_legacy_inline_truncation_is_detected_not_claimed_recovered(pipeline):
    module, session = pipeline
    doc, _job = doc_job(session, "inline:" + "中" * 200000)
    doc.word_count = 350000
    with pytest.raises(ValueError, match="截断|重新上传"):
        module._extract_text_from_storage(doc)


def test_analysis_records_actual_excerpt_coverage_and_provenance(pipeline):
    module, session = pipeline
    text = "第一章 起点\n" + "中" * 13000 + "\n第二章 未分析部分\n" + "尾" * 2000
    doc, job = doc_job(session, "inline:" + text)
    asyncio.run(module.analyze_document(session, doc, job))
    report = session.exec(select(AnalysisReport).where(AnalysisReport.doc_id == doc.id)).one()
    coverage = report.body_json["coverage"]
    assert coverage["complete"] is False
    assert coverage["sourceChars"] == len(text)
    assert coverage["endChar"] == 12000
    assert coverage["sourceSha256"] == hashlib.sha256(text.encode()).hexdigest()
    assert "第二章" not in " ".join(coverage["chapterHeadings"])
    assert "摘录" in report.body_markdown and "12000" in report.body_markdown
    assert report.source_fragments[0]["endChar"] == 12000


def test_analysis_failure_propagates_instead_of_publishing_success_report(pipeline, monkeypatch):
    module, session = pipeline
    doc, job = doc_job(session, "inline:真实原文")
    async def fail(*_args, **_kwargs):
        raise RuntimeError("provider unavailable")
    monkeypatch.setattr(module, "chat_completion", fail)
    with pytest.raises(RuntimeError, match="provider unavailable"):
        asyncio.run(module.analyze_document(session, doc, job))
    assert session.exec(select(AnalysisReport).where(AnalysisReport.doc_id == doc.id)).first() is None


def test_preface_is_fully_indexed_before_chapter_boundaries():
    import kb_retrieval
    preface = "序言资料" * 1200 + "不可截断序言尾部"
    source = preface + "\n第一章 开始\n甲\n第二章 中段\n乙\n第三章 结尾\n丙"
    segments = kb_retrieval.segment_text(source)
    assert segments[0][1] == preface
    assert "不可截断序言尾部" in "\n".join(body for _locator, body in segments)


def test_full_analysis_covers_all_fragments_with_bounded_requests_and_retry_cache(pipeline, monkeypatch):
    module, session = pipeline
    source = "第一章 开始\n" + "首" * 9000 + "\n第二章 中段\n" + "中" * 9000 + "\n第三章 结尾\n" + "尾" * 9000
    doc, job = doc_job(session, "inline:" + source)
    job.payload = {"docId": doc.id, "analysisScope": "full"}
    monkeypatch.setattr(module, "resolve_default_model", lambda: "test-model", raising=False)
    calls = []
    async def chat(messages, **_kwargs):
        calls.append(messages)
        return SimpleNamespace(content='{"summary":"' + "仅概括给定片段，不推断未知内容。" * 150 + '","markdown":"基于分段摘要综合","nodes":[],"edges":[],"tropes":[]}')
    monkeypatch.setattr(module, "chat_completion", chat)
    asyncio.run(module.analyze_document(session, doc, job))
    fragments = list(session.exec(select(AnalysisReport).where(AnalysisReport.doc_id == doc.id, AnalysisReport.report_type == "chapter_digest")))
    assert len(fragments) >= 3
    leaf = sorted((r for r in fragments if r.body_json["kind"] == "source_fragment"), key=lambda r: r.source_fragments[0]["startChar"])
    ranges = [r.source_fragments[0] for r in leaf]
    assert ranges[0]["startChar"] == 0 and ranges[-1]["endChar"] == len(source)
    assert all(a["endChar"] == b["startChar"] for a, b in zip(ranges, ranges[1:]))
    assert max(len(m[1]["content"]) for m in calls) < 14000
    report = session.exec(select(AnalysisReport).where(AnalysisReport.doc_id == doc.id, AnalysisReport.report_type == "dissect_params")).one()
    assert report.body_json["coverage"]["complete"] is True
    assert report.body_json["coverage"]["mode"] == "hierarchical_digest"
    assert len(report.source_fragments) == len(leaf)
    assert "分段摘要" in report.body_markdown
    calls.clear()
    asyncio.run(module.analyze_document(session, doc, job))
    assert len(calls) == 3  # final report + graph + tropes, no repeated source digests


def test_full_analysis_reuses_completed_digests_after_midway_failure(pipeline, monkeypatch):
    module, session = pipeline
    doc, job = doc_job(session, "inline:" + "中" * 18000)
    job.payload = {"docId": doc.id, "analysis_scope": "full"}
    monkeypatch.setattr(module, "resolve_default_model", lambda: "test-model", raising=False)
    requests = []
    async def fail_second(messages, **_kwargs):
        requests.append(messages)
        if len(requests) == 2:
            raise RuntimeError("midway interruption")
        return SimpleNamespace(content='{"summary":"' + "片段可核对摘要。" * 30 + '"}')
    monkeypatch.setattr(module, "chat_completion", fail_second)
    with pytest.raises(RuntimeError, match="midway interruption"):
        asyncio.run(module.analyze_document(session, doc, job))
    saved = list(session.exec(select(AnalysisReport).where(AnalysisReport.report_type == "chapter_digest")))
    assert len(saved) == 1
    assert saved[0].source_fragments[0]["startChar"] == 0
    resumed_requests = []
    async def resume(messages, **_kwargs):
        resumed_requests.append(messages)
        return SimpleNamespace(content='{"summary":"' + "可核对片段摘要。" * 30 + '","nodes":[],"edges":[],"tropes":[]}')
    monkeypatch.setattr(module, "chat_completion", resume)
    asyncio.run(module.analyze_document(session, doc, job))
    assert len(resumed_requests) == 5  # two missing leaves + report/graph/tropes
    assert not any("范围/层级：原文字符[0,8000)" in message[1]["content"] for message in resumed_requests)
    assert len(list(session.exec(select(AnalysisReport).where(AnalysisReport.report_type == "chapter_digest")))) == 3


def test_analyze_api_keeps_sample_default_and_validates_explicit_full(pipeline, monkeypatch):
    _module, session = pipeline
    from fastapi import FastAPI
    from app.db import get_session
    from app.routers import kb
    from starlette.testclient import TestClient
    app = FastAPI()
    app.include_router(kb.router, prefix="/api/v1")
    monkeypatch.setattr(kb, "enqueue_job", lambda *_args: None)
    monkeypatch.setattr(kb, "publish_job_event", lambda *_args: None)
    doc, _job = doc_job(session, "inline:原文")
    doc.word_count = 27000
    session.commit()
    def override_session():
        yield session
    app.dependency_overrides[get_session] = override_session
    try:
        client = TestClient(app)
        default = client.post(f"/api/v1/kb/docs/{doc.id}/analyze")
        assert default.status_code == 200
        assert default.json()["analysisScope"] == "sample"
        full = client.post(f"/api/v1/kb/docs/{doc.id}/analyze", json={"analysisScope": "full"})
        assert full.status_code == 200
        assert full.json()["sourceChars"] == 27000
        assert full.json()["estimatedChunks"] == 4
        saved = session.get(Job, full.json()["jobId"])
        assert saved.payload["analysisScope"] == "full"
        assert client.post(f"/api/v1/kb/docs/{doc.id}/analyze", json={"analysisScope": "bogus"}).status_code == 422
    finally:
        app.dependency_overrides.pop(get_session, None)


def test_full_analysis_cancellation_stops_next_call_keeps_digest_and_marks_cancelled(pipeline, monkeypatch):
    module, session = pipeline
    worker_path = Path(__file__).resolve().parents[2] / "job-worker" / "main.py"
    spec = importlib.util.spec_from_file_location("kb_integrity_worker_main", worker_path)
    worker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(worker)
    cancelled = {"value": False}
    monkeypatch.setattr(worker, "engine", session.get_bind())
    monkeypatch.setattr(worker, "publish_job_event", lambda *_args: None)
    monkeypatch.setattr(worker, "is_cancelled", lambda _id: cancelled["value"])
    monkeypatch.setattr(module, "is_cancelled", lambda _id: cancelled["value"], raising=False)
    monkeypatch.setattr(module, "resolve_default_model", lambda: "test-model")
    doc, job = doc_job(session, "inline:" + "中" * 18000)
    job.type = "kb.analyze"
    job.payload = {"docId": doc.id, "analysisScope": "full"}
    session.commit()
    calls = []
    async def first_then_cancel(messages, **_kwargs):
        calls.append(messages)
        cancelled["value"] = True
        return SimpleNamespace(content='{"summary":"' + "已完成片段摘要。" * 30 + '"}')
    monkeypatch.setattr(module, "chat_completion", first_then_cancel)
    asyncio.run(worker.process_one(job.id, {}))
    session.expire_all()
    assert session.get(Job, job.id).status == "cancelled"
    assert session.get(KnowledgeDoc, doc.id).status == "ready"
    assert len(calls) == 1
    assert len(list(session.exec(select(AnalysisReport).where(AnalysisReport.report_type == "chapter_digest")))) == 1
    cancelled["value"] = False
    resumed = Job(type="kb.analyze", payload={"docId": doc.id, "analysisScope": "full"}, user_id="test")
    session.add(resumed)
    session.commit()
    async def success(messages, **_kwargs):
        calls.append(messages)
        return SimpleNamespace(content='{"summary":"' + "可复用的分段摘要。" * 30 + '","nodes":[],"edges":[],"tropes":[]}')
    monkeypatch.setattr(module, "chat_completion", success)
    asyncio.run(worker.process_one(resumed.id, {}))
    session.expire_all()
    assert session.get(Job, resumed.id).status == "succeeded"
    assert len(calls) == 6  # cancelled first + only two missing fragments + final three calls


def test_kb_real_usage_is_durable_even_if_json_is_truncated(pipeline, monkeypatch):
    from app.models import UsageEvent
    module, session = pipeline
    doc, job = doc_job(session, 'inline:' + '正文' * 4500)
    job.payload = {'docId': doc.id, 'analysisScope': 'full'}
    monkeypatch.setattr(module, 'resolve_default_model', lambda: 'MiniMax-M3.1-Flash')
    async def truncated(*args, **kwargs):
        return SimpleNamespace(content='{"summary":"第1集：长公主李云贞', model='MiniMax-M3.1-Flash',
            prompt_tokens=123, completion_tokens=3000, cache_hit_tokens=20, cache_miss_tokens=103,
            raw={'choices': [{'finish_reason': 'length'}]})
    monkeypatch.setattr(module, 'chat_completion', truncated)
    with pytest.raises(ValueError, match='截断|JSON'):
        asyncio.run(module.analyze_document(session, doc, job))
    assert not list(session.exec(select(AnalysisReport)))
    usage = session.exec(select(UsageEvent)).one()
    assert (usage.prompt_tokens, usage.completion_tokens, usage.cache_hit_tokens, usage.cache_miss_tokens) == (123, 3000, 20, 103)
    assert usage.run_id == job.id and usage.agent_id == 'kb.digest'
    assert usage.duration_ms >= 0


def test_kb_digest_cache_does_not_bill_again(pipeline, monkeypatch):
    from app.models import UsageEvent
    module, session = pipeline
    doc, job = doc_job(session, 'inline:' + '正文' * 4500)
    monkeypatch.setattr(module, 'resolve_default_model', lambda: 'MiniMax-M3.1-Flash')
    async def answer(*args, **kwargs):
        return SimpleNamespace(content='{"summary":"' + '可核对的完整分段摘要。' * 20 + '"}',
            model='MiniMax-M3.1-Flash', prompt_tokens=123, completion_tokens=456, raw={})
    monkeypatch.setattr(module, 'chat_completion', answer)
    asyncio.run(module._full_analysis_context(session, doc, job, '正文' * 4500))
    assert len(list(session.exec(select(UsageEvent)))) == 2
    asyncio.run(module._full_analysis_context(session, doc, job, '正文' * 4500))
    assert len(list(session.exec(select(UsageEvent)))) == 2


def test_full_report_rejects_malformed_json_after_cached_digest(pipeline, monkeypatch):
    module, session = pipeline
    doc, job = doc_job(session, 'inline:' + '正文' * 100)
    job.payload = {'docId': doc.id, 'analysisScope': 'full'}
    monkeypatch.setattr(module, 'resolve_default_model', lambda: 'test-model')
    async def answer(messages, **kwargs):
        if '范围/层级' in messages[1]['content']:
            return SimpleNamespace(content='{"summary":"' + '可核对的完整分段摘要。' * 20 + '"}')
        return SimpleNamespace(content='{"summary":"报告被截断')
    monkeypatch.setattr(module, 'chat_completion', answer)
    with pytest.raises(ValueError, match='JSON'):
        asyncio.run(module.analyze_document(session, doc, job))
    assert [r.report_type for r in session.exec(select(AnalysisReport))] == ['chapter_digest']


def test_job_worker_recovery_never_interrupts_active_agent_jobs(pipeline):
    module, session = pipeline
    worker = importlib.import_module('main')
    agent = Job(type='agent.run', user_id='test', status='running')
    kb = Job(type='kb.analyze', user_id='test', status='running')
    session.add_all([agent, kb]); session.commit()
    worker.recover_orphaned_jobs(session)
    session.refresh(agent); session.refresh(kb)
    assert agent.status == 'running' and agent.error is None
    assert kb.status == 'failed'


def test_minimax_kb_bounds_reasoning_budget(pipeline, monkeypatch):
    module, session = pipeline
    doc, job = doc_job(session, 'inline:正文')
    observed = []
    async def answer(*args, **kwargs):
        observed.append(kwargs)
        return SimpleNamespace(content='{"summary":"好"}', model='MiniMax-M3.1-Flash')
    monkeypatch.setattr(module, 'chat_completion', answer)
    asyncio.run(module._kb_chat(session, job, 'digest', [], model='MiniMax-M3.1-Flash'))
    assert observed[0]['extra_body']['reasoning_effort'] == 'low'


def test_worker_reads_exact_moved_source_without_rewriting_doc(pipeline, tmp_path):
    module, session = pipeline
    legacy = tmp_path / '绿江合集' / '完整剧本.txt'
    moved = tmp_path / 'others' / legacy.relative_to(tmp_path)
    moved.parent.mkdir(parents=True)
    text = '第一集\n可核对原文' * 100 + '\n最后一集完整结尾'
    moved.write_text(text, encoding='utf-8')
    doc, _ = doc_job(session, str(legacy))
    assert module._extract_text_from_storage(doc) == text
    assert doc.storage_uri == str(legacy)
