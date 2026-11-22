"""Selection references must remain exact across UTF-16, versions, and queued chat."""
import hashlib

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine
from sqlalchemy.pool import StaticPool

from app.main import app, api
from app.db import get_session
from app.models import Artifact, ArtifactVersion, Project, KnowledgeDoc, AnalysisReport, MemoryFile


@pytest.fixture
def context_client():
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(Project(id='p', user_id='00000000-0000-4000-8000-000000000001', title='测试', format='novel', stage='draft'))
        session.add(Artifact(id='a', project_id='p', type='scene', title='场景', version=2,
                             body_json={'script_body': '前😀选中后'}, body_markdown='错误字段'))
        session.add(ArtifactVersion(artifact_id='a', version=1, title='旧稿', status='draft', body_markdown='旧正文'))
        session.add(KnowledgeDoc(id='doc', title='资料', doc_type='text', user_id='00000000-0000-4000-8000-000000000001', storage_uri='inline:资料原文'))
        session.add(AnalysisReport(id='r', doc_id='doc', report_type='analysis', title='报告', body_markdown='报告原文'))
        session.commit()
        api.dependency_overrides[get_session] = lambda: session
        with TestClient(app, raise_server_exceptions=True) as client:
            yield client, session
        api.dependency_overrides.clear()


def resolve(client, **ref):
    return client.post('/api/v1/context/resolve', json={'refs': [ref]})


def test_scene_selection_uses_browser_utf16_offsets(context_client):
    client, _ = context_client
    response = resolve(client, kind='artifact', sourceId='a', projectId='p', start=3, end=5, quote='选中')
    assert response.status_code == 200, response.text
    ref = response.json()['refs'][0]
    assert (ref['quote'], ref['version'], ref['start'], ref['end']) == ('选中', 2, 3, 5)
    assert ref['contentHash'] == hashlib.sha256('前😀选中后'.encode()).hexdigest()


@pytest.mark.parametrize('updates', [{'start': 2}, {'quote': '伪造'}, {'end': 90}, {'projectId': 'other'}])
def test_rejects_invalid_selection(context_client, updates):
    client, _ = context_client
    ref = dict(kind='artifact', sourceId='a', projectId='p', start=3, end=5, quote='选中')
    ref.update(updates)
    assert resolve(client, **ref).status_code in (404, 409, 422)


def test_historical_version_and_kb_sources(context_client):
    client, _ = context_client
    assert resolve(client, kind='artifact', sourceId='a', version=1).json()['refs'][0]['quote'] == '旧正文'
    assert resolve(client, kind='kb_doc', sourceId='doc').json()['refs'][0]['quote'] == '资料原文'
    assert resolve(client, kind='report', sourceId='r').json()['refs'][0]['quote'] == '报告原文'


def test_draft_snapshot_resolves_without_sending_full_text_again(context_client):
    client, session = context_client
    ref = resolve(client, kind='draft', sourceId='a', projectId='p', draftText='秘密前文选中秘密后文', start=4, end=6, quote='选中').json()['refs'][0]
    assert 'draftText' not in ref
    assert resolve(client, **ref).json()['refs'][0] == ref
    assert session.get(MemoryFile, '/memories/context_refs/' + ref['snapshotId'] + '.json').frozen
    tampered = dict(ref, quote='伪造')
    assert resolve(client, **tampered).status_code == 409


def test_oversized_quote_rejected_explicitly(context_client):
    client, _ = context_client
    response = resolve(client, kind='draft', sourceId='d', draftText='文' * 6000)
    assert response.status_code == 422


def test_history_persists_refs_and_prompt_only_contains_bounded_quote(context_client):
    from app.models import Conversation, Message
    from app.routers.personal_agent import _load_history, list_messages
    client, session = context_client
    text = '隐藏开头' + '文' * 200 + '选中' + '后' * 200 + '隐藏结尾'
    ref = resolve(client, kind='draft', sourceId='a', draftText=text, start=204, end=206).json()['refs'][0]
    conv = Conversation(id='c', user_id='00000000-0000-4000-8000-000000000001', title='测试')
    session.add(conv)
    session.add(Message(conversation_id='c', content='分析选区', evidence=[{'kind': 'context_ref', 'ref': ref}]))
    session.commit()
    history = _load_history(session, 'c')
    assert '选中' in history[-1]['content']
    assert '不可信' in history[-1]['content']
    assert '隐藏开头' not in history[-1]['content']
    assert '隐藏结尾' not in history[-1]['content']
    assert list_messages('c', session)[0].model_dump(by_alias=True)['contextRefs'][0]['id'] == ref['id']


def test_chat_rejects_forged_ref_before_queue_or_network(context_client):
    from app.models import Conversation, AgentEvent
    from sqlmodel import select
    client, session = context_client
    session.add(Conversation(id='c', user_id='00000000-0000-4000-8000-000000000001', title='测试'))
    session.commit()
    response = client.post('/api/v1/conversations/c/chat', json={'message': '分析', 'contextRefs': [
        {'kind': 'artifact', 'sourceId': 'a', 'start': 3, 'end': 5, 'quote': '伪造'}]})
    assert response.status_code == 409, response.text
    assert not list(session.exec(select(AgentEvent)))


@pytest.mark.asyncio
async def test_queued_chat_persists_canonical_refs_before_model(context_client, monkeypatch):
    from app.models import Conversation, Message, AgentEvent
    from app.schemas import ChatConversationIn
    from app.routers import personal_agent as pa
    from app.chief_runner import run_conversation_turns
    from sqlmodel import select
    client, session = context_client
    session.add(Conversation(id='c', user_id='00000000-0000-4000-8000-000000000001', title='测试'))
    session.commit()
    ref = resolve(client, kind='artifact', sourceId='a', start=3, end=5).json()['refs'][0]
    observed = []

    async def model_boundary(session, conv, emit, **kwargs):
        observed.extend(pa._load_history(session, conv.id))
        return '已分析'

    monkeypatch.setattr(pa, '_run_supervisor', model_boundary)
    await pa.chat_conversation('c', ChatConversationIn(message='分析', contextRefs=[ref], clientMessageId='request-a'), session)
    assert list(session.exec(select(AgentEvent)))[0].payload['contextRefs'][0]['quote'] == '选中'
    result = await run_conversation_turns(session, 'c')
    assert result['reply'] == '已分析'
    stored = list(session.exec(select(Message)))[0]
    assert stored.content == '分析'
    assert stored.evidence[0]['ref']['id'] == ref['id']
    assert stored.actions[0]['payloads'][0]['clientMessageId'] == 'request-a'
    assert '选中' in observed[-1]['content']


def test_running_turn_injection_retains_event_references(context_client):
    from app.agent_inbox import submit_event, inbox_event_actions
    from app.routers.personal_agent import _append_message
    client, session = context_client
    ref = resolve(client, kind='artifact', sourceId='a', start=3, end=5).json()['refs'][0]
    event = submit_event(session, conversation_id='c', source='web', payload={'message': '分析', 'contextRefs': [ref]})
    message = _append_message(session, 'c', 'user', '分析', actions=inbox_event_actions([event]))
    assert message.evidence[0]['ref']['id'] == ref['id']


def test_draft_snapshots_are_inaccessible_to_memory_and_vfs(context_client):
    from app import vfs
    client, session = context_client
    ref = resolve(client, kind='draft', sourceId='d', draftText='私密全文选中', start=4, end=6).json()['refs'][0]
    path = '/memories/context_refs/' + ref['snapshotId'] + '.json'
    assert client.get('/api/v1/memory/tree').json() == []
    assert client.post('/api/v1/memory/search', params={'q': '私密全文'}).json() == []
    assert client.get('/api/v1/memory/file', params={'path': path}).status_code == 404
    assert client.post('/api/v1/memory/versions', json={'path': path}).status_code == 404
    assert vfs.ls(session, '/memories') == []
    with pytest.raises(vfs.VfsError):
        vfs.read(session, path)


@pytest.mark.parametrize('kind,source', [('kb_doc', 'doc'), ('report', 'r')])
def test_kb_refs_replay_original_snapshot_after_source_edit(context_client, kind, source):
    client, session = context_client
    ref = resolve(client, kind=kind, sourceId=source).json()['refs'][0]
    if kind == 'kb_doc':
        row = session.get(KnowledgeDoc, source)
        row.storage_uri = 'inline:已修改'
    else:
        row = session.get(AnalysisReport, source)
        row.body_markdown = '已修改'
    session.add(row)
    session.commit()
    replay = resolve(client, **ref)
    assert replay.status_code == 200, replay.text
    assert replay.json()['refs'][0]['quote'] == ref['quote']
    assert replay.json()['refs'][0]['snapshotId']


def test_draft_snapshot_rejects_changed_version_metadata(context_client):
    client, _ = context_client
    ref = resolve(client, kind='draft', sourceId='a', version=1, draftText='原稿').json()['refs'][0]
    ref.pop('id')
    ref['version'] = 2
    assert resolve(client, **ref).status_code == 409


def test_schedule_api_rejects_invalid_create_and_update(context_client):
    client, _ = context_client
    assert client.post('/api/v1/scheduled-tasks', json={'name': '测试', 'cronOrInterval': '99 * * * *'}).status_code == 422
    valid = client.post('/api/v1/scheduled-tasks', json={'name': '测试', 'cronOrInterval': '2h'})
    assert valid.status_code == 200
    task_id = valid.json()['id']
    assert valid.json()['nextRunAt'] is not None
    assert client.patch('/api/v1/scheduled-tasks/' + task_id, json={'cronOrInterval': '0s'}).status_code == 422
    assert client.patch('/api/v1/scheduled-tasks/' + task_id, json={'cronOrInterval': '3h'}).json()['cronOrInterval'] == '3h'


@pytest.mark.asyncio
async def test_schedule_tool_rejects_invalid_spec_without_persistence(context_client):
    from app.models import Conversation, ScheduledTask
    from app.routers.personal_agent import _execute_supervisor_tool
    from sqlmodel import select
    _, session = context_client
    conv = Conversation(user_id='test', title='测试')
    text, detail = await _execute_supervisor_tool('schedule_task', {'cron': '99 * * * *'}, session, conv)
    assert detail['error'] == 'invalid_schedule'
    assert not list(session.exec(select(ScheduledTask)))


def test_server_preview_and_resolver_share_json_only_artifact_text(context_client):
    client, session = context_client
    session.add(Artifact(id='json',project_id='p',type='core_hook',title='结构稿',body_json={'ratio':1.0,'中文':'内容'}))
    session.commit()
    preview = client.get('/api/v1/context/artifacts/json/text')
    assert preview.status_code == 200
    source = preview.json()
    assert source['text'] == '{\n  "ratio": 1.0,\n  "中文": "内容"\n}'
    result = resolve(client,kind='artifact',sourceId='json',version=source['version'],start=0,end=len(source['text']),quote=source['text'])
    assert result.status_code == 200
    assert result.json()['refs'][0]['quote'] == source['text']


def test_artifact_reference_survives_source_deletion(context_client):
    client, session = context_client
    ref = resolve(client, kind='artifact', sourceId='a', start=3, end=5).json()['refs'][0]
    session.delete(session.get(Artifact,'a'))
    session.commit()
    replay = resolve(client, **ref)
    assert replay.status_code == 200, replay.text
    assert replay.json()['refs'][0]['quote'] == '选中'


@pytest.mark.asyncio
@pytest.mark.parametrize('tool,args', [('write', {'content':'覆盖'}), ('edit', {'old':'原文','new':'覆盖'})])
async def test_personal_agent_file_tools_preserve_stale_hash_guard(context_client, tool, args):
    from app import vfs
    from app.models import Conversation
    from app.routers.personal_agent import _execute_supervisor_tool
    _, session = context_client
    path = '/memories/user/guarded.md'
    vfs.write(session,path,'原文',actor='user')
    text, _ = await _execute_supervisor_tool(tool, {'path':path,'expected_hash':'stale',**args}, session, Conversation(user_id='test'))
    assert '失败' in text
    assert vfs.read(session,path)['raw'] == '原文'


def test_unmounted_file_reference_is_rejected_as_unknown_source(context_client):
    client, _ = context_client
    result = resolve(client,kind='file',sourceId='/files/missing/book.txt',start=0,end=1)
    assert result.status_code == 404


def test_mounted_file_reference_is_exact_immutable_and_hides_physical_path(context_client, tmp_path):
    client, _ = context_client
    book = tmp_path / 'book.txt'
    book.write_text('开头😀中段结尾', encoding='utf-8')
    mounted = client.post('/api/v1/fs/mounts',json={'name':'novels','root':str(tmp_path),'readOnly':True})
    assert mounted.status_code == 200, mounted.text
    result = resolve(client,kind='file',sourceId='/files/novels/book.txt',start=4,end=6,quote='中段')
    assert result.status_code == 200, result.text
    ref = result.json()['refs'][0]
    assert ref['quote'] == '中段'
    assert ref['title'] == 'book.txt'
    assert str(tmp_path) not in result.text
    book.write_text('已修改全文',encoding='utf-8')
    replay = resolve(client,**ref)
    assert replay.status_code == 200
    assert replay.json()['refs'][0]['quote'] == '中段'


@pytest.mark.asyncio
@pytest.mark.parametrize('consume_second', [False, True])
async def test_assistant_reference_provenance_follows_consumed_events_not_latest_user(context_client, monkeypatch, consume_second):
    import asyncio
    from app import bot_runtime
    from app.models import Conversation
    from app.agent_inbox import submit_event, inbox_event_actions
    from app.routers import personal_agent as pa
    client, session = context_client
    conv = Conversation(id='c', user_id='00000000-0000-4000-8000-000000000001',title='测试')
    session.add(conv)
    session.commit()
    ref_a = resolve(client,kind='artifact',sourceId='a',start=3,end=5).json()['refs'][0]
    ref_b = resolve(client,kind='artifact',sourceId='a',start=0,end=1).json()['refs'][0]
    event_a = submit_event(session,conversation_id='c',source='web',payload={'message':'A','contextRefs':[ref_a]})
    event_b = submit_event(session,conversation_id='c',source='web',payload={'message':'B','contextRefs':[ref_b]})
    entered, release = asyncio.Event(), asyncio.Event()
    emitted = []

    async def capture(event, data):
        emitted.append((event,data))

    async def fake_model(session, conv, bot, emit, **kwargs):
        entered.set()
        await release.wait()
        if consume_second:
            pa._append_message(session,'c','user','B',actions=inbox_event_actions([event_b]))
        pa._append_message(session,'c','assistant','A的候选')
        await emit('done', {'reply':'A的候选','conversationId':'c'})
        return 'A的候选'

    monkeypatch.setattr(bot_runtime,'run_bot_turn',fake_model)
    task = asyncio.create_task(pa._run_supervisor(session,conv,capture,claimed_events=[event_a]))
    await asyncio.wait_for(entered.wait(),timeout=2)
    if not consume_second:
        # B is persisted from another request while A is running, but A never consumed it.
        pa._append_message(session,'c','user','B',evidence=[{'kind':'context_ref','ref':ref_b}])
    release.set()
    await task
    reply = next(m for m in pa.list_messages('c',session) if m.role=='assistant')
    assert [r.id for r in reply.context_refs] == [ref_a['id'], *([ref_b['id']] if consume_second else [])]
    assert pa._load_history(session,'c')[-1]['content'] == 'A的候选'
    assert [r['id'] for r in emitted[-1][1]['contextRefs']] == [r.id for r in reply.context_refs]
    # The live message stream carries the same binding, without nearest-user inference.
    import json
    from app import db
    monkeypatch.setattr(db, 'engine', session.get_bind())
    stream = await pa.conversation_stream('c', after_seq=0, session=session)
    try:
        async for chunk in stream.body_iterator:
            payload = json.loads(chunk.removeprefix('data: ').strip())
            if payload.get('event') == 'message' and payload.get('role') == 'assistant':
                assert [r['id'] for r in payload['contextRefs']] == [r.id for r in reply.context_refs]
                break
    finally:
        await stream.body_iterator.aclose()
    # Scope ends with the model turn; future independent assistant messages inherit nothing.
    standalone = pa._append_message(session,'c','assistant','独立消息')
    assert not standalone.evidence


def test_model_supplied_evidence_cannot_forge_assistant_selection_targets(context_client):
    from app.routers.personal_agent import _append_message
    from app.context_refs import refs_from_evidence
    client, session = context_client
    ref = resolve(client,kind='artifact',sourceId='a',start=3,end=5).json()['refs'][0]
    message = _append_message(session,'c','assistant','模型候选',evidence=[
        {'kind':'context_ref','ref':ref}, {'kind':'source','label':'普通证据'}])
    assert refs_from_evidence(message.evidence) == []
    assert message.evidence == [{'kind':'source','label':'普通证据'}]


def test_merged_inbox_carries_exact_client_correlations_without_changing_refs(context_client):
    from app.agent_inbox import submit_event, inbox_event_actions
    from app.models import Conversation
    from app.routers.personal_agent import _append_message
    client, session = context_client
    session.add(Conversation(id='correlated',user_id='00000000-0000-4000-8000-000000000001',title='关联'))
    session.commit()
    ref=resolve(client,kind='artifact',sourceId='a',start=3,end=5).json()['refs'][0]
    events=[submit_event(session,conversation_id='correlated',source='web',payload={'message':'相同指令','clientMessageId':cid,'contextRefs':[ref]}) for cid in ['first','second']]
    message=_append_message(session,'correlated','user','合并消息',actions=inbox_event_actions(events))
    payloads=message.actions[0]['payloads']
    assert [p['clientMessageId'] for p in payloads] == ['first','second']
    assert message.evidence[0]['ref']['id'] == ref['id']
    replay=client.get('/api/v1/conversations/correlated/messages').json()[0]
    assert replay['actions'][0]['payloads'] == payloads
    assert replay['contextRefs'][0]['id'] == ref['id']


def test_client_message_id_input_is_bounded_and_optional():
    from app.schemas import ChatConversationIn
    from pydantic import ValidationError
    assert ChatConversationIn(message='旧客户端').client_message_id is None
    for invalid in ['', 'x'*129]:
        with pytest.raises(ValidationError):
            ChatConversationIn(message='不合法',clientMessageId=invalid)


@pytest.mark.asyncio
async def test_message_sse_preserves_client_correlation_and_authoritative_refs(context_client, monkeypatch):
    import json
    from app import db
    from app.agent_inbox import submit_event, inbox_event_actions
    from app.models import Conversation
    from app.routers import personal_agent as pa
    client, session = context_client
    monkeypatch.setattr(db, 'engine', session.get_bind())
    session.add(Conversation(id='sse-correlated',user_id='00000000-0000-4000-8000-000000000001',title='SSE'))
    session.commit()
    ref=resolve(client,kind='artifact',sourceId='a',start=3,end=5).json()['refs'][0]
    event=submit_event(session,conversation_id='sse-correlated',source='web',payload={'message':'分析','clientMessageId':'client-sse','contextRefs':[ref]})
    pa._append_message(session,'sse-correlated','user','分析',actions=inbox_event_actions([event]))
    response=await pa.conversation_stream('sse-correlated',after_seq=0,session=session)
    chunk=await anext(response.body_iterator)
    await response.body_iterator.aclose()
    payload=json.loads(next(line[6:] for line in chunk.splitlines() if line.startswith('data: ')))
    assert payload['actions'][0]['payloads'][0]['clientMessageId']=='client-sse'
    assert payload['contextRefs'][0]['id']==ref['id']


@pytest.mark.asyncio
async def test_meta_chat_correlates_direct_user_bubble_without_paid_call(context_client, monkeypatch):
    from app import db, bot_runtime
    from app.models import Conversation, Message
    from app.schemas import ChatConversationIn
    from app.routers import personal_agent as pa
    from sqlmodel import select
    _, session=context_client
    monkeypatch.setattr(db,'engine',session.get_bind())
    session.add(Conversation(id='meta-correlated',user_id='00000000-0000-4000-8000-000000000001',title='Meta'))
    session.commit()

    async def no_model(session, conv, bot, emit, **kwargs):
        await emit('done',{'reply':'本地边界测试'})
        return '本地边界测试'

    monkeypatch.setattr(bot_runtime,'run_bot_turn',no_model)
    response=await pa.chat_conversation('meta-correlated',ChatConversationIn(message='列出我的项目',clientMessageId='client-meta'),session)
    async for _ in response.body_iterator:
        pass
    user=session.exec(select(Message).where(Message.conversation_id=='meta-correlated',Message.role=='user')).one()
    assert user.actions[0]['payloads'][0]['clientMessageId']=='client-meta'
