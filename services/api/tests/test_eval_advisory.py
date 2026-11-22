"""Regression coverage for editorial suggestions and required evaluation evidence."""
import asyncio

import pytest
from sqlmodel import Session, SQLModel, create_engine, select

from app.eval.best_of_n import rank_candidates
from app.eval.feedback import prompt_fix_suggestions
from app.eval.graders import code
from app.eval.metrics import aggregate_trial_score, compare_runs
from app.eval.runner import run_suite
from app.eval.score import score_text
from app.eval.seed import seed_eval_rubrics
from app.models import EvalCase, EvalJudgment, EvalRubric, EvalRun, EvalSuite, EvalTrial, PreferencePair


@pytest.fixture
def session():
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


@pytest.mark.parametrize("signal", ["fail", "unknown"])
def test_required_subset(signal):
    required = [{"rubricKey": str(i), "verdict": "pass"} for i in range(9)]
    optional = [{"rubricKey": "style", "severity": "advisory", "verdict": signal}]
    passed, score, detail = aggregate_trial_score(required + optional)
    assert passed and score == 1 and detail["unknownRate"] == 0
    assert detail["advisoryByRubric"] == {"style": signal}
    assert aggregate_trial_score(optional)[2]["assessment"] == "not_assessed"
    for verdict, severity in [("unknown", "major"), ("fail", "veto")]:
        passed, _, detail = aggregate_trial_score(required + optional + [
            {"rubricKey": "required", "severity": severity, "verdict": verdict}])
        assert not passed
        assert detail["assessment"] == ("blocked" if severity == "veto" else "needs_review")


def test_pristine_upgrade_preserves_edited_rule_and_history(session):
    seed_eval_rubrics(session)
    rules = {r.key: r for r in session.exec(select(EvalRubric))}
    pristine = rules["common.deai.no_summary"]
    assert pristine.severity == "advisory" and pristine.version == 2
    pristine.guidance, pristine.severity, pristine.version = "出现总结词即失败。", "major", 1
    edited = rules["common.deai.no_simile"]
    edited.guidance, edited.severity, edited.version = "用户自定", "veto", 1
    snapshot = EvalRun(mode="scorer_regression", metrics_json={"evaluationSpecHash": "old"})
    session.add_all([pristine, edited, snapshot])
    session.commit()
    assert seed_eval_rubrics(session) == 1
    assert pristine.severity == "advisory" and pristine.version == 2
    assert (edited.guidance, edited.severity, edited.version) == ("用户自定", "veto", 1)
    assert seed_eval_rubrics(session) == 0
    assert snapshot.metrics_json == {"evaluationSpecHash": "old"}
    assert compare_runs(snapshot.metrics_json, {"scoringPolicy": "mandatory-subset-v1"})["gateVerdict"] == "not_comparable"


def test_detector_signal_does_not_become_required(session, monkeypatch):
    class Detector:
        async def detect(self, text):
            return {"score": .99, "verdict": "fail", "hits": ["河面"], "reasons": ["测试"]}

    monkeypatch.setattr(code, "get_detector", lambda: Detector())
    session.add(EvalRubric(key="detector", grader="code", name="测试", question="风格"))
    session.commit()
    out = asyncio.run(score_text(session, "河面像一张揉皱的车票", include_llm=False))
    assert out["detail"]["assessment"] == "not_assessed"
    judgment, = out["judgments"]
    assert judgment["verdict"] == "unknown" and judgment["evidenceQuote"] == "河面"
    assert "0.99" in judgment["reasoning"]


def test_optional_unknown_keeps_candidate_order_and_writes_no_preferences(session):
    seed_eval_rubrics(session)
    keep = {"common.deai.no_simile", "common.length_band_manju"}
    for row in session.exec(select(EvalRubric)):
        row.enabled = row.key in keep
        session.add(row)
    session.commit()
    out = asyncio.run(rank_candidates(session, [
        {"id": "original", "text": "河面像一张揉皱的车票。" + "水" * 850},
        {"id": "plain", "text": "水" * 860}], format="manju"))
    assert [r["id"] for r in out["ranked"]] == ["original", "plain"]
    assert all(r["passed"] and r["score"] == 1 and not r["failedRubrics"] for r in out["ranked"])
    assert out["ranked"][0]["advisoryJudgments"][0]["verdict"] == "unknown"
    assert not session.exec(select(PreferencePair)).all()


def test_negative_case_with_only_optional_failure(session, monkeypatch):
    from app.eval import score

    async def judge(session, rubrics, text, **kwargs):
        return [EvalJudgment(rubric_key=r.key, grader="llm", verdict="fail", evidence_quote=text,
                             trial_id=kwargs.get("trial_id")) for r in rubrics]

    monkeypatch.setattr(score, "grade_llm_batch", judge)
    rule = EvalRubric(key="style", name="风格", question="吸引力", severity="advisory")
    suite = EvalSuite(name="负样本", rubric_keys=["style"], thresholds_json={"expectFail": True}, trials_k=1)
    case = EvalCase(suite_id=suite.id, title="例", input_json={"score_text": "原稿"}, label="bad")
    session.add_all([rule, suite, case])
    session.commit()
    run = asyncio.run(run_suite(session, suite.id))
    assert run.gate_verdict == "not_assessed" and run.metrics_json["judgmentCount"] == 0
    assert run.metrics_json["advisoryJudgmentCount"] == 1 and run.metrics_json["scorerPassAtK"] == 0
    assert session.exec(select(EvalTrial)).one().passed is None
    assert session.exec(select(EvalJudgment)).one().verdict == "fail"
    assert not prompt_fix_suggestions(session)


@pytest.mark.parametrize(("key", "artifact_type", "context"), [
    ("duanju.beat20", "beat_sheet", {"beats": []}),
    ("duanju.midpoint", "beat_sheet", {"midpoint_index": 1}),
    ("duanju.paywall", "episode_outline", {"slots": []}),
    ("duanju.scene_triple", "manuscript", {"body": {"goal": "开门"}}),
])
def test_explicit_fields_are_required_but_words_are_not_evidence(session, key, artifact_type, context):
    seed_eval_rubrics(session)
    def assess(ctx):
        return asyncio.run(score_text(session, "突然翻脸，付费卡点，节拍1。", rubric_keys=[key],
                                      artifact_type=artifact_type, context=ctx, include_llm=False))
    missing = assess({})
    assert missing["detail"]["assessment"] == "not_assessed"
    assert missing["detail"]["advisoryByRubric"] == {key: "unknown"}
    measured = assess(context)
    assert key in measured["detail"]["byRubric"]
    assert not measured["passed"]


def test_lexical_risk_does_not_block_authorized_editorial_work(session):
    seed_eval_rubrics(session)
    for key, art in [("common.redline", "manuscript"), ("short.similarity", "swap_plan")]:
        result = asyncio.run(score_text(session, "人物在警局门口等车。", rubric_keys=[key],
                                       artifact_type=art, context={"similarity_score": 0.95}))
        assert result["detail"]["assessment"] == "not_assessed"
        assert key in result["detail"]["advisoryByRubric"]


def test_historical_lexical_failure_is_excluded_after_operator_makes_rule_required(session):
    seed_eval_rubrics(session)
    key = "common.deai.no_summary"
    row = session.exec(select(EvalRubric).where(EvalRubric.key == key)).one()
    row.severity, row.version = "veto", 3
    session.add(row)
    session.add(EvalJudgment(rubric_key=key, grader="code", verdict="fail", reasoning="出现总结词"))
    session.commit()
    assert not prompt_fix_suggestions(session)


def test_optional_failure_does_not_detect_bad_case_when_required_rule_passes(session, monkeypatch):
    from app.eval import score

    async def judge(session, rubrics, text, **kwargs):
        return [EvalJudgment(rubric_key=r.key, grader="llm", verdict="fail", trial_id=kwargs["trial_id"])
                for r in rubrics]

    monkeypatch.setattr(score, "grade_llm_batch", judge)
    rules = [EvalRubric(key="style", name="风格", question="吸引力", severity="advisory"),
             EvalRubric(key="length", name="长度", question="字数", grader="code", code_gate="LengthBand")]
    suite = EvalSuite(name="负样本", rubric_keys=["style", "length"], thresholds_json={"expectFail": True}, trials_k=1)
    session.add_all([*rules, suite, EvalCase(suite_id=suite.id, title="例",
                    input_json={"score_text": "水" * 900}, label="bad")])
    session.commit()
    run = asyncio.run(run_suite(session, suite.id))
    assert run.metrics_json["scorerPassAtK"] == 0
    assert run.metrics_json["passRate"] == 1
    assert run.metrics_json["advisoryJudgmentCount"] == run.metrics_json["judgmentCount"] == 1


@pytest.mark.parametrize("unassessed", [{"detail": {"assessment": "not_assessed"}, "passRate": None},
                                        {"judgmentCount": 0, "passRate": 0}])
def test_no_comparison_without_required_evidence(unassessed):
    assessed = {"judgmentCount": 2, "passRate": 1}
    for left, right in [(assessed, unassessed), (unassessed, assessed), (unassessed, unassessed)]:
        result = compare_runs(left, right)
        assert not result["comparable"] and result["gateVerdict"] == "not_comparable"
        assert result["regressions"] == []


def test_redline_pristine_upgrade_and_user_edits(session):
    seed_eval_rubrics(session)
    row = session.exec(select(EvalRubric).where(EvalRubric.key == "common.redline")).one()
    assert row.version == 3 and "上下文" in row.guidance
    for version, severity in [(1, "veto"), (2, "advisory")]:
        row.version, row.severity, row.guidance = version, severity, "命中红线词即一票否决。"
        session.add(row)
        session.commit()
        assert seed_eval_rubrics(session) == 1
        assert row.version == 3 and row.severity == "advisory" and "上下文" in row.guidance
        assert seed_eval_rubrics(session) == 0
    row.version, row.guidance = 2, "作者指定复核流程"
    session.add(row)
    session.commit()
    assert seed_eval_rubrics(session) == 0
    assert row.guidance == "作者指定复核流程"


def test_overview_uses_trial_scope_and_separates_legacy(session):
    from app.eval.metrics import SCORING_POLICY
    from app.routers.eval import overview

    run = EvalRun(mode="score_artifact", metrics_json={"scoringPolicy": SCORING_POLICY})
    trial = EvalTrial(eval_run_id=run.id, process_metrics={
        "assessment": "blocked", "advisoryKeys": ["former_advice", "duanju.scene_triple"]})
    required = EvalRubric(key="former_required", grader="code", name="必评", question="字段", severity="advisory")
    advice = EvalRubric(key="former_advice", grader="code", name="建议", question="措辞", severity="veto")
    session.add_all([run, trial, required, advice])
    for key in [required.key, advice.key, "duanju.scene_triple"]:
        session.add(EvalJudgment(rubric_key=key, grader="code", verdict="fail", trial_id=trial.id))
    session.add(EvalJudgment(rubric_key=advice.key, grader="code", verdict="fail"))
    session.commit()
    dashboard = overview(session)
    assert [r["rubricKey"] for r in dashboard["topFailingRubrics"]] == [required.key]
    assert dashboard["judgmentScopeCounts"] == {"required": 1, "advisory": 2, "unscoped": 1}
