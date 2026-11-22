from pathlib import Path

import pytest
from fastapi import HTTPException

from app.models import KnowledgeDoc
from app import source_paths
from app.routers.kb import _doc_text


def test_exact_legacy_relocation_is_read_only_and_lossless(tmp_path, monkeypatch):
    monkeypatch.setattr(source_paths, 'REPO_ROOT', tmp_path)
    old = tmp_path / '绿江合集' / '剧本' / '长公主.txt'
    moved = tmp_path / 'others' / old.relative_to(tmp_path)
    moved.parent.mkdir(parents=True)
    text = '第一集\n完整原文，结尾也保留。'
    moved.write_text(text, encoding='utf-8')
    doc = KnowledgeDoc(title='旧路径', storage_uri=str(old), user_id='test')
    assert source_paths.resolve_source_path(old) == moved
    assert _doc_text(doc) == text
    assert doc.storage_uri == str(old) and not old.exists()


def test_missing_source_is_explicit_404(tmp_path, monkeypatch):
    monkeypatch.setattr(source_paths, 'REPO_ROOT', tmp_path)
    with pytest.raises(FileNotFoundError):
        source_paths.resolve_source_path(tmp_path / 'missing.txt')
    doc = KnowledgeDoc(title='缺失', storage_uri=str(tmp_path / 'missing.txt'), user_id='test')
    with pytest.raises(HTTPException) as error:
        _doc_text(doc)
    assert error.value.status_code == 404


@pytest.mark.parametrize('mode', ['absolute', 'symlink'])
def test_unrelated_external_path_is_never_relocated(tmp_path, monkeypatch, mode):
    root = tmp_path / 'repo'; root.mkdir()
    monkeypatch.setattr(source_paths, 'REPO_ROOT', root)
    outside = tmp_path / 'unrelated.txt'
    requested = outside
    if mode == 'symlink':
        requested = root / 'original' / 'source.txt'
        moved = root / 'others' / 'original' / 'source.txt'
        moved.parent.mkdir(parents=True)
        outside.write_text('外部文件')
        moved.symlink_to(outside)
    with pytest.raises(ValueError):
        source_paths.resolve_source_path(requested)


@pytest.mark.parametrize('kind', ['empty', 'corrupt_docx', 'binary', 'truncated_inline'])
def test_invalid_source_is_explicit_422(tmp_path, monkeypatch, kind):
    monkeypatch.setattr(source_paths, 'REPO_ROOT', tmp_path)
    p = tmp_path / ('bad.docx' if kind == 'corrupt_docx' else 'bad.txt')
    p.write_bytes(b'' if kind == 'empty' else b'not zip' if kind == 'corrupt_docx' else b'\x00\x01\x02')
    doc = KnowledgeDoc(title='无效', storage_uri=str(p), user_id='test')
    if kind == 'truncated_inline':
        doc.storage_uri='inline:短正文'; doc.word_count=100
    with pytest.raises(HTTPException) as error:
        _doc_text(doc)
    assert error.value.status_code == 422


def test_existing_trusted_external_source_remains_readable(tmp_path, monkeypatch):
    root = tmp_path / 'repo'; root.mkdir()
    monkeypatch.setattr(source_paths, 'REPO_ROOT', root)
    original = tmp_path / 'trusted-upload.txt'; original.write_text('原有合法上传', encoding='utf-8')
    assert source_paths.read_source_text(original) == '原有合法上传'
