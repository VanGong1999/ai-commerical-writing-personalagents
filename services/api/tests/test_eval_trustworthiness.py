"""Evidence, gateway, and evaluation provenance regressions; no live model calls."""
import asyncio
import json

import pytest
from sqlmodel import Session, select

from app.db import engine, init_db
from app.eval.graders import llm_judge
from app.eval.graders.code import _gate_result_to_verdict, _special_deai_rubric
from app.eval.reward import score_completion
from app.eval.runner import _case_text, run_suite
from app.eval.score import score_text
from app.models import EvalCase, EvalRubric, EvalSuite, UsageEvent
from llm_gateway.client import ChatResult

@pytest.fixture
def session():
    init_db()
    with Session(engine) as s:
        yield s

def rubric(key="trust.semantic", grader="llm"):
    return EvalRubric(key=key, name=key, question="动作是否具体？", grader=grader, format="*", artifact_type="*")

def test_gateway_result_content_and_usage_are_recorded(session, monkeypatch):
    async def complete(*args, **kwargs):
        return ChatResult(content=json.dumps([{"rubric_key": "trust.semantic", "verdict": "pass", "evidence_quote": "推开门"}]), model="local-test", prompt_tokens=123, completion_tokens=45)
    monkeypatch.setattr(llm_judge, "chat_completion", complete)
    rows = asyncio.run(llm_judge.grade_llm_batch(session, [rubric()], "她推开门。", force=True))
    assert rows[0].verdict == "pass"
    event = session.exec(select(UsageEvent).order_by(UsageEvent.created_at.desc())).first()
    assert (event.prompt_tokens, event.completion_tokens, event.model) == (123, 45, "local-test")

@pytest.mark.parametrize("quote", ["", "门", "不存在"])
def test_unverifiable_decisive_verdict_is_unknown(session, monkeypatch, quote):
    async def complete(*args, **kwargs):
        return {"choices": [{"message": {"content": json.dumps([{"rubric_key": "trust.semantic", "verdict": "fail", "evidence_quote": quote}])}}]}
    monkeypatch.setattr(llm_judge, "chat_completion", complete)
    rows = asyncio.run(llm_judge.grade_llm_batch(session, [rubric()], "她推开门。", force=True))
    assert rows[0].verdict == "unknown"

def test_whole_text_is_seen_or_reported_unknown(session, monkeypatch):
    async def complete(messages, **kwargs):
        quote = "末尾伏笔回收" if "末尾伏笔回收" in messages[-1]["content"] else "开头动作"
        return ChatResult(content=json.dumps([{"rubric_key": "trust.semantic", "verdict": "pass", "evidence_quote": quote}]), model="local")
    monkeypatch.setattr(llm_judge, "chat_completion", complete)
    rows = asyncio.run(llm_judge.grade_llm_batch(session, [rubric()], "开头动作" + "正文" * 3000 + "末尾伏笔回收", force=True))
    assert rows[0].evidence_quote == "末尾伏笔回收"
    rows = asyncio.run(llm_judge.grade_llm_batch(session, [rubric()], "正文" * 100000, force=True))
    assert rows[0].verdict == "unknown"
    assert "coverage" in rows[0].reasoning.lower()

def test_pairwise_gateway_and_malformed_unknown(session, monkeypatch):
    answers = iter(['{"winner":"A","reason":"动作具体"}', '{"winner":"B","reason":"动作具体"}'])
    async def complete(*args, **kwargs):
        return ChatResult(content=next(answers), model="local", prompt_tokens=11, completion_tokens=7)
    monkeypatch.setattr(llm_judge, "chat_completion", complete)
    assert asyncio.run(llm_judge.pairwise_judge(session, "她推开门。", "她很伤心。"))["winner"] == "A"
    async def broken(*args, **kwargs):
        return ChatResult(content="not json", model="local")
    monkeypatch.setattr(llm_judge, "chat_completion", broken)
    assert asyncio.run(llm_judge.pairwise_judge(session, "正文甲", "正文乙"))["winner"] == "unknown"

def test_meaningful_simile_is_semantic_unknown_not_regex_failure():
    r = rubric("common.deai.no_simile", "code")
    assert _special_deai_rubric(r, "伤口像父亲留下的地图一样，指向废弃矿井。")[0] == "unknown"
    assert _special_deai_rubric(r, "她仿佛听见钥匙在锁孔里转动。")[0] == "unknown"
    assert _special_deai_rubric(r, "她像一朵凋零的牡丹。")[0] == "unknown"

def test_warning_is_unknown_and_default_reward_only_checks_length():
    assert _gate_result_to_verdict([{"result": "warn", "message": "缺信息"}])[0] == "unknown"
    out = score_completion("伤口像地图一样，指向矿井。", min_chars=1, max_chars=100)
    assert out["total"] == 1
    assert out["complete"] is True
    assert out["unknownRate"] == 0

def test_skipped_semantic_rubric_counts_as_unknown(session):
    r = rubric("trust.skipped")
    session.add(r)
    session.commit()
    out = asyncio.run(score_text(session, "她推开门。", rubric_keys=[r.key], include_llm=False, persist=False))
    assert out["rubricCount"] == 1
    assert out["detail"]["unknownRate"] == 1
    assert not out["passed"]

def test_reference_and_brief_never_become_candidate():
    case = EvalCase(suite_id="x", title="gold", reference_markdown="黄金答案", input_json={"brief": "创作要求"})
    assert _case_text(case) == ""

def test_suite_reports_scorer_repeats_not_agent_attempts(session):
    suite = EvalSuite(name="trust scorer", format="manju", rubric_keys=["common.deai.no_summary"], trials_k=3)
    session.add(suite)
    session.commit()
    session.add(EvalCase(suite_id=suite.id, title="fixture", input_json={"score_text": "她推开门。"}))
    if not session.exec(select(EvalRubric).where(EvalRubric.key == "common.deai.no_summary")).first():
        session.add(EvalRubric(key="common.deai.no_summary", name="summary", question="无总结腔", grader="code", code_gate="DeAIChecklist", format="*", artifact_type="*"))
    session.commit()
    run = asyncio.run(run_suite(session, suite.id, include_llm=False))
    assert run.mode == "scorer_regression"
    assert run.metrics_json["agentExecutionCount"] == 0
    assert run.metrics_json["independentGenerationTrials"] == 0
    assert run.metrics_json["passAtK"] is None

def test_empty_candidate_cannot_pass_surface_checks(session):
    key = "trust.empty"
    session.add(EvalRubric(key=key, name=key, question="完整候选正文", grader="code", code_gate="DeAIChecklist", format="*", artifact_type="*"))
    session.commit()
    result = asyncio.run(score_text(session, "", rubric_keys=[key], include_llm=False))
    assert result["judgments"][0]["verdict"] == "unknown"
    assert result["passed"] is False


def test_unknown_coverage_cannot_inflate_release_gate():
    from app.eval.metrics import aggregate_run_metrics, compare_runs
    result = aggregate_run_metrics({"a": [False]}, ["pass", "unknown", "unknown"])
    assert result["passRate"] == pytest.approx(1/3)
    assert result["assessedPassRate"] == 1
    compared = compare_runs({"passRate": 1, "unknownRate": 0}, {"passRate": 1, "unknownRate": 1})
    assert compared["gateVerdict"] == "blocked"
    compared = compare_runs({"evaluationMode": "scorer_regression", "passRate": 1}, {"evaluationMode": "agent_run_evidence", "passRate": 1})
    assert compared["comparable"] is False


def test_completed_run_endpoint_pins_generated_version(session):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.models import AgentRun, Artifact, ArtifactVersion, Project, utcnow
    project = Project(user_id="test", title="evidence", format="manju", stage="S0_SETUP")
    session.add(project)
    session.commit()
    agent = AgentRun(project_id=project.id, agent_id="writer", status="succeeded", model="local-writer", token_prompt=91)
    session.add(agent)
    session.commit()
    art = Artifact(project_id=project.id, type="manuscript", title="candidate", created_by_run_id=None, body_markdown="后来用户改写的内容")
    session.add(art)
    session.commit()
    version = ArtifactVersion(artifact_id=art.id, version=1, title=art.title, status="draft", body_markdown="她推开门。", actor=f"agent:{agent.id}")
    session.add(version)
    session.commit()
    agent.output_artifact_ids = [art.id]
    agent.finished_at = utcnow()
    session.add(agent)
    session.commit()
    client = TestClient(app)
    response = client.post("/api/v1/eval/score-agent-run", headers={"X-User-Id": "test"}, json={"agentRunId": agent.id, "artifactVersionId": version.id, "includeLlm": False, "rubricKeys": ["common.deai.no_summary"]})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["evaluationMode"] == "agent_run_evidence"
    assert body["generationModel"] == "local-writer"
    from app.models import EvalTrial
    trial = session.get(EvalTrial, body["trialId"])
    assert trial.agent_run_id == agent.id
    assert trial.artifact_version_id == version.id
    assert trial.output_snapshot == "她推开门。"
    # An arbitrary version not produced by the run must not become its evidence.
    agent.output_artifact_ids = []
    session.add(agent)
    session.commit()
    response = client.post("/api/v1/eval/score-agent-run", headers={"X-User-Id": "test"}, json={"agentRunId": agent.id, "artifactVersionId": version.id})
    assert response.status_code == 422

def test_unknown_veto_or_human_review_cannot_clear_trial():
    from app.eval.metrics import aggregate_trial_score
    passed, score, detail = aggregate_trial_score([
        {"rubric_key": "surface", "verdict": "pass", "weight": 9},
        {"rubric_key": "human", "verdict": "unknown", "severity": "veto"},
    ])
    assert score > .7
    assert detail["unknownRate"] == .5
    assert passed is False


def test_pairwise_call_failure_is_unknown(session, monkeypatch):
    async def unavailable(*args, **kwargs):
        raise TimeoutError("local timeout")
    monkeypatch.setattr(llm_judge, "chat_completion", unavailable)
    out = asyncio.run(llm_judge.pairwise_judge(session, "正文甲", "正文乙"))
    assert out["winner"] == "unknown"

@pytest.mark.parametrize("key,text", [
    ("common.deai.no_summary", "老师说：“总而言之，先把门关上。”"),
    ("common.deai.no_summary", "老师：综上所述，这节课结束。"),
    ("common.deai.no_simile", "她划掉旧稿中的‘像一朵凋零的牡丹’，重新落笔。"),
])
def test_quoted_or_character_language_is_not_automatic_style_failure(key, text):
    assert _special_deai_rubric(rubric(key, "code"), text)[0] == "unknown"


def test_legacy_suite_threshold_uses_explicit_scorer_repeat_metric():
    from pathlib import Path
    from app.eval.metrics import gate_verdict_from_metrics
    suites = json.loads((Path(__file__).parents[1] / "app/eval/seeds/suites.json").read_text())
    suite = next(s for s in suites if "minPassHatK" in s["thresholds_json"])
    metrics = {"evaluationMode": "scorer_regression", "passRate": 1, "vetoHits": 0,
               "passHatK": None, "scorerPassHatK": 1}
    assert gate_verdict_from_metrics(metrics, suite["thresholds_json"]) == "pass"
    metrics["scorerPassHatK"] = 0
    assert gate_verdict_from_metrics(metrics, suite["thresholds_json"]) == "blocked"


def test_real_artifact_creation_version_can_be_used_as_run_evidence(session):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.models import AgentRun, ArtifactVersion, Project, utcnow
    from app.settings import get_settings
    project = Project(user_id=get_settings().demo_user_id, title="real evidence", format="manju", stage="S0_SETUP")
    session.add(project); session.commit()
    agent = AgentRun(project_id=project.id, agent_id="writer", status="running", model="local")
    session.add(agent); session.commit()
    client = TestClient(app)
    response = client.post(f"/api/v1/projects/{project.id}/artifacts", json={"type": "topic_card", "title": "generated", "bodyMarkdown": "她推开门。", "createdByRunId": agent.id})
    assert response.status_code == 200, response.text
    artifact_id = response.json()["id"]
    version = session.exec(select(ArtifactVersion).where(ArtifactVersion.artifact_id == artifact_id)).first()
    agent.status = "succeeded"; agent.finished_at = utcnow(); agent.output_artifact_ids = [artifact_id]
    session.add(agent); session.commit()
    response = client.post("/api/v1/eval/score-agent-run", json={"agentRunId": agent.id, "artifactVersionId": version.id, "includeLlm": False})
    assert response.status_code == 200, response.text
    assert response.json()["evaluationMode"] == "agent_run_evidence"
