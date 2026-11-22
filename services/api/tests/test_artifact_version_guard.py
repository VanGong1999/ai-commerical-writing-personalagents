import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select
from starlette.testclient import TestClient
from app.db import get_session
from app.main import app, api
from app.models import Project, Artifact, ArtifactVersion

@pytest.fixture
def client():
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    def session():
        with Session(engine) as s:
            yield s
    api.dependency_overrides[get_session] = session
    with Session(engine) as s:
        s.add(Project(id='p',user_id='u',title='项目',format='manju',stage='S0_SETUP'))
        s.add(Artifact(id='a',project_id='p',type='manuscript',title='正文',body_markdown='前文。原文。后文。',version=1))
        s.commit()
    yield TestClient(app), engine
    api.dependency_overrides.pop(get_session, None)
    engine.dispose()

def test_stale_selection_edit_cannot_overwrite_newer_user_edit(client):
    c, engine = client
    url = '/api/v1/projects/p/artifacts/a'
    first = c.patch(url,json={'viaOntologyAction':True,'bodyMarkdown':'用户的新稿','expectedVersion':1})
    assert first.status_code == 200
    stale = c.patch(url,json={'viaOntologyAction':True,'bodyMarkdown':'旧引用的AI结果','expectedVersion':1})
    assert stale.status_code == 409
    assert stale.json()['detail']['code'] == 'version_conflict'
    with Session(engine) as s:
        assert s.get(Artifact,'a').body_markdown == '用户的新稿'
        assert len(s.exec(select(ArtifactVersion)).all()) == 2

def test_guarded_save_keeps_original_snapshot_and_supports_legacy_calls(client):
    c, engine = client
    url = '/api/v1/projects/p/artifacts/a'
    result = c.patch(url,json={'viaOntologyAction':True,'bodyMarkdown':'前文。改写。后文。','expectedVersion':1})
    assert result.status_code == 200
    assert result.json()['version'] == 2
    with Session(engine) as s:
        assert s.exec(select(ArtifactVersion)).first().body_markdown == '前文。原文。后文。'
    assert c.patch(url,json={'viaOntologyAction':True,'title':'新标题'}).status_code == 200


def test_logic_ack_is_bound_to_artifact_versions(client):
    c, engine = client
    assert c.post('/api/v1/projects/p/logic-ack').status_code == 200
    with Session(engine) as s:
        assert s.get(Project, 'p').progress['logicAckVersions'] == {'a': 1}


def test_content_edit_invalidates_approval_and_marks_descendants_for_review(client):
    from app.models import utcnow
    c, engine = client
    with Session(engine) as s:
        art = s.get(Artifact, 'a')
        art.status = 'adopted'
        art.adopted_at = utcnow()
        s.add(art)
        s.add(Artifact(id='child',project_id='p',parent_id='a',type='manuscript',title='后续',body_markdown='后续内容',status='adopted'))
        s.add(Artifact(id='grandchild',project_id='p',parent_id='child',type='manuscript',title='更后续'))
        s.add(Artifact(id='unrelated',project_id='p',type='manuscript',title='独立稿'))
        s.commit()
    c.post('/api/v1/projects/p/logic-ack')
    result = c.patch('/api/v1/projects/p/artifacts/a',json={'viaOntologyAction':True,'bodyMarkdown':'改稿','expectedVersion':1})
    assert result.status_code == 200
    assert result.json()['status'] == 'draft'
    assert result.json()['adoptedAt'] is None
    with Session(engine) as s:
        progress = s.get(Project, 'p').progress
        assert progress['logicAck'] is False
        assert not progress['logic_ack']
        assert 'a' not in progress.get('logicAckVersions', {})
        assert set(progress['artifactReviewRequired']) == {'child', 'grandchild'}
        assert s.get(Artifact,'child').status == 'adopted'


@pytest.mark.parametrize('change', [{'title':'新名'}, {'bodyMarkdown':'前文。原文。后文。'}])
def test_metadata_or_identical_body_preserves_human_approval(client, change):
    from app.models import utcnow
    c, engine = client
    with Session(engine) as s:
        art = s.get(Artifact, 'a')
        art.status = 'adopted'
        art.adopted_at = utcnow()
        s.add(art)
        s.commit()
    c.post('/api/v1/projects/p/logic-ack')
    response = c.patch('/api/v1/projects/p/artifacts/a',json={'viaOntologyAction':True,'expectedVersion':1,**change})
    assert response.status_code == 200
    assert response.json()['status'] == 'adopted'
    with Session(engine) as s:
        assert s.get(Project, 'p').progress['logicAck'] is True
        assert s.get(Project, 'p').progress['logicAckVersions']['a'] == 2


def test_stale_adoption_is_rejected_before_ontology_action(client, monkeypatch):
    from app.ontology import runtime
    c, engine = client
    calls = []
    monkeypatch.setattr(runtime, 'execute_action', lambda *args, **kwargs: calls.append(kwargs))
    response = c.post('/api/v1/projects/p/artifacts/a/adopt',json={'mode':'strong','expectedVersion':99})
    assert response.status_code == 409
    assert calls == []
    with Session(engine) as s:
        assert s.get(Artifact, 'a').status == 'draft'
        assert len(s.exec(select(ArtifactVersion)).all()) == 0


def test_snapshot_restore_preserves_history_and_immutable_reference(client):
    c, engine = client
    with Session(engine) as s:
        art = s.get(Artifact,'a')
        art.status = 'adopted'
        s.add(art)
        s.commit()
    c.post('/api/v1/projects/p/logic-ack')
    saved = c.post('/api/v1/projects/p/snapshots', json={'name':'原版'}).json()
    changed = c.patch('/api/v1/projects/p/artifacts/a', json={'viaOntologyAction':True,'bodyMarkdown':'新版正文','expectedVersion':1})
    assert changed.json()['version'] == 2
    ref = c.post('/api/v1/context/resolve', json={'refs':[{'kind':'artifact','sourceId':'a','projectId':'p','version':2}]}).json()['refs'][0]
    c.post('/api/v1/projects/p/logic-ack')
    restored = c.post('/api/v1/projects/p/snapshots/' + saved['id'] + '/restore')
    assert restored.status_code == 200
    with Session(engine) as s:
        art = s.get(Artifact,'a')
        assert art.body_markdown == '前文。原文。后文。'
        assert art.version == 3
        assert art.status == 'draft'
        assert art.adopted_at is None
        versions = s.exec(select(ArtifactVersion).where(ArtifactVersion.artifact_id=='a')).all()
        assert {v.version for v in versions} == {1,2,3}
        assert s.get(Project,'p').progress['logicAck'] is False
    replay = c.post('/api/v1/context/resolve', json={'refs':[ref]})
    assert replay.status_code == 200, replay.text
    assert replay.json()['refs'][0]['quote'] == '新版正文'


def test_snapshot_restore_syncs_stale_adopted_ontology_object(client):
    from app.models import OntoObject
    from app.ontology.runtime import sync_artifact_to_object
    c, engine = client
    saved = c.post('/api/v1/projects/p/snapshots', json={'name':'旧稿'}).json()
    with Session(engine) as s:
        art = s.get(Artifact,'a')
        art.status = 'adopted'
        art.body_markdown = '已采纳的新稿'
        art.version = 2
        s.add(art)
        obj = sync_artifact_to_object(s, artifact=art, via_action=True)
        rid = obj.rid
        s.commit()
    result = c.post('/api/v1/projects/p/snapshots/' + saved['id'] + '/restore')
    assert result.status_code == 200
    with Session(engine) as s:
        obj = s.get(OntoObject,rid)
        assert obj.status == 'draft'
        assert obj.properties['bodyMarkdown'] == '前文。原文。后文。'
        assert obj.backing_artifact_id == 'a'


def test_ontology_logic_ack_records_same_version_bound_approval_as_api(client):
    from app.ontology.runtime import execute_action
    c, engine = client
    with Session(engine) as s:
        project = s.get(Project,'p')
        project.progress = {'artifactReviewRequired':{'a':{'reason':'等待复核'}}, 'logicAckVersions':{'a':0}}
        s.add(project)
        s.commit()
        result = execute_action(s, action_api_name='LogicAck', project_id='p', actor='user')
        assert result['ok'] is True
        s.commit()
    with Session(engine) as s:
        progress = s.get(Project,'p').progress
        assert progress['logicAck'] is True
        assert progress['logic_ack'] == 1
        assert progress['logicAckAt'] == progress['logic_ack_at']
        assert progress['logicAckVersions'] == {'a':1}
        assert progress['artifactReviewRequired'] == {}
    c.patch('/api/v1/projects/p/artifacts/a', json={'viaOntologyAction':True,'bodyMarkdown':'修改内容','expectedVersion':1})
    with Session(engine) as s:
        progress = s.get(Project,'p').progress
        assert progress['logicAck'] is False
        assert not progress['logic_ack']
        assert progress['logicAckVersions'] == {}


@pytest.mark.parametrize('writer',['vfs','ontology'])
def test_legacy_content_writers_invalidate_approval_and_preserve_versions(client, writer):
    from app import vfs
    from app.models import utcnow, OntoObject
    from app.ontology.runtime import sync_artifact_to_object, execute_action
    c, engine = client
    with Session(engine) as s:
        art = s.get(Artifact,'a')
        art.status = 'adopted'
        art.adopted_at = utcnow()
        s.add(art)
        s.add(Artifact(id='child',project_id='p',parent_id='a',type='manuscript',title='下游'))
        obj = sync_artifact_to_object(s,artifact=art,via_action=True)
        rid = obj.rid
        s.commit()
    c.post('/api/v1/projects/p/logic-ack')
    with Session(engine) as s:
        if writer == 'vfs':
            vfs.write(s,'/projects/p/artifacts/manuscript/正文.md','工具改稿',actor='user')
        else:
            result = execute_action(s,action_api_name='UpsertObject',project_id='p',actor='user',parameters={
                'rid':rid,'typeApiName':'Manuscript','properties':{'title':'正文','bodyMarkdown':'工具改稿','status':'adopted'}})
            assert result['ok'] is True
            s.commit()
    with Session(engine) as s:
        art = s.get(Artifact,'a')
        assert art.body_markdown == '工具改稿'
        assert art.version == 2
        assert art.status == 'draft'
        assert art.adopted_at is None
        progress = s.get(Project,'p').progress
        assert not progress['logicAck'] and not progress['logic_ack']
        assert progress['logicAckVersions'] == {}
        assert 'child' in progress['artifactReviewRequired']
        versions = s.exec(select(ArtifactVersion).where(ArtifactVersion.artifact_id=='a')).all()
        assert len(versions) == 2
        assert versions[1].status == art.status
        assert versions[0].version == 1
        assert versions[0].body_markdown == '前文。原文。后文。'
        assert s.get(OntoObject,rid).status == 'draft'


def test_adopting_unchanged_source_preserves_ack_bound_to_resulting_version(client):
    c, engine = client
    c.post('/api/v1/projects/p/logic-ack')
    response = c.post('/api/v1/projects/p/artifacts/a/adopt',json={'mode':'strong','expectedVersion':1})
    assert response.status_code == 200
    assert response.json()['status'] == 'adopted'
    with Session(engine) as s:
        progress = s.get(Project,'p').progress
        assert progress['logicAck'] is True
        assert progress['logicAckVersions']['a'] == response.json()['version']


def test_rollback_rejects_stale_or_missing_version_before_mutating(client):
    c, engine = client
    c.patch('/api/v1/projects/p/artifacts/a', json={'viaOntologyAction':True,'bodyMarkdown':'新稿','expectedVersion':1})
    with Session(engine) as session:
        snapshot_id = session.exec(select(ArtifactVersion)).first().id
    url = f'/api/v1/projects/p/artifacts/a/versions/{snapshot_id}/rollback'
    assert c.post(url, json={'expectedVersion':1}).status_code == 409
    assert c.post(url, json={}).status_code == 422
    with Session(engine) as session:
        assert session.get(Artifact,'a').body_markdown == '新稿'
        assert session.get(Artifact,'a').version == 2
        assert len(session.exec(select(ArtifactVersion)).all()) == 2


def test_rollback_invalidates_approval_preserves_current_history_and_audits_previous_version(client):
    from app.models import ActivityLog, OntoObject, utcnow
    from app.ontology.runtime import sync_artifact_to_object
    c, engine = client
    with Session(engine) as session:
        art = session.get(Artifact,'a')
        art.status = 'adopted'
        art.adopted_at = utcnow()
        session.add(art)
        session.add(Artifact(id='child',project_id='p',parent_id='a',type='manuscript',title='下游'))
        session.commit()
    c.patch('/api/v1/projects/p/artifacts/a', json={'viaOntologyAction':True,'bodyMarkdown':'新稿','expectedVersion':1})
    with Session(engine) as session:
        snapshot_id = session.exec(select(ArtifactVersion)).first().id
        art = session.get(Artifact,'a')
        obj = sync_artifact_to_object(session,artifact=art,via_action=True)
        rid = obj.rid
        session.commit()
    c.post('/api/v1/projects/p/logic-ack')
    result = c.post(f'/api/v1/projects/p/artifacts/a/versions/{snapshot_id}/rollback', json={'expectedVersion':2})
    assert result.status_code == 200, result.text
    assert result.json()['version'] == 3
    with Session(engine) as session:
        art = session.get(Artifact,'a')
        assert art.body_markdown == '前文。原文。后文。'
        assert art.status == 'draft' and art.adopted_at is None
        progress = session.get(Project,'p').progress
        assert not progress['logicAck'] and not progress['logic_ack']
        assert progress['logicAckVersions'] == {}
        assert 'child' in progress['artifactReviewRequired']
        history = session.exec(select(ArtifactVersion).where(ArtifactVersion.artifact_id=='a')).all()
        assert {snap.version for snap in history} == {1,2,3}
        assert next(snap for snap in history if snap.version==2).body_markdown == '新稿'
        assert session.get(OntoObject,rid).status == 'draft'
        assert session.get(OntoObject,rid).properties['bodyMarkdown'] == art.body_markdown
        audit = session.exec(select(ActivityLog).where(ActivityLog.action=='rollback')).first()
        assert audit.detail['from_version'] == 2
        assert audit.detail['to_version'] == 1


def test_rollback_cas_rejects_intervening_edit_without_saving_phantom_snapshot(client):
    from fastapi import HTTPException
    from app.routers.assistant import artifact_rollback
    c, engine = client
    url = '/api/v1/projects/p/artifacts/a'
    c.patch(url,json={'viaOntologyAction':True,'bodyMarkdown':'第二稿','expectedVersion':1})
    with Session(engine) as stale:
        old = stale.get(Artifact,'a')
        snapshot_id = stale.exec(select(ArtifactVersion)).first().id
        assert old.version == 2
        c.patch(url,json={'viaOntologyAction':True,'bodyMarkdown':'并发的新稿','expectedVersion':2})
        with pytest.raises(HTTPException) as error:
            artifact_rollback('p','a',snapshot_id,{'expectedVersion':2},session=stale)
        assert error.value.status_code == 409
    with Session(engine) as session:
        assert session.get(Artifact,'a').body_markdown == '并发的新稿'
        assert session.get(Artifact,'a').version == 3
        assert len(session.exec(select(ArtifactVersion)).all()) == 3


def test_rollback_of_identical_content_does_not_resurrect_historical_adoption(client):
    c, engine = client
    with Session(engine) as session:
        snapshot = ArtifactVersion(artifact_id='a',version=0,title='旧名',status='adopted',
                                   body_markdown='前文。原文。后文。')
        session.add(snapshot)
        session.commit()
        snapshot_id = snapshot.id
    result = c.post(f'/api/v1/projects/p/artifacts/a/versions/{snapshot_id}/rollback',json={'expectedVersion':1})
    assert result.status_code == 200
    with Session(engine) as session:
        assert session.get(Artifact,'a').status == 'draft'
        assert session.get(Artifact,'a').adopted_at is None


@pytest.mark.parametrize('manifest', [{'a': 0}, {}, {'a': 1, 'removed': 1}])
def test_logic_ack_rejects_unreviewed_manifest(client, manifest):
    c, engine = client
    response = c.post('/api/v1/projects/p/logic-ack', json={'expectedVersions': manifest})
    assert response.status_code == 409
    with Session(engine) as s:
        assert not s.get(Project, 'p').progress.get('logicAck')
    assert c.post('/api/v1/projects/p/logic-ack', json={'expectedVersions': {'a': 1}}).status_code == 200
