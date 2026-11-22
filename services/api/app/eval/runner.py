"""离线回归运行器：评测沙箱 + k 次 trial + baseline 对比。"""

from __future__ import annotations

import hashlib
import json
import logging
from typing import Any

from sqlmodel import Session, select

from ..models import (
    Artifact,
    EvalCase,
    EvalJudgment,
    EvalRun,
    EvalSuite,
    EvalTrial,
    Project,
    new_id,
    utcnow,
)
from .config import get_eval_config
from .metrics import (
    aggregate_run_metrics,
    compare_runs,
    gate_verdict_from_metrics,
)
from .score import score_text, select_rubrics

logger = logging.getLogger("eval.runner")

SANDBOX_STATUS = "eval_sandbox"
DEMO_USER = "00000000-0000-4000-8000-000000000001"


def ensure_sandbox_project(session: Session, *, format: str, case_id: str) -> Project:
    title = f"[评测沙箱] {format}/{case_id[:8]}"
    existing = session.exec(
        select(Project).where(Project.status == SANDBOX_STATUS, Project.title == title)
    ).first()
    if existing:
        return existing
    project = Project(
        user_id=DEMO_USER,
        title=title,
        format=format if format != "*" else "manju",
        genre_tags=["eval"],
        market="cn",
        stage="S0_SETUP",
        status=SANDBOX_STATUS,
        progress={},
        cover_meta={"evalCaseId": case_id},
    )
    session.add(project)
    session.commit()
    session.refresh(project)
    return project


def _case_text(case: EvalCase) -> str:
    inp = case.input_json or {}
    if inp.get("score_text"):
        return str(inp["score_text"])
    return ""


async def run_suite(
    session: Session,
    suite_id: str,
    *,
    eval_run_id: str | None = None,
    variant: dict[str, Any] | None = None,
    trials_k: int | None = None,
    include_llm: bool = True,
    baseline_run_id: str | None = None,
) -> EvalRun:
    suite = session.get(EvalSuite, suite_id)
    if not suite:
        raise ValueError(f"suite not found: {suite_id}")

    run = session.get(EvalRun, eval_run_id) if eval_run_id else None
    if run is None:
        run = EvalRun(
            suite_id=suite_id,
            mode="scorer_regression",
            variant_json=dict(variant or {}),
            baseline_run_id=baseline_run_id,
            status="running",
        )
        session.add(run)
        session.commit()
        session.refresh(run)
    else:
        run.mode = "scorer_regression"
        run.status = "running"
        run.suite_id = suite_id
        if variant:
            run.variant_json = dict(variant)
        if baseline_run_id:
            run.baseline_run_id = baseline_run_id
        session.add(run)
        session.commit()

    cases = list(
        session.exec(
            select(EvalCase).where(EvalCase.suite_id == suite_id, EvalCase.enabled == True)  # noqa: E712
        ).all()
    )
    k = int(trials_k or suite.trials_k or 1)
    rubrics = select_rubrics(session, format=suite.format if suite.format != "*" else None, keys=list(suite.rubric_keys or []))
    if not rubrics and suite.rubric_keys:
        # keys may be stale; still try by key only
        rubrics = select_rubrics(session, keys=list(suite.rubric_keys or []))

    sev = {r.key: r.severity for r in rubrics}
    case_trials: dict[str, list[bool]] = {}
    advisory_count = 0
    all_verdicts: list[str] = []
    veto_hits = 0
    w_codes: list[str] = []
    total_steps = max(len(cases) * k, 1)
    done = 0

    for case in cases:
        text = _case_text(case)
        # materialize sandbox for traceability
        ensure_sandbox_project(session, format=suite.format, case_id=case.id)
        passed_list: list[bool] = []
        for ti in range(k):
            trial = EvalTrial(
                eval_run_id=run.id,
                case_id=case.id,
                trial_idx=ti,
                output_snapshot=text[:20000],
            )
            session.add(trial)
            session.commit()
            session.refresh(trial)

            ctx = dict(case.input_json or {})
            ctx["format"] = suite.format
            if "similarity_score" in (case.input_json or {}):
                ctx["similarity_score"] = case.input_json.get("similarity_score")
            if "path" in (case.input_json or {}):
                ctx["path"] = case.input_json.get("path")
            if "body" in (case.input_json or {}):
                ctx["body"] = case.input_json.get("body")

            # bad_case with expectFail: still score the provided text
            result = await score_text(
                session,
                text,
                format=suite.format,
                artifact_type=_infer_artifact_type(suite, rubrics),
                rubric_keys=list(suite.rubric_keys or []),
                reference=case.reference_markdown or None,
                context=ctx,
                trial_id=trial.id,
                include_llm=include_llm,
                persist=True,
            )
            trial.process_metrics = {**(trial.process_metrics or {}), "assessment": result["detail"]["assessment"],
                                     "advisoryKeys": list(result["detail"]["advisoryByRubric"])}
            trial.passed = None if result["detail"]["assessment"] == "not_assessed" else result["passed"]
            trial.score = float(result["score"])
            session.add(trial)
            session.commit()

            # For bad_case suite: "success" means we correctly detect failure on bad labels
            expect_fail = bool((suite.thresholds_json or {}).get("expectFail"))
            if expect_fail and case.label == "bad":
                # passed trial means graders found issues (score low / not passed)
                effective_pass = "fail" in result["detail"]["byRubric"].values()
            else:
                effective_pass = bool(result["passed"])
            if result["detail"]["byRubric"]:
                passed_list.append(effective_pass)

            for j in result.get("judgments") or []:
                if j["rubricKey"] not in result["detail"]["byRubric"]:
                    advisory_count += 1
                    continue
                all_verdicts.append(j.get("verdict") or "unknown")
                key = j.get("rubricKey") or ""
                for r in rubrics:
                    if r.key == key:
                        w_codes.extend(list(r.w_codes or []))
                        if r.severity == "veto" and j.get("verdict") == "fail":
                            if not (expect_fail and case.label == "bad"):
                                veto_hits += 1
                        break

            done += 1
            run.progress_pct = int(100 * done / total_steps)
            session.add(run)
            session.commit()

        if passed_list:
            case_trials[case.id] = passed_list

    metrics = aggregate_run_metrics(
        case_trials,
        all_verdicts,
        k=k,
        veto_hits=veto_hits,
        w_codes=w_codes,
    )
    # Repeated scoring of the same fixture measures grader stability, never
    # independent agent success probability.
    metrics["scorerPassAtK"] = metrics.pop("passAtK")
    metrics["scorerPassHatK"] = metrics.pop("passHatK")
    metrics.update({"evaluationMode": "scorer_regression", "agentExecutionCount": 0,
                    "independentGenerationTrials": 0, "passAtK": None, "passHatK": None,
                    "inputSource": "case.input_json.score_text", "generationModelApplied": False,
                    "missingCandidateCount": sum(not _case_text(c).strip() for c in cases)})
    from .metrics import SCORING_POLICY
    metrics.update(scoringPolicy=SCORING_POLICY, advisoryJudgmentCount=advisory_count)
    spec = {"scorerVersion": 3, "includeLlm": include_llm,
            "judgeModel": get_eval_config(session).get("judge_model"),
            "rubrics": [{k: getattr(r, k) for k in ("key", "version", "grader", "code_gate", "question", "guidance", "weight", "severity", "pass_example", "fail_example")} for r in sorted(rubrics, key=lambda r: r.key)],
            "cases": [{"id": c.id, "input": c.input_json, "reference": c.reference_markdown, "label": c.label} for c in sorted(cases, key=lambda c: c.id)]}
    metrics["evaluationSpecHash"] = hashlib.sha256(json.dumps(spec, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    if "minPassHatK" in (suite.thresholds_json or {}):
        metrics["thresholdMetricMapping"] = {"minPassHatK": "scorerPassHatK"}
    metrics["suiteId"] = suite_id
    metrics["suiteName"] = suite.name
    metrics["tier"] = suite.tier
    metrics["format"] = suite.format
    metrics["severities"] = sev

    verdict = gate_verdict_from_metrics(metrics, suite.thresholds_json or {})
    if run.baseline_run_id:
        baseline = session.get(EvalRun, run.baseline_run_id)
        if baseline and baseline.metrics_json:
            cfg = get_eval_config(session)
            tol = float(cfg.get("regression_tolerance") or 0.02)
            cmp = compare_runs(baseline.metrics_json, metrics, tolerance=tol)
            metrics["compare"] = cmp
            if cmp.get("gateVerdict") == "blocked":
                verdict = "blocked"

    run.metrics_json = metrics
    run.gate_verdict = verdict
    run.status = "succeeded"
    run.progress_pct = 100
    run.finished_at = utcnow()
    session.add(run)
    session.commit()
    session.refresh(run)
    return run


def _infer_artifact_type(suite: EvalSuite, rubrics: list) -> str:
    if suite.target_agent_id and "hook" in suite.target_agent_id:
        return "core_hook"
    types = [r.artifact_type for r in rubrics if getattr(r, "artifact_type", None)]
    if types:
        # most common
        return max(set(types), key=types.count)
    return "manuscript"


def build_run_matrix(session: Session, run_id: str) -> dict[str, Any]:
    """Case × Rubric 热力矩阵。"""
    run = session.get(EvalRun, run_id)
    if not run:
        raise ValueError("run not found")
    trials = list(session.exec(select(EvalTrial).where(EvalTrial.eval_run_id == run_id)).all())
    judgments = []
    for t in trials:
        judgments.extend(
            list(session.exec(select(EvalJudgment).where(EvalJudgment.trial_id == t.id)).all())
        )

    case_ids = sorted({t.case_id for t in trials if t.case_id})
    rubric_keys = sorted({j.rubric_key for j in judgments})
    # average verdict per case×rubric across trials
    from collections import defaultdict

    bucket: dict[tuple[str, str], list[str]] = defaultdict(list)
    trial_case = {t.id: t.case_id for t in trials}
    for j in judgments:
        cid = trial_case.get(j.trial_id or "")
        if not cid:
            continue
        bucket[(cid, j.rubric_key)].append(j.verdict)

    def majority(vs: list[str]) -> str:
        if not vs:
            return "unknown"
        return max(set(vs), key=vs.count)

    cells = []
    for cid in case_ids:
        for rk in rubric_keys:
            vs = bucket.get((cid, rk), [])
            cells.append(
                {
                    "caseId": cid,
                    "rubricKey": rk,
                    "verdict": majority(vs),
                    "trials": len(vs),
                }
            )

    cases = {
        c.id: {"id": c.id, "title": c.title, "label": c.label}
        for c in session.exec(select(EvalCase).where(EvalCase.id.in_(case_ids))).all()
    } if case_ids else {}

    return {
        "runId": run_id,
        "status": run.status,
        "gateVerdict": run.gate_verdict,
        "metrics": run.metrics_json,
        "caseIds": case_ids,
        "rubricKeys": rubric_keys,
        "cases": cases,
        "cells": cells,
        "trials": [
            {
                "id": t.id,
                "caseId": t.case_id,
                "trialIdx": t.trial_idx,
                "passed": t.passed,
                "score": t.score,
            }
            for t in trials
        ],
    }


# re-export helpers
__all__ = [
    "SANDBOX_STATUS",
    "ensure_sandbox_project",
    "run_suite",
    "build_run_matrix",
    "new_id",
]


async def score_agent_run_evidence(
    session: Session,
    agent_run_id: str,
    artifact_version_id: str,
    *,
    user_id: str,
    rubric_keys: list[str] | None = None,
    include_llm: bool = False,
) -> dict[str, Any]:
    """Assess an immutable output from a completed run; never launches generation.

    This is observed-run evidence, not a controlled suite execution or an estimate
    of independent pass@k. Repeated calls reuse the same generation provenance.
    """
    from ..models import AgentRun, ArtifactVersion
    from .metrics import process_metrics_from_run

    source = session.get(AgentRun, agent_run_id)
    version = session.get(ArtifactVersion, artifact_version_id)
    if not source or not version:
        raise ValueError("agent run or artifact version not found")
    artifact = session.get(Artifact, version.artifact_id)
    if source.status != "succeeded" or not source.finished_at:
        raise ValueError("only completed successful agent runs can supply evidence")
    if (not artifact or artifact.id not in (source.output_artifact_ids or [])
            or artifact.project_id != source.project_id):
        raise ValueError("artifact is not a verified output of this agent run")
    # A later manual revision cannot be relabelled as the model's generation.
    if (version.actor != f"agent:{source.id}"
            or version.created_at.replace(tzinfo=None) < source.created_at.replace(tzinfo=None)
            or version.created_at.replace(tzinfo=None) > source.finished_at.replace(tzinfo=None)):
        raise ValueError("version provenance is outside the agent execution")
    text = version.body_markdown or (json.dumps(version.body_json, ensure_ascii=False) if version.body_json else "")
    if not text.strip():
        raise ValueError("generated version has no candidate text")
    project = session.get(Project, artifact.project_id)
    if not project or project.user_id != user_id:
        raise ValueError("project_boundary:agent_run")
    fmt = project.format
    process = process_metrics_from_run(gate_results=source.gate_results,
        token_prompt=source.token_prompt, token_completion=source.token_completion)
    process.update({"generationModel": source.model, "agentRunId": source.id,
                    "outputSha256": hashlib.sha256(text.encode()).hexdigest(),
                    "snapshotChars": len(text), "snapshotComplete": True})
    run = EvalRun(mode="agent_run_evidence", status="running", variant_json={
        "agentRunId": source.id, "artifactVersionId": version.id,
        "generationModel": source.model, "launchesGeneration": False})
    session.add(run)
    session.commit()
    trial = EvalTrial(eval_run_id=run.id, agent_run_id=source.id,
        artifact_id=artifact.id, artifact_version_id=version.id,
        output_snapshot=text, process_metrics=process, cost=source.token_prompt + source.token_completion)
    session.add(trial)
    session.commit()
    result = await score_text(session, text, format=fmt, artifact_type=artifact.type,
        rubric_keys=rubric_keys, context={"format": fmt, "body_json": version.body_json},
        artifact_id=artifact.id, artifact_version_id=version.id, trial_id=trial.id,
        include_llm=include_llm)
    trial.process_metrics = {**(trial.process_metrics or {}), "assessment": result["detail"]["assessment"],
                             "advisoryKeys": list(result["detail"]["advisoryByRubric"])}
    trial.passed = None if result["detail"]["assessment"] == "not_assessed" else result["passed"]
    trial.score = result["score"]
    run.metrics_json = {"evaluationMode": "agent_run_evidence", "detail": result["detail"],
        "scoringPolicy": result["detail"]["scoringPolicy"], "generationModel": source.model,
        "agentExecutionCount": 1, "independentGenerationTrials": None,
        "passAtK": None, "passHatK": None, "score": result["score"],
        "unknownRate": result["detail"]["unknownRate"], "process": process,
        "sampling": "observed completed run; repeated assessments reuse generation"}
    run.status = "succeeded"
    run.progress_pct = 100
    run.finished_at = utcnow()
    run.gate_verdict = result["detail"]["assessment"]
    session.add(trial)
    session.add(run)
    session.commit()
    return {**result, "evalRunId": run.id, "trialId": trial.id,
            "evaluationMode": run.mode, "generationModel": source.model,
            "agentRunId": source.id, "artifactVersionId": version.id,
            "launchesGeneration": False, "process": process}
