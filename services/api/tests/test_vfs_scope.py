import pytest
from sqlmodel import Session, SQLModel, create_engine
from sqlalchemy.pool import StaticPool
from app import vfs
from app.models import MemoryFile
from app.seed import DEMO_USER


def test_worker_scope_checks_before_read_and_scopes_recursive_traversal(monkeypatch):
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    own = '/memories/projects/p/procedural/me/lessons.md'
    shared = '/memories/projects/p/bible/world.md'
    foreign = '/memories/projects/p2/bible/secret.md'
    other = '/memories/projects/p/procedural/other/lessons.md'
    with Session(engine) as session:
        for path in [own, shared, foreign, other]:
            session.add(MemoryFile(path=path, user_id=DEMO_USER, content='needle '+path))
        session.commit()
        scope = dict(project_id='p', agent_id='me')
        for path in [foreign, other, '/workspace/private.md', '/runs', '/threads', '/inbox', '/memories/user/private.md', '/projects/p2']:
            for operation in [vfs.read, vfs.ls]:
                with pytest.raises(vfs.VfsError, match='scope'):
                    operation(session, path, **scope)
        original = vfs.read
        read_paths = []
        def watched(session, path, **kwargs):
            read_paths.append(path)
            assert path not in [foreign, other]
            return original(session, path, **kwargs)
        monkeypatch.setattr(vfs, 'read', watched)
        hits = vfs.grep(session, 'needle', '/projects/p', **scope)
        assert {hit['path'] for hit in hits} == {own, shared}
        found = vfs.find(session, '/projects/p', **scope)
        assert set(found) == {own, shared}
        from app.routers.fs import fs_read, fs_ls, fs_grep, fs_find, GrepIn, FindIn
        monkeypatch.setattr(vfs, 'read', original)
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as error:
            fs_read(foreign, session=session, **scope)
        assert error.value.status_code == 403
        monkeypatch.setattr(vfs, "read", watched)
        listed = fs_ls('/memories/projects/p/procedural', session=session, **scope)
        assert [item['name'] for item in listed['entries']] == ['me']
        assert {item['path'] for item in fs_grep(GrepIn(pattern='needle', path='/projects/p', **scope), session)['hits']} == {own, shared}
        assert set(fs_find(FindIn(path='/projects/p', **scope), session)['paths']) == {own, shared}
        assert set(read_paths) == {own, shared}
        root = vfs.ls(session, '/', **scope)
        assert all(entry['path'] not in ['/runs', '/threads', '/inbox', '/workspace', '/projects'] for entry in root)
        assert 'needle' in original(session, foreign)['raw']  # PA remains unscoped
