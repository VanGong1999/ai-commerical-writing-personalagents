import hashlib

import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine
from starlette.testclient import TestClient

from app import vfs
from app.db import get_session
from app.main import app, api


@pytest.fixture
def mounted(tmp_path):
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    root = tmp_path / 'writing'
    root.mkdir()
    (root / 'chapter.md').write_text('第一段\n第二段\n', encoding='utf-8')
    def sessions():
        with Session(engine) as session:
            yield session
    api.dependency_overrides[get_session] = sessions
    try:
        yield TestClient(app), engine, root
    finally:
        api.dependency_overrides.pop(get_session, None)
        engine.dispose()


def add_mount(client, root, **extra):
    result = client.post('/api/v1/fs/mounts', json={'name': 'drafts', 'root': str(root), **extra})
    assert result.status_code == 200, result.text
    return result.json()


def test_mount_is_persistent_discoverable_and_readonly_by_default(mounted):
    client, engine, root = mounted
    assert add_mount(client, root)['readOnly'] is True
    assert client.get('/api/v1/fs/mounts').json()['mounts'][0]['name'] == 'drafts'
    with Session(engine) as session:
        assert any(e['path'] == '/files' for e in vfs.ls(session, '/'))
        assert vfs.ls(session, '/files')[0]['path'] == '/files/drafts'
        data = vfs.read(session, '/files/drafts/chapter.md')
        assert data['hash'] == hashlib.sha256('第一段\n第二段\n'.encode()).hexdigest()
        assert data['readOnly'] is True
        assert vfs.find(session, '/files', glob_pat='*.md') == ['/files/drafts/chapter.md']
        assert vfs.grep(session, '第二段', '/files')[0]['line'] == 2
        with pytest.raises(vfs.VfsError) as error:
            vfs.write(session, '/files/drafts/chapter.md', '改稿', expected_hash=data['hash'])
        assert error.value.code == 'readonly'
    assert client.delete('/api/v1/fs/mounts/drafts').status_code == 200
    assert client.get('/api/v1/fs/read', params={'path': '/files/drafts/chapter.md'}).status_code == 404


def test_mount_hides_credentials_binary_hidden_files_and_symlink_escapes(mounted, tmp_path):
    client, engine, root = mounted
    outside = tmp_path / 'outside'
    outside.mkdir()
    (outside / 'escape.md').write_text('private')
    (root / 'linked').symlink_to(outside, target_is_directory=True)
    (root / 'alias.md').symlink_to(outside / 'escape.md')
    (root / '.hidden.md').write_text('hidden')
    (root / 'credentials.json').write_text('{"password":"private"}')
    (root / 'image.png').write_bytes(b'PNG')
    (root / 'binary.txt').write_bytes(b'hello\x00world')
    add_mount(client, root)
    with Session(engine) as session:
        assert [e['name'] for e in vfs.ls(session, '/files/drafts')] == ['chapter.md']
        assert vfs.find(session, '/files') == ['/files/drafts/chapter.md']
        for path in ('../outside/escape.md', 'linked/escape.md', 'alias.md', '.hidden.md', 'credentials.json', 'binary.txt', 'image.png'):
            with pytest.raises(vfs.VfsError):
                vfs.read(session, '/files/drafts/' + path)


def test_writable_mount_requires_hash_and_preserves_exact_newlines_and_versions(mounted):
    client, engine, root = mounted
    add_mount(client, root, readOnly=False)
    with Session(engine) as session:
        data = vfs.read(session, '/files/drafts/chapter.md')
        for expected in (None, 'wrong'):
            with pytest.raises(vfs.VfsError) as conflict:
                vfs.write(session, '/files/drafts/chapter.md', 'bad', expected_hash=expected)
            assert conflict.value.code == 'conflict'
        updated = vfs.edit(session, '/files/drafts/chapter.md', '第一段', '修改段', expected_hash=data['hash'], allow_memories_only=True)
        assert (root / 'chapter.md').read_text() == '修改段\n第二段\n'
        assert updated['hash'] != data['hash']
    history = client.get('/api/v1/fs/versions', params={'path': '/files/drafts/chapter.md'}).json()['versions']
    assert len(history) == 1
    restored = client.post('/api/v1/fs/restore', json={'path':'/files/drafts/chapter.md','versionId':history[0]['id'],'expectedHash':updated['hash']})
    assert restored.status_code == 200, restored.text
    assert (root / 'chapter.md').read_text() == '第一段\n第二段\n'
    conflict = client.post('/api/v1/fs/restore', json={'path':'/files/drafts/chapter.md','versionId':history[0]['id'],'expectedHash':updated['hash']})
    assert conflict.status_code == 409


def test_new_files_are_exclusive_and_outside_changes_cannot_be_overwritten(mounted):
    client, engine, root = mounted
    add_mount(client, root, readOnly=False)
    with Session(engine) as session:
        created = vfs.write(session, '/files/drafts/new.txt', 'new', expected_hash='')
        assert created['hash']
        with pytest.raises(vfs.VfsError):
            vfs.write(session, '/files/drafts/new.txt', 'clobber', expected_hash='')
        (root / 'new.txt').write_text('external change')
        with pytest.raises(vfs.VfsError):
            vfs.write(session, '/files/drafts/new.txt', 'clobber', expected_hash=created['hash'])
        assert (root / 'new.txt').read_text() == 'external change'


def test_text_reads_are_bounded_and_directory_replacement_cannot_escape(mounted, tmp_path):
    client, engine, root = mounted
    (root / 'huge.md').write_bytes(b'x' * (1024 * 1024 + 1))
    add_mount(client, root, readOnly=False)
    with Session(engine) as session:
        with pytest.raises(vfs.VfsError):
            vfs.read(session, '/files/drafts/huge.md')
        root.rename(tmp_path / 'old-root')
        root.symlink_to(tmp_path / 'old-root', target_is_directory=True)
        with pytest.raises(vfs.VfsError):
            vfs.write(session, '/files/drafts/new.md', 'bad', expected_hash='')


def test_new_file_created_during_write_is_not_replaced(mounted, monkeypatch):
    import os
    from app import directory_mounts
    client, engine, root = mounted
    add_mount(client, root, readOnly=False)
    original_link = os.link
    def competing_create(src, dst, **kwargs):
        fd = os.open(dst, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600, dir_fd=kwargs['dst_dir_fd'])
        with os.fdopen(fd, 'wb') as stream:
            stream.write(b'external content')
        return original_link(src, dst, **kwargs)
    monkeypatch.setattr(directory_mounts.os, 'link', competing_create)
    with Session(engine) as session:
        with pytest.raises(vfs.VfsError) as conflict:
            vfs.write(session, '/files/drafts/race.md', 'candidate', expected_hash='')
        assert conflict.value.code == 'conflict'
    assert (root / 'race.md').read_text() == 'external content'
    assert not list(root.glob('.xzm-*'))


def test_crlf_offsets_match_browser_but_hash_and_history_preserve_original_bytes(mounted):
    from app import directory_mounts
    client, engine, root = mounted
    original = b'first\r\nsecond\r\n'
    (root / 'windows.txt').write_bytes(original)
    add_mount(client, root, readOnly=False)
    with Session(engine) as session:
        read = vfs.read(session, '/files/drafts/windows.txt')
        assert read['raw'] == 'first\nsecond\n'
        assert directory_mounts.read_source(session, '/files/drafts/windows.txt') == read['raw']
        assert read['hash'] == hashlib.sha256(original).hexdigest()
        assert read['contentHash'] == hashlib.sha256(b'first\nsecond\n').hexdigest()
        changed = vfs.edit(session, '/files/drafts/windows.txt', 'first', 'changed', expected_hash=read['hash'])
        history = directory_mounts.versions(session, '/files/drafts/windows.txt')
        directory_mounts.restore(session, '/files/drafts/windows.txt', history[0]['id'], changed['hash'])
        assert (root / 'windows.txt').read_bytes() == original


def test_personal_agent_reads_hash_and_writes_explicit_writable_mount(mounted):
    import asyncio
    from app.models import Conversation
    from app.routers.personal_agent import _execute_supervisor_tool
    client, engine, root = mounted
    add_mount(client, root, readOnly=False)
    with Session(engine) as session:
        conv = Conversation(user_id='test')
        text, detail = asyncio.run(_execute_supervisor_tool('read', {'path':'/files/drafts/chapter.md'}, session, conv))
        assert detail['hash'] in text
        assert 'readOnly=false' in text
        text, _ = asyncio.run(_execute_supervisor_tool('write', {'path':'/files/drafts/chapter.md','content':'已修改','expected_hash':detail['hash']}, session, conv))
        assert '失败' not in text
        assert (root / 'chapter.md').read_text() == '已修改'


def test_mount_fails_clearly_when_secure_platform_features_unavailable(mounted, monkeypatch):
    from app import directory_mounts
    client, _, root = mounted
    monkeypatch.delattr(directory_mounts.os, 'O_NOFOLLOW')
    response = client.post('/api/v1/fs/mounts', json={'name':'drafts','root':str(root)})
    assert response.status_code == 400
    assert '当前平台不支持' in response.json()['detail']

def test_history_preview_is_bound_to_mounted_file(mounted):
    client, _, root = mounted
    add_mount(client,root,readOnly=False)
    path='/files/drafts/chapter.md'
    original=client.get('/api/v1/fs/read',params={'path':path}).json()
    changed=client.put('/api/v1/fs/write',json={'path':path,'content':'新版本','expected_hash':original['hash']}).json()
    version=changed['versionId']
    preview=client.get(f'/api/v1/fs/versions/{version}',params={'path':path})
    assert preview.status_code == 200
    assert preview.json()['content']=='第一段\n第二段\n'
    assert client.get(f'/api/v1/fs/versions/{version}',params={'path':'/files/drafts/other.md'}).status_code==404
