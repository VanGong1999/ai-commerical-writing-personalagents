"""Shared memory tool reads retain project/private boundaries and exact pages."""
import asyncio
import json

import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine

from app.models import Project, MemoryFile, Conversation
from app.memory_service import memory_hash
from app.routers.personal_agent import _execute_supervisor_tool


@pytest.fixture
def memory_session():
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        project = Project(id='current', user_id='u', title='Current', format='manju', stage='S0_SETUP')
        other = Project(id='other', user_id='u', title='Other', format='manju', stage='S0_SETUP')
        session.add(project); session.add(other); session.commit()
        yield session, Conversation(user_id='u', project_id='current')


def read(session, conv, **args):
    return asyncio.run(_execute_supervisor_tool('read_memory', args, session, conv))


def test_shared_listing_excludes_private_sources_and_reports_coverage(memory_session):
    session, conv = memory_session
    for i in range(12):
        session.add(MemoryFile(path=f'/memories/projects/current/bible/{i}.md', user_id='u',
                               project_id='current', content=f'SHARED_{i}', source_run_id='source'))
    forbidden = ['procedural/another-agent/lessons.md', 'reflections/notes.md', 'journal/raw.md',
                 'private/secret.md', 'fleet/f/m/notes.md']
    for suffix in forbidden:
        session.add(MemoryFile(path='/memories/projects/current/' + suffix, user_id='u', content='SECRET'))
    session.add(MemoryFile(path='/memories/projects/current/misfiled.md', user_id='u',
                           store_id='agent.another.lessons', content='SECRET'))
    session.add(MemoryFile(path='/memories/projects/current/foreign-owner.md', user_id='foreign', content='SECRET'))
    session.commit()
    text, detail = read(session, conv)
    assert 'SECRET' not in text
    assert detail['totalFileCount'] == 12
    assert detail['returnedFileCount'] <= 10 and detail['hasMore'] is True
    assert detail['coverage'] == 'shared_project_metadata_only'
    assert detail['files'] and all('preview' in row and 'content' not in row for row in detail['files'])
    assert all(row['source_run_id'] == 'source' and row['hash'] for row in detail['files'])
    assert json.loads(text) == detail and len(text) <= 6000
    for suffix in forbidden:
        _, denied = read(session, conv, path='/memories/projects/current/' + suffix)
        assert denied['error'] == 'memory_scope_denied'


def test_exact_path_paging_preserves_content_hash_and_provenance(memory_session):
    session, conv = memory_session
    content = '锁定姓名为李青。\n' + '完整事实' * 1000
    path = '/memories/projects/current/bible/decisions.md'
    session.add(MemoryFile(path=path, user_id='u', project_id='current', content=content,
                           actor='agent:author', source_run_id='run-source', source_conversation_id='conv-source'))
    session.commit()
    pieces = []
    offset = 0
    while True:
        text, detail = read(session, conv, path=path, offset=offset, limit=1000)
        assert detail['path'] == path and detail['hash'] == memory_hash(content)
        assert detail['source_run_id'] == 'run-source' and detail['actor'] == 'agent:author'
        assert detail['offset'] == offset and detail['coverage'] == 'exact_character_page'
        assert len(text) <= 6000 and detail['totalChars'] == len(content)
        pieces.append(detail['content'])
        offset = detail['nextOffset']
        if offset is None:
            break
    assert ''.join(pieces) == content
    _, invalid = read(session, conv, path=path, limit=4001)
    assert invalid['error'] == 'invalid_memory_page'


def test_foreign_project_overrides_and_unbound_fallback_are_denied(memory_session):
    session, conv = memory_session
    session.add(MemoryFile(path='/memories/projects/other/decisions.md', user_id='u', content='OTHER_SECRET'))
    session.commit()
    for args in [{'project_id': 'other'}, {'path': '/memories/projects/other/decisions.md'}]:
        text, detail = read(session, conv, **args)
        assert detail['error'] == 'memory_scope_denied' and 'OTHER_SECRET' not in text
    conv.project_id = None
    assert read(session, conv, project_id='other')[1]['error'] == 'memory_scope_denied'
