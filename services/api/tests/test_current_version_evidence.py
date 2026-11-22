from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier

import pytest
from fastapi import HTTPException
from sqlalchemy import event
from sqlmodel import Session, SQLModel, create_engine, select

from app.eval.runner import score_agent_run_evidence
from app.models import AgentRun, Artifact, ArtifactVersion, OntoActionRun, Project, utcnow
from app.ontology.runtime import execute_action
from app.routers.projects import create_artifact, recover_current_version
from app.schemas import CreateArtifactIn


@pytest.fixture
def database(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'versions.db'}")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        for project_id in ("p", "other"):
            session.add(Project(id=project_id, user_id="owner", title="稿", format="manju", stage="S0_SETUP"))
        session.add(AgentRun(id="r", project_id="p", agent_id="writer", status="running"))
        session.add(Artifact(id="old", project_id="p", title="旧稿", type="manuscript", body_markdown="当前内容"))
        session.commit()
    yield engine
    engine.dispose()


def recover(session, **changes):
    fields = dict(user_id="owner", project_id="p", artifact_id="old", expected_version=1)
    return recover_current_version(session, **(fields | changes))


def test_concurrent_baseline_retains_one_id_and_real_time(database):
    barrier = Barrier(2)
    started = utcnow().replace(tzinfo=None)

    def capture(_):
        with Session(database) as session:
            session.get(Artifact, "old")
            barrier.wait(timeout=5)
            row = recover(session)
            session.commit()
            return row.id

    with ThreadPoolExecutor(2) as pool:
        first, second = pool.map(capture, range(2))
    assert first == second
    with Session(database) as session:
        row, = session.exec(select(ArtifactVersion)).all()
        assert row.id == first and row.actor == "system" and "Recovered" in row.note
        assert row.created_at.replace(tzinfo=None) >= started
        for changes in ({"user_id": "other"}, {"project_id": "other"}, {"expected_version": 2}):
            with pytest.raises((HTTPException, ValueError)):
                recover(session, **changes)
        session.add(ArtifactVersion(artifact_id="old", version=1, title="冲突", status="draft"))
        session.commit()
        with pytest.raises(HTTPException, match="artifact_snapshot_evidence_conflict"):
            recover(session)
        session.rollback()
        assert len(session.exec(select(ArtifactVersion)).all()) == 2


def action(session, project_id="p", run_id="r", **parameters):
    return execute_action(session, project_id=project_id, actor="agent", action_api_name="UpsertObject",
        parameters={"typeApiName": "CoreHook", "properties": {"title": "稿", "bodyMarkdown": "原始正文"},
                    "createdByRunId": run_id, **parameters})


@pytest.mark.parametrize("ontology", [False, True])
def test_snapshot_failure_leaves_no_new_artifact_or_action(database, ontology):
    def fail(*args):
        raise RuntimeError("injected snapshot failure")

    event.listen(ArtifactVersion, "before_insert", fail)
    try:
        with Session(database) as session, pytest.raises(RuntimeError, match="injected"):
            if ontology:
                action(session)
            else:
                create_artifact("p", CreateArtifactIn(type="other", title="稿"), session)
    finally:
        event.remove(ArtifactVersion, "before_insert", fail)
    with Session(database) as session:
        assert [a.id for a in session.exec(select(Artifact))] == ["old"]
        assert not session.exec(select(ArtifactVersion)).all()
        assert not session.exec(select(OntoActionRun)).all()


@pytest.mark.asyncio
async def test_exact_ontology_evidence_survives_later_run(database):
    with Session(database) as session:
        with pytest.raises(ValueError, match="invalid_generation_run"):
            action(session, project_id="other")
        result = action(session)["applied"][0]
        version, = session.exec(select(ArtifactVersion)).all()
        source = session.get(AgentRun, "r")
        source.status, source.finished_at = "succeeded", utcnow()
        source.output_artifact_ids = [result["artifactId"], "old"]
        session.add(AgentRun(id="later", project_id="p", agent_id="writer", status="running"))
        session.commit()
        action(session, run_id="later", rid=result["rid"])
        assert session.get(Artifact, version.artifact_id).created_by_run_id == "later"
        baseline = recover(session)
        session.commit()

        async def score(row, user="owner"):
            return await score_agent_run_evidence(session, "r", row.id, user_id=user, include_llm=False)

        assert (await score(version))["evaluationMode"] == "agent_run_evidence"
        for row in [baseline, session.exec(select(ArtifactVersion).where(ArtifactVersion.version == 2)).one()]:
            with pytest.raises(ValueError, match="version provenance"):
                await score(row)
        with pytest.raises(ValueError, match="project_boundary"):
            await score(version, "intruder")
        for actor, timestamp in [("agent:writer", version.created_at),
                                 ("agent:r", source.finished_at + timedelta(seconds=1))]:
            row = ArtifactVersion(artifact_id=version.artifact_id, version=0, title="遗留", status="draft",
                                  actor=actor, created_at=timestamp)
            session.add(row)
            session.commit()
            with pytest.raises(ValueError, match="version provenance"):
                await score(row)


def test_reviewed_adoption_rejects_edit_between_read_and_lock(database, monkeypatch):
    from app.routers.projects import adopt_artifact
    from app.schemas import AdoptArtifactIn

    with Session(database) as review:
        original_get = review.get
        intervened = False

        def get_then_edit(model, key, **kwargs):
            nonlocal intervened
            row = original_get(model, key, **kwargs)
            if model is Artifact and not intervened:
                intervened = True
                with Session(database) as editor:
                    art = editor.get(Artifact, key)
                    art.body_markdown, art.version = "未复核的新稿", 2
                    editor.commit()
            return row

        monkeypatch.setattr(review, "get", get_then_edit)
        with pytest.raises(HTTPException) as failure:
            adopt_artifact("p", "old", AdoptArtifactIn(expectedVersion=1), review)
        assert failure.value.status_code == 409
    with Session(database) as session:
        art = session.get(Artifact, "old")
        assert (art.version, art.status, art.body_markdown) == (2, "draft", "未复核的新稿")
        assert not session.exec(select(OntoActionRun)).all()
        assert not session.exec(select(ArtifactVersion)).all()


@pytest.mark.parametrize("artifact_type", ["manuscript", "other"])
def test_adopt_advances_once_and_attributes_missing_baseline(database, artifact_type):
    from app.routers.projects import adopt_artifact
    from app.schemas import AdoptArtifactIn

    with Session(database) as session:
        art = session.get(Artifact, "old")
        art.type = artifact_type
        art.created_by_run_id = "r"
        session.commit()
        start = utcnow().replace(tzinfo=None)
        adopted = adopt_artifact("p", art.id, AdoptArtifactIn(expectedVersion=1), session)
        assert (adopted.version, adopted.status, adopted.body_markdown) == (2, "adopted", "当前内容")
        old, current = session.exec(select(ArtifactVersion).order_by(ArtifactVersion.version)).all()
        assert old.actor == "system" and "Recovered baseline" in old.note
        assert old.created_at.replace(tzinfo=None) >= start
        assert current.actor == "user" and current.status == "adopted"


def test_mapped_adoption_conflict_rolls_back_baseline_and_mirror(database, monkeypatch):
    from app.models import OntoObject
    from app.ontology import runtime
    from app.routers.projects import adopt_artifact
    from app.schemas import AdoptArtifactIn

    def conflict(*args, **kwargs):
        raise ValueError("object_version_conflict")

    monkeypatch.setattr(runtime, "execute_action_in_transaction", conflict)
    with Session(database) as session:
        with pytest.raises(HTTPException, match="object_version_conflict") as failure:
            adopt_artifact("p", "old", AdoptArtifactIn(expectedVersion=1), session)
        assert failure.value.status_code == 409
        art = session.get(Artifact, "old")
        assert (art.version, art.status) == (1, "draft")
        assert not session.exec(select(ArtifactVersion)).all()
        assert not session.exec(select(OntoObject)).all()
