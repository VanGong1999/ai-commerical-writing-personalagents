"""kb_retrieval 检索层测试：编码容错 / 分词 / 章节切分 / 索引与混合检索 / 单字兜底 / API。"""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest
from sqlmodel import Session, select
from starlette.testclient import TestClient

from app.db import engine, init_db
from app.main import app
from app.models import KnowledgeDoc, new_id
import kb_retrieval as kr

client = TestClient(app)


@pytest.fixture(scope="module", autouse=True)
def _setup_db():
    init_db()
    yield


def _add_doc(title: str, text: str, *, doc_type: str = "novel", author: str | None = None) -> KnowledgeDoc:
    doc = KnowledgeDoc(
        id=new_id(),
        title=title,
        doc_type=doc_type,
        author=author,
        tags=["测试"],
        word_count=len(text),
        user_id="u1",
    )
    with Session(engine) as s:
        s.add(doc)
        s.commit()
        s.refresh(doc)
    kr.index_document(doc.id, title, text)
    return doc


def test_read_text_robust_gbk():
    raw = "《镇魂》作者：priest\n第一章 引子\n赵云澜是特别调查处处长。\n"
    with tempfile.NamedTemporaryFile(suffix=".txt", delete=False) as f:
        f.write(raw.encode("gb18030"))
        path = f.name
    try:
        text = kr.read_text_robust(path)
        assert "镇魂" in text and "赵云澜" in text
    finally:
        Path(path).unlink(missing_ok=True)


def test_tokenizers_symmetric():
    idx = kr.index_tokens("退婚打脸")
    assert "退婚" in idx and "打脸" in idx
    # 查询侧 bigram 与写入侧一致
    assert kr.query_tokens("退婚") == ["退婚"]
    assert kr.query_tokens("爽") == ["爽"]
    # ASCII 单词整体保留，不做 bigram
    assert "pubg" in kr.index_tokens("PUBG世纪网恋")
    assert kr.query_tokens("PUBG") == ["pubg"]


def test_split_query_terms():
    assert kr.split_query_terms("系统文 + 末世、开篇") == ["系统文", "末世", "开篇"]


def test_segment_text_chapters():
    text = "".join(f"第{i}章 标题{i}\n正文内容{i}\n" for i in range(1, 6))
    segs = kr.segment_text(text)
    assert len(segs) == 5
    assert segs[0][0].startswith("第1章")


def test_index_and_search_hybrid():
    doc = _add_doc(
        "《镇魂》",
        "第1章 引子\n赵云澜是特别调查处处长。\n第2章 相遇\n沈巍是大学教授，与赵云澜相遇。退婚打脸桥段在此展开。\n",
        author="priest",
    )
    with Session(engine) as s:
        hits = kr.search_documents(s, "退婚打脸", limit=5)
        assert hits
        assert hits[0]["docId"] == doc.id
        assert hits[0]["title"] == "《镇魂》"
        assert hits[0]["snippets"]
        # 命中片段应含关键词
        assert any("退婚打脸" in sn["text"] for sn in hits[0]["snippets"])


def test_single_char_fallback():
    _add_doc("爽文", "第1章\n这本书很爽，主角一路碾压。\n")
    with Session(engine) as s:
        hits = kr.search_documents(s, "碾压", limit=5)
        assert hits
        assert hits[0]["title"] == "爽文"


def test_delete_index():
    doc = _add_doc("待删", "第1章\n独一无二的词组甲壳虫乐队。\n")
    kr.delete_document_index(doc.id)
    with Session(engine) as s:
        hits = kr.search_documents(s, "甲壳虫", limit=5)
        assert all(h["docId"] != doc.id for h in hits)


def test_search_api_shape():
    _add_doc("API检索", "第1章\n赵云澜特别调查处关键词命中测试。\n")
    res = client.get("/api/v1/kb/search", params={"q": "特别调查处"})
    assert res.status_code == 200
    body = res.json()
    assert "docs" in body and "local" in body and "answer" in body
    assert "matches" in body


def test_uploaded_text_character_pages_preserve_legacy_full_read():
    text = "第一章\n" + "他转过身，推开门。" * 2000
    doc = _add_doc("分页原文", text)
    with Session(engine) as s:
        row = s.get(KnowledgeDoc, doc.id)
        row.storage_uri = "inline:" + text
        s.add(row)
        s.commit()
    url = f"/api/v1/kb/docs/{doc.id}/text"
    first = client.get(url, params={"limit": 100}).json()
    assert first["text"] == text[:100]
    assert first["nextOffset"] == 100
    assert first["totalChars"] == len(text)
    second = client.get(url, params={"offset": 100, "limit": 100}).json()
    assert second["text"] == text[100:200]
    last = client.get(url, params={"offset": len(text) - 5, "limit": 100}).json()
    assert last["text"] == text[-5:] and last["nextOffset"] is None
    assert client.get(url).json()["text"] == text
    assert client.get(url, params={"limit": 12001}).status_code == 422
