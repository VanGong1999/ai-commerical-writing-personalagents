import pytest
from fastapi import HTTPException
from sqlmodel import Session, select
from app import task_daemon
from app.db import engine, init_db
from app.models import AgentRun, Artifact, AnalysisReport, KnowledgeDoc, Project
from app.routers.autopilot import AutopilotStartIn, launch_autopilot
from app.routers.kb import SavedReportIn, generate_report, list_reports


@pytest.fixture
def studio():
    init_db()
    with Session(engine) as db:
        project = Project(title="fixture", format="manju", stage="S4", user_id="fixture")
        db.add(project)
        db.commit()
        yield db, project


def test_pipeline_saves_linked_rows_once(studio):
    db, project = studio
    doc = KnowledgeDoc(title="fixture", doc_type="book", user_id="fixture")
    run = AgentRun(project_id=project.id, agent_id="kb.report_pipeline", input_json={"doc_id": doc.id})
    db.add_all([doc, run])
    db.commit()
    body = SavedReportIn(title="结构分析", bodyMarkdown="逐段比对原文开场的矛盾与中段揭示的动机，结尾的选择回应了最初的行动，具体关联可由这两段核对。", runId=run.id, projectId=project.id)
    row = generate_report(doc.id, "seven_steps", db, body)
    assert generate_report(doc.id, "seven_steps", db, body).id == row.id
    assert list_reports(doc.id, db)[0].id == row.id
    art = db.get(Artifact, row.body_json["artifactId"])
    assert art.created_by_run_id == run.id and art.body_json["reportId"] == row.id
    assert art.body_markdown == row.body_markdown
    for patch in ({"body_markdown":"pending"},{"body_markdown":body.body_markdown+"不同结论"},{"project_id":"wrong"}):
        with pytest.raises(HTTPException):
            generate_report(doc.id,"seven_steps",db,body.model_copy(update=patch))
    assert len(db.exec(select(AnalysisReport).where(AnalysisReport.doc_id==doc.id)).all()) == 1


def test_dispatch_verifies_approval_and_stops_dependents(studio):
    db, project = studio
    outlines = [Artifact(project_id=project.id,type="episode_outline",title=f"第{i}集",body_json={"episodeNo":i}) for i in (1,2)]
    refs = [{"id":a.id,"version":1,"episodeNo":i} for i,a in enumerate(outlines,1)]
    source = {"format":"manju","episode_range":"EP01–EP02","outline_ref":refs}
    run = AgentRun(project_id=project.id,agent_id="orch.batch_writer",input_json=source)
    db.add_all([run,*outlines])
    db.commit()
    body = AutopilotStartIn(dispatcherRunId=run.id)
    for pid in ("wrong",project.id):
        with pytest.raises(HTTPException):
            launch_autopilot(pid,body,db,None)
    project.progress={"logicAck":True,"logicAckVersions":{a.id:1 for a in outlines}}
    run.input_json={**source,"episode_range":"EP01–EP03"}
    db.add_all([project,run])
    db.commit()
    with pytest.raises(HTTPException):
        launch_autopilot(project.id,body,db,None)
    run.input_json=source
    db.add(run)
    db.commit()
    result=launch_autopilot(project.id,body,db,None)
    assert launch_autopilot(project.id,body,db,None)==result
    first,second,qa=[db.get(AgentRun,i) for i in result["runIds"]]
    assert second.depends_on_run_ids==[first.id] and qa.depends_on_run_ids==[second.id]
    assert second.status==qa.status=="pending_deps"
    first.status="failed"
    db.add(first)
    db.commit()
    task_daemon.tick(db)
    assert second.status==qa.status=="cancelled"


def test_legacy_regeneration_still_enqueues(studio, monkeypatch):
    db, _ = studio
    doc = KnowledgeDoc(title="legacy", doc_type="book", user_id="fixture")
    db.add(doc)
    db.commit()
    jobs = []
    monkeypatch.setattr("app.routers.kb.enqueue_job", lambda job_id,payload: jobs.append(job_id))
    row = generate_report(doc.id, "seven_steps", db)
    assert row.body_json["pending"] is True and jobs == [row.body_json["jobId"]]


@pytest.mark.parametrize("change", ["format", "withdrawal", "version", "lost_response", "new_body"])
def test_frozen_batch_after_first_child(studio, change):
    db, project = studio
    arts = [Artifact(project_id=project.id, type="episode_outline", title=f"第{i}集") for i in (1,2)]
    refs = [{"id":a.id, "version":1, "episodeNo":i} for i,a in enumerate(arts,1)]
    project.progress = {"logicAck":True,"logicAckVersions":{a.id:1 for a in arts}}
    parent = AgentRun(project_id=project.id,agent_id="orch.batch_writer",
                      input_json={"episode_range":"EP01–EP02","format":"manju","outline_ref":refs})
    db.add_all([project,parent,*arts])
    db.commit()
    body = AutopilotStartIn(dispatcherRunId=parent.id)
    receipt = launch_autopilot(project.id,body,db,None)
    first,second,qa = [db.get(AgentRun,i) for i in receipt["runIds"]]
    parent.status = "succeeded"
    db.add(parent)
    db.commit()
    task_daemon.tick(db)
    assert first.status == "queued"
    first.status = "succeeded"
    if change == "new_body":
        from app.routers.projects import create_artifact, CreateArtifactIn
        first.status = "running"
        saved = create_artifact(project.id, CreateArtifactIn(type="manuscript",title="第一集",
                                bodyMarkdown="已保存正文",createdByRunId=first.id,viaOntologyAction=True), db)
        first.status = "succeeded"
        assert saved.id not in project.progress["logicAckVersions"]
    elif change == "format":
        project.format = "duanju"
    elif change == "withdrawal":
        project.progress = {"logicAck":False}
    else:
        arts[1].version += 1
    db.add_all([project,first,arts[1]])
    db.commit()
    if change == "lost_response":
        assert launch_autopilot(project.id,body,db,None) == receipt
        with pytest.raises(HTTPException):
            launch_autopilot("wrong-project",body,db,None)
    elif change == "new_body":
        task_daemon.tick(db)
        assert second.status == "queued" and qa.status == "pending_deps"
    else:
        task_daemon.tick(db)
        assert second.status == "failed" and qa.status == "cancelled"
        assert second.input_json["format"] == "manju"
