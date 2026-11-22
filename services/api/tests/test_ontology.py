from __future__ import annotations

import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine
from starlette.testclient import TestClient

from app.db import get_session
from app.main import api, app

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
SQLModel.metadata.create_all(engine)


def override_session():
    with Session(engine) as session:
        yield session


client = TestClient(app)


@pytest.fixture(autouse=True)
def _use_test_session():
    api.dependency_overrides[get_session] = override_session
    yield
    api.dependency_overrides.pop(get_session, None)


def _project(fmt: str = "manju") -> str:
    res = client.post("/api/v1/projects", json={"title": f"onto-{fmt}", "format": fmt})
    assert res.status_code == 200, res.text
    return res.json()["id"]


def test_ontology_registry():
    r = client.get("/api/v1/ontology/registry")
    assert r.status_code == 200
    data = r.json()
    assert data.get("schemaVersion") == "writing-ontology/1"
    assert data.get("counts", {}).get("objectTypes", 0) >= 40
    assert data.get("counts", {}).get("actionTypes", 0) >= 30
    assert "core_hook" in (data.get("actionOnlyArtifactTypes") or [])


def test_ontology_upsert_story_graph_and_query():
    project_id = _project()
    submit = client.post(
        "/api/v1/ontology/actions/submit",
        json={
            "actionApiName": "UpsertStoryGraph",
            "projectId": project_id,
            "parameters": {
                "graph": {
                    "nodes": [
                        {"id": "c1", "kind": "character", "label": "林川", "status": "active"}
                    ],
                    "edges": [],
                    "characterStates": [],
                }
            },
        },
    )
    assert submit.status_code == 200, submit.text
    assert submit.json()["ok"] is True

    objs = client.get(f"/api/v1/ontology/projects/{project_id}/objects?typeApiName=StoryGraph")
    assert objs.status_code == 200
    rows = objs.json()
    assert len(rows) >= 1
    assert "flowchart" in (rows[0].get("properties") or {}).get("mermaid", "")

    q = client.post(
        "/api/v1/ontology/query",
        json={
            "function": "sliceForBible",
            "projectId": project_id,
            "parameters": {"currentEp": 1},
        },
    )
    assert q.status_code == 200
    assert "尚无 story_graph" in str(q.json().get("result") or "")


def test_ontology_blocks_direct_mapped_create():
    project_id = _project()
    r = client.post(
        f"/api/v1/projects/{project_id}/artifacts",
        json={
            "type": "core_hook",
            "title": "blocked",
            "bodyMarkdown": "x",
            "bodyJson": {"titleHook": "t", "coreHook": "c"},
        },
    )
    assert r.status_code == 409

    ok = client.post(
        f"/api/v1/projects/{project_id}/artifacts",
        json={
            "type": "core_hook",
            "title": "allowed",
            "bodyMarkdown": "x",
            "bodyJson": {"titleHook": "t", "coreHook": "c"},
            "viaOntologyAction": True,
        },
    )
    assert ok.status_code == 200, ok.text


def _run(project_id, name):
    from app.models import AgentRun
    with Session(engine) as session:
        run_id = f"{project_id}-{name}"
        if not session.get(AgentRun, run_id):
            session.add(AgentRun(id=run_id, project_id=project_id, agent_id="writer", status="running"))
            session.commit()
        return run_id


def test_materialize_artifact_reads_created_by_run_id():
    project_id = _project()
    up = client.post(
        "/api/v1/ontology/actions/submit",
        json={
            "actionApiName": "UpsertObject",
            "projectId": project_id,
            "actor": "agent",
            "parameters": {
                "typeApiName": "CoreHook",
                "properties": {"title": "hook-cbr", "coreHook": "x"},
                "createdByRunId": _run(project_id, "r1"),
            },
        },
    )
    assert up.status_code == 200 and up.json()["ok"], up.text
    arts = client.get(f"/api/v1/projects/{project_id}/artifacts?type=core_hook").json()
    hit = next((a for a in arts if a.get("title") == "hook-cbr"), None)
    assert hit is not None, arts
    assert hit.get("createdByRunId") == _run(project_id, "r1")


def test_ontology_scenario():
    project_id = _project()
    up = client.post(
        "/api/v1/ontology/actions/submit",
        json={
            "actionApiName": "UpsertObject",
            "projectId": project_id,
            "parameters": {
                "typeApiName": "CoreHook",
                "properties": {"title": "hook-a", "coreHook": "x"},
            },
        },
    )
    assert up.status_code == 200 and up.json()["ok"]
    objs = client.get(
        f"/api/v1/ontology/projects/{project_id}/objects?typeApiName=CoreHook"
    ).json()
    rid = objs[0]["rid"]
    sc = client.post(
        "/api/v1/ontology/actions/submit",
        json={
            "actionApiName": "CreateScenario",
            "projectId": project_id,
            "parameters": {"label": "结局B", "baseRids": [rid]},
        },
    )
    assert sc.status_code == 200 and sc.json()["ok"]
    listed = client.get(f"/api/v1/ontology/projects/{project_id}/scenarios")
    assert listed.status_code == 200
    assert any(s.get("label") == "结局B" for s in listed.json())


def test_format_bindings():
    for fmt in ("manju", "duanju", "short_novel", "male_long", "female_long", "ip_adapt"):
        r = client.get(f"/api/v1/ontology/formats/{fmt}/bindings")
        assert r.status_code == 200
        assert len(r.json().get("actionTypes") or []) >= 5


def _upsert_hook(project_id, title, run_id, rid=None):
    parameters = {'typeApiName': 'CoreHook', 'properties': {'title': title, 'coreHook': f'正文-{title}'},
                  'createdByRunId': _run(project_id, run_id)}
    if rid:
        parameters['rid'] = rid
    response = client.post('/api/v1/ontology/actions/submit', json={
        'actionApiName': 'UpsertObject', 'actor': 'agent', 'projectId': project_id, 'parameters': parameters})
    assert response.status_code == 200 and response.json()['ok'], response.text
    return response.json()


@pytest.mark.parametrize('count', [2, 10])
def test_sequential_new_hooks_keep_distinct_artifacts_titles_and_run_ids(count):
    project_id = _project()
    for i in range(count):
        _upsert_hook(project_id, f'独立核心梗-{i}', f'candidate-run-{i}')
        artifacts = client.get(f'/api/v1/projects/{project_id}/artifacts?type=core_hook').json()
        assert len(artifacts) == i + 1
        assert {a['title']: a['createdByRunId'] for a in artifacts} == {
            f'独立核心梗-{n}': _run(project_id, f'candidate-run-{n}') for n in range(i + 1)}
    objects = client.get(f'/api/v1/ontology/projects/{project_id}/objects?typeApiName=CoreHook').json()
    assert len(objects) == count
    assert len({o['backingArtifactId'] for o in objects}) == count


def test_new_hooks_with_same_title_do_not_alias_artifact_identity():
    project_id = _project()
    first = _upsert_hook(project_id, '同名核心梗', 'first-run')
    second = _upsert_hook(project_id, '同名核心梗', 'second-run')
    first_id = first['applied'][0]['artifactId']
    second_id = second['applied'][0]['artifactId']
    assert first_id and second_id and first_id != second_id
    artifacts = client.get(f'/api/v1/projects/{project_id}/artifacts?type=core_hook').json()
    assert len(artifacts) == 2
    assert {a['createdByRunId'] for a in artifacts} == {_run(project_id, 'first-run'), _run(project_id, 'second-run')}
    assert {a['id'] for a in artifacts} == {first_id, second_id}


def test_explicit_hook_rid_updates_and_adopts_same_backing_artifact():
    from app.models import ArtifactVersion
    from sqlmodel import select
    project_id = _project()
    _upsert_hook(project_id, '最初核心梗', 'first-run')
    obj = client.get(f'/api/v1/ontology/projects/{project_id}/objects?typeApiName=CoreHook').json()[0]
    artifact_id = obj['backingArtifactId']
    updated = _upsert_hook(project_id, '明确修改核心梗', 'edit-run', rid=obj['rid'])
    assert updated['applied'][0]['artifactId'] == artifact_id
    artifacts = client.get(f'/api/v1/projects/{project_id}/artifacts?type=core_hook').json()
    assert len(artifacts) == 1
    assert artifacts[0]['id'] == artifact_id
    assert artifacts[0]['title'] == '明确修改核心梗'
    assert artifacts[0]['version'] == 2
    adopted = client.post('/api/v1/ontology/actions/submit', json={
        'actionApiName': 'AdoptObject', 'projectId': project_id,
        'parameters': {'rid': obj['rid'], 'mode': 'strong'}})
    assert adopted.status_code == 200 and adopted.json()['ok'], adopted.text
    assert adopted.json()['applied'][0]['artifactId'] == artifact_id
    artifacts = client.get(f'/api/v1/projects/{project_id}/artifacts?type=core_hook').json()
    assert len(artifacts) == 1
    assert artifacts[0]['id'] == artifact_id
    assert artifacts[0]['status'] == 'adopted'
    assert artifacts[0]['version'] == 3
    with Session(engine) as session:
        versions = session.exec(select(ArtifactVersion).where(ArtifactVersion.artifact_id == artifact_id)).all()
        assert sorted(v.version for v in versions) == [1, 2, 3]
        assert {v.version: v.actor for v in versions} == {1: f"agent:{project_id}-first-run",
            2: f"agent:{project_id}-edit-run", 3: "user"}


def _action(project_id, name, parameters):
    return client.post('/api/v1/ontology/actions/submit', json={
        'projectId': project_id, 'actionApiName': name, 'parameters': parameters})


def _scenario(project_id, rids):
    response = _action(project_id, 'CreateScenario', {'baseRids': rids})
    assert response.status_code == 200, response.text
    return response.json()['sideEffects']['scenarioRid']


def test_scenario_stale_conflict_is_atomic_and_reports_rid():
    from app.models import OntoScenario
    project_id = _project()
    first = _upsert_hook(project_id, 'first', 'r1')['applied'][0]['rid']
    second = _upsert_hook(project_id, 'second', 'r2')['applied'][0]['rid']
    scenario = _scenario(project_id, [first, second])
    with Session(engine) as session:
        sc = session.get(OntoScenario, scenario)
        sc.forked_properties = {**sc.forked_properties, first: {'title': 'branch'}}
        session.add(sc)
        session.commit()
    _upsert_hook(project_id, 'primary edit', 'r3', rid=second)
    response = _action(project_id, 'MergeScenario', {'scenarioRid': scenario, 'confirmed': True})
    assert response.status_code == 409, response.text
    assert response.json()['detail']['conflicts'][0]['rid'] == second
    rows = client.get(f'/api/v1/ontology/projects/{project_id}/objects').json()
    assert next(o for o in rows if o['rid'] == first)['version'] == 1
    assert next(o for o in rows if o['rid'] == second)['properties']['title'] == 'primary edit'


@pytest.mark.parametrize('action,params', [
    ('UpsertObject', lambda rid: {'rid': rid, 'typeApiName': 'CoreHook', 'properties': {'title': 'foreign'}}),
    ('AdoptObject', lambda rid: {'rid': rid}),
    ('CreateScenario', lambda rid: {'baseRids': [rid]}),
    ('LinkExpectationToGraph', lambda rid: {'fromRid': rid, 'toRid': rid}),
    ('UpsertObject', lambda rid: {'typeApiName': 'CoreHook', 'properties': {'sourceRefs': [{'rid': rid}]}}),
])
def test_actions_reject_foreign_project_references(action, params):
    owner, foreign = _project(), _project()
    rid = _upsert_hook(owner, 'private', 'r1')['applied'][0]['rid']
    response = _action(foreign, action, params(rid))
    assert response.status_code == 409, response.text
    assert 'project_boundary' in str(response.json())


def test_merge_materializes_review_invalidation_and_replay_is_noop():
    from app.models import OntoScenario, Artifact
    project_id = _project()
    original = _upsert_hook(project_id, 'original', 'r1')['applied'][0]
    rid = original['rid']
    assert _action(project_id, 'AdoptObject', {'rid': rid}).status_code == 200
    scenario = _scenario(project_id, [rid])
    with Session(engine) as session:
        sc = session.get(OntoScenario, scenario)
        props = {**sc.forked_properties[rid], 'coreHook': 'branch revision'}
        sc.forked_properties = {**sc.forked_properties, rid: props}
        session.add(sc)
        session.commit()
    assert _action(project_id, 'LogicAck', {}).status_code == 200
    merged = _action(project_id, 'MergeScenario', {'scenarioRid': scenario, 'confirmed': True})
    assert merged.status_code == 200, merged.text
    with Session(engine) as session:
        art = session.get(Artifact, original['artifactId'])
        assert art.body_json['coreHook'] == 'branch revision'
        assert art.status == 'draft'
        version = art.version
    replay = _action(project_id, 'MergeScenario', {'scenarioRid': scenario, 'confirmed': True})
    assert replay.status_code == 200 and replay.json()['sideEffects']['alreadyMerged']
    with Session(engine) as session:
        assert session.get(Artifact, original['artifactId']).version == version


def test_scenario_edit_api_preserves_sources_and_cas():
    project_id = _project()
    rid = _upsert_hook(project_id, 'source', 'r1')['applied'][0]['rid']
    scenario = _scenario(project_id, [rid])
    current = client.get(f'/api/v1/ontology/projects/{project_id}/scenarios').json()[0]
    params = {'scenarioRid': scenario, 'expectedBranchHash': current.get('contentHash'),
              'forkedProperties': {rid: {'title': 'branch', 'sourceRefs': [{'rid': rid}]}}}
    edited = _action(project_id, 'UpdateScenario', params)
    assert edited.status_code == 200 and edited.json()['ok'], edited.text
    assert client.get(f'/api/v1/ontology/objects/{rid}').json()['properties']['title'] == 'source'
    stale = _action(project_id, 'UpdateScenario', params)
    assert stale.status_code == 409, stale.text
    merged = _action(project_id, 'MergeScenario', {'scenarioRid': scenario, 'confirmed': True})
    assert merged.status_code == 200 and merged.json()['ok'], merged.text
    assert client.get(f'/api/v1/ontology/objects/{rid}').json()['properties']['sourceRefs'] == [{'rid': rid}]


def test_failed_materialization_rolls_back_all_objects_artifacts_and_scenario(monkeypatch):
    from app.ontology import runtime
    from app.models import OntoScenario
    project_id = _project()
    rids = [_upsert_hook(project_id, f'first-{i}', 'r1')['applied'][0]['rid'] for i in range(2)]
    scenario = _scenario(project_id, rids)
    with Session(engine) as session:
        sc = session.get(OntoScenario, scenario)
        sc.forked_properties = {**sc.forked_properties, **{rid: {'title': 'changed'} for rid in rids}}
        session.add(sc)
        session.commit()
    actual = runtime._materialize_artifact
    count = 0
    def failing(*args, **kwargs):
        nonlocal count
        count += 1
        if count == 2:
            raise ValueError('materialize_failed')
        return actual(*args, **kwargs)
    monkeypatch.setattr(runtime, '_materialize_artifact', failing)
    response = _action(project_id, 'MergeScenario', {'scenarioRid': scenario, 'confirmed': True})
    assert response.status_code == 409
    rows = client.get(f'/api/v1/ontology/projects/{project_id}/objects').json()
    assert all(row['version'] == 1 for row in rows)
    assert all(a['version'] == 1 for a in client.get(f'/api/v1/projects/{project_id}/artifacts').json())
    assert client.get(f'/api/v1/ontology/projects/{project_id}/scenarios').json()[0]['status'] == 'open'


def test_bible_query_excludes_unreviewed_graph_candidates():
    project_id = _project()
    created = _action(project_id, 'UpsertStoryGraph', {'graph': {'nodes': [{'id': 'private-candidate', 'label': 'candidate text'}]}})
    assert created.status_code == 200
    query = lambda: client.post('/api/v1/ontology/query', json={'projectId': project_id, 'function': 'sliceForBible'}).json()['result']
    assert 'candidate text' not in query()
    assert _action(project_id, 'AdoptObject', {'rid': created.json()['applied'][0]['rid']}).status_code == 200
    assert 'candidate text' in query()


def test_unknown_actions_and_string_confirmation_fail_closed():
    project_id = _project()
    unknown = _action(project_id, 'InventedAction', {})
    assert unknown.status_code == 200 and not unknown.json()['ok'], unknown.text
    rid = _upsert_hook(project_id, 'first', 'r1')['applied'][0]['rid']
    scenario = _scenario(project_id, [rid])
    response = _action(project_id, 'MergeScenario', {'scenarioRid': scenario, 'confirmed': 'false'})
    assert response.status_code == 200 and not response.json()['ok'], response.text


def test_content_replacement_preserves_source_provenance():
    project_id = _project()
    props = {'title': 'source', 'coreHook': 'first', 'sourceRefs': [{'kind': 'user', 'note': 'original instruction'}]}
    created = _action(project_id, 'UpsertObject', {'typeApiName': 'CoreHook', 'properties': props})
    rid = created.json()['applied'][0]['rid']
    _upsert_hook(project_id, 'revised', 'r2', rid=rid)
    assert client.get(f'/api/v1/ontology/objects/{rid}').json()['properties']['sourceRefs'] == props['sourceRefs']
