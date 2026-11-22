import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlmodel import SQLModel, Session, create_engine, select

from app.models import Artifact, ArtifactVersion, ActivityLog, Project
from app.routers import export


@pytest.fixture
def engine(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'translation.db'}")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(Project(id='p', user_id='u', title='项目', format='duanju', stage='S0_SETUP'))
        session.add(Artifact(id='a', project_id='p', type='scene', title='场景', version=1,
                             body_markdown='原文', body_json={'script_body': '原场景'}))
        session.commit()
    yield engine
    engine.dispose()


def test_edit_during_translation_preserves_newer_scene_and_returns_candidate(engine, monkeypatch):
    async def scenario():
        started, release = asyncio.Event(), asyncio.Event()

        async def deferred_llm(*args, **kwargs):
            started.set()
            await release.wait()
            return SimpleNamespace(content='Translated original scene.')

        monkeypatch.setattr(export, 'chat_completion', deferred_llm)
        with Session(engine) as session:
            task = asyncio.create_task(export.translate_artifact('p', 'a', export.TranslateArtifactIn(text='原场景'), session))
            await asyncio.wait_for(started.wait(), timeout=5)
            with Session(engine) as editing:
                current = editing.get(Artifact, 'a')
                current.body_json = {'script_body': '用户新场景', 'newMetadata': True}
                current.version = 2
                editing.add(current)
                editing.commit()
            release.set()
            with pytest.raises(HTTPException) as conflict:
                await task
            assert conflict.value.status_code == 409
            assert conflict.value.detail['translatedText'] == 'Translated original scene.'
        with Session(engine) as check:
            current = check.get(Artifact, 'a')
            assert current.version == 2
            assert current.body_json == {'script_body': '用户新场景', 'newMetadata': True}
            assert check.exec(select(ArtifactVersion)).all() == []
            assert check.exec(select(ActivityLog)).all() == []

    asyncio.run(scenario())


def test_stale_translation_version_rejected_before_model_call(engine, monkeypatch):
    async def unexpected_llm(*args, **kwargs):
        pytest.fail('stale requests must not spend a model call')

    monkeypatch.setattr(export, 'chat_completion', unexpected_llm)
    with Session(engine) as session:
        with pytest.raises(HTTPException) as conflict:
            asyncio.run(export.translate_artifact('p', 'a', export.TranslateArtifactIn(text='旧稿', expectedVersion=99), session))
        assert conflict.value.status_code == 409


def test_successful_translation_preserves_source_and_snapshots_previous_version(engine, monkeypatch):
    async def llm(*args, **kwargs):
        return SimpleNamespace(content='Original scene.')

    monkeypatch.setattr(export, 'chat_completion', llm)
    with Session(engine) as session:
        result = asyncio.run(export.translate_artifact('p', 'a', export.TranslateArtifactIn(text='原场景', expectedVersion=1), session))
        assert result.version == 2
        assert result.body_json['script_body'] == '原场景'
        assert result.body_json['english'] == 'Original scene.'
        snapshots = session.exec(select(ArtifactVersion)).all()
        assert len(snapshots) == 2
        assert snapshots[1].actor == "user"
        assert snapshots[1].body_json["english"] == "Original scene."
        assert snapshots[0].version == 1
        assert snapshots[0].body_json == {'script_body': '原场景'}


def test_truncated_translation_and_cowrite_never_publish(engine, monkeypatch):
    from app.routers import assistant

    async def truncated(*args, **kwargs):
        return SimpleNamespace(content='unfinished', raw={'choices': [{'finish_reason': 'length'}]})

    monkeypatch.setattr(export, 'chat_completion', truncated)
    monkeypatch.setattr(assistant, 'chat_completion', truncated)
    with Session(engine) as session:
        with pytest.raises(HTTPException):
            asyncio.run(export.translate_artifact('p', 'a', export.TranslateArtifactIn(text='原文'), session))
        assert session.get(Artifact, 'a').version == 1
        result = asyncio.run(assistant.cowrite_impl(session, assistant.CowriteIn(text='原文', mode='polish')))
        assert result.result == '' and result.hint
