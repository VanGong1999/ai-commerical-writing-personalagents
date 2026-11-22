from fastapi.testclient import TestClient

from app.db import engine, init_db
from app.eval.seed import ensure_eval_seeds
from app.main import app
from app.models import Project
from sqlmodel import Session, select


client = TestClient(app)


def setup_module():
    init_db()
    with Session(engine) as session:
        ensure_eval_seeds(session)


def test_seed_and_list_rubrics():
    r = client.post("/api/v1/eval/seed")
    assert r.status_code == 200
    rubrics = client.get("/api/v1/eval/rubrics")
    assert rubrics.status_code == 200
    body = rubrics.json()
    assert body["count"] >= 10
    assert any(x["key"] == "common.deai.no_simile" for x in body["rubrics"])


def test_suites_and_cases():
    suites = client.get("/api/v1/eval/suites").json()
    assert suites["count"] >= 5
    sid = suites["suites"][0]["id"]
    cases = client.get(f"/api/v1/eval/suites/{sid}/cases").json()
    assert "cases" in cases


def test_sync_run_bad_case_suite():
    suites = client.get("/api/v1/eval/suites?tier=bad_case").json()["suites"]
    assert suites
    suite = next((s for s in suites if s["format"] == "manju"), suites[0])
    run = client.post(
        "/api/v1/eval/runs",
        json={"suiteId": suite["id"], "includeLlm": False, "async": False},
    )
    assert run.status_code == 200, run.text
    body = run.json()
    assert body["status"] == "succeeded"
    assert body["gateVerdict"] == "not_assessed"
    assert body["metrics"]["judgmentCount"] == 0
    detail = client.get(f"/api/v1/eval/runs/{body['id']}").json()
    assert "matrix" in detail


def test_score_artifact_text():
    r = client.post(
        "/api/v1/eval/score-artifact",
        json={
            "text": "她像一朵凋零的牡丹。综上所述，她感到悲伤。今天就这样结束了。",
            "format": "manju",
            "artifactType": "manuscript",
            "includeLlm": False,
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["passed"] is False
    assert any(j["verdict"] == "fail" for j in body["judgments"])


def test_sandbox_not_in_project_list():
    # trigger a run that creates sandbox projects
    suites = client.get("/api/v1/eval/suites?tier=patrol").json()["suites"]
    if suites:
        client.post(
            "/api/v1/eval/runs",
            json={"suiteId": suites[0]["id"], "includeLlm": False, "async": False},
        )
    projects = client.get("/api/v1/projects").json()
    assert all(p.get("status") != "eval_sandbox" for p in projects)
    with Session(engine) as session:
        sandboxes = list(session.exec(select(Project).where(Project.status == "eval_sandbox")).all())
        # may be zero if patrol suite empty cases; still list filter is correct
        _ = sandboxes


def test_case_pool_flag_and_triage():
    # create a dummy artifact via projects seed may exist; flag without artifact still works for pool
    flagged = client.post(
        "/api/v1/eval/case-pool/flag",
        json={"artifactId": "00000000-0000-4000-8000-000000000099", "good": False},
    )
    assert flagged.status_code == 200
    cid = flagged.json()["id"]
    triaged = client.post(
        f"/api/v1/eval/case-pool/{cid}/triage",
        json={"status": "dismissed"},
    )
    assert triaged.status_code == 200
    assert triaged.json()["status"] == "dismissed"


def test_overview_and_config():
    ov = client.get("/api/v1/eval/overview")
    assert ov.status_code == 200
    assert "maturity" in ov.json()
    cfg = client.get("/api/v1/eval/config")
    assert cfg.status_code == 200
    put = client.put("/api/v1/eval/config", json={"onlineSampleRate": 0.1})
    assert put.status_code == 200
