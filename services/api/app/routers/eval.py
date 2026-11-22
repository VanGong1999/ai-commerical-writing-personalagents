"""Agent Eval API：评分细则 / 评测集 / 运行 / Case 池 / 标注 / 总览。"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from ..settings import get_settings
from ..db import get_session
from ..models import (
    Artifact,
    EvalCase,
    EvalCaseCandidate,
    EvalJudgment,
    EvalRubric,
    EvalRun,
    EvalSuite,
    EvalTrial,
    Job,
    Project,
    utcnow,
)
from ..queue import enqueue_job
from ..eval.config import (
    eval_tokens_used_this_month,
    get_eval_config,
    put_eval_config,
)
from ..eval.graders.human import serialize_judgment, submit_human_judgment
from ..eval.graders.llm_judge import pairwise_judge
from ..eval.metrics import (
    SCORING_POLICY,
    cohens_kappa,
    maturity_self_check,
    raw_agreement,
    rubric_failure_ranking,
)
from ..eval.online import (
    emit_case_signal,
    list_case_pool,
    triage_candidate,
)
from ..eval.attribution import suggest_attribution
from ..eval.best_of_n import rank_candidates, record_unpicked_pairs
from ..eval.feedback import (
    REASON_TAG_OPTIONS,
    create_feedback,
    create_preference,
    export_grpo_prompts,
    export_preferences_dpo,
    feedback_out,
    list_feedback,
    list_preferences,
    preference_out,
    prompt_fix_suggestions,
    select_exemplars,
)
from ..eval.runner import SANDBOX_STATUS, build_run_matrix, run_suite, score_agent_run_evidence
from ..eval.score import score_artifact, score_text
from ..eval.seed import ensure_eval_seeds

router = APIRouter(prefix="/eval", tags=["eval"])


# ─── serializers ─────────────────────────────────────────────────────────────


def _rubric_out(r: EvalRubric) -> dict[str, Any]:
    return {
        "id": r.id,
        "key": r.key,
        "name": r.name,
        "format": r.format,
        "artifactType": r.artifact_type,
        "source": r.source,
        "sourceRef": r.source_ref,
        "grader": r.grader,
        "codeGate": r.code_gate,
        "question": r.question,
        "guidance": r.guidance,
        "severity": r.severity,
        "weight": r.weight,
        "wCodes": r.w_codes,
        "passExample": r.pass_example,
        "failExample": r.fail_example,
        "version": r.version,
        "enabled": r.enabled,
        "updatedAt": r.updated_at.isoformat() if r.updated_at else None,
    }


def _suite_out(s: EvalSuite, case_count: int | None = None) -> dict[str, Any]:
    return {
        "id": s.id,
        "name": s.name,
        "kind": s.kind,
        "tier": s.tier,
        "format": s.format,
        "targetAgentId": s.target_agent_id,
        "pipeline": s.pipeline,
        "rubricKeys": s.rubric_keys,
        "trialsK": s.trials_k,
        "thresholds": s.thresholds_json,
        "description": s.description,
        "enabled": s.enabled,
        "caseCount": case_count,
    }


def _case_out(c: EvalCase) -> dict[str, Any]:
    return {
        "id": c.id,
        "suiteId": c.suite_id,
        "title": c.title,
        "inputJson": c.input_json,
        "referenceMarkdown": c.reference_markdown,
        "expectedBehavior": c.expected_behavior,
        "label": c.label,
        "tags": c.tags,
        "origin": c.origin,
        "sourceRef": c.source_ref,
        "enabled": c.enabled,
    }


def _run_out(r: EvalRun) -> dict[str, Any]:
    return {
        "id": r.id,
        "suiteId": r.suite_id,
        "mode": r.mode,
        "variant": r.variant_json,
        "baselineRunId": r.baseline_run_id,
        "status": r.status,
        "metrics": r.metrics_json,
        "gateVerdict": r.gate_verdict,
        "tokenCost": r.token_cost,
        "jobId": r.job_id,
        "progressPct": r.progress_pct,
        "error": r.error,
        "createdAt": r.created_at.isoformat() if r.created_at else None,
        "finishedAt": r.finished_at.isoformat() if r.finished_at else None,
    }


def _candidate_out(c: EvalCaseCandidate) -> dict[str, Any]:
    return {
        "id": c.id,
        "artifactId": c.artifact_id,
        "artifactVersion": c.artifact_version,
        "projectId": c.project_id,
        "agentRunId": c.agent_run_id,
        "signal": c.signal,
        "attribution": c.attribution,
        "attributionSuggestion": c.attribution_suggestion,
        "fixSuggestion": c.fix_suggestion,
        "status": c.status,
        "detail": c.detail,
        "createdAt": c.created_at.isoformat() if c.created_at else None,
        "updatedAt": c.updated_at.isoformat() if c.updated_at else None,
    }


# ─── request bodies ──────────────────────────────────────────────────────────


class RubricPatch(BaseModel):
    name: Optional[str] = None
    question: Optional[str] = None
    guidance: Optional[str] = None
    severity: Optional[str] = None
    weight: Optional[float] = None
    pass_example: Optional[str] = Field(None, alias="passExample")
    fail_example: Optional[str] = Field(None, alias="failExample")
    enabled: Optional[bool] = None
    w_codes: Optional[list[str]] = Field(None, alias="wCodes")

    model_config = {"populate_by_name": True}


class SuiteCreate(BaseModel):
    name: str
    kind: str = "process"
    tier: str = "regression"
    format: str = "*"
    target_agent_id: Optional[str] = Field(None, alias="targetAgentId")
    pipeline: Optional[str] = None
    rubric_keys: list[str] = Field(default_factory=list, alias="rubricKeys")
    trials_k: int = Field(1, alias="trialsK")
    thresholds: dict[str, Any] = Field(default_factory=dict)
    description: str = ""

    model_config = {"populate_by_name": True}


class CaseCreate(BaseModel):
    title: str = ""
    input_json: dict[str, Any] = Field(default_factory=dict, alias="inputJson")
    reference_markdown: str = Field("", alias="referenceMarkdown")
    expected_behavior: str = Field("", alias="expectedBehavior")
    label: str = "good"
    tags: list[str] = Field(default_factory=list)
    origin: str = "manual"
    source_ref: str = Field("", alias="sourceRef")

    model_config = {"populate_by_name": True}


class CaseFromArtifact(BaseModel):
    artifact_id: str = Field(alias="artifactId")
    suite_id: str = Field(alias="suiteId")
    label: str = "good"
    title: Optional[str] = None

    model_config = {"populate_by_name": True}


class RunCreate(BaseModel):
    suite_id: str = Field(alias="suiteId")
    variant: dict[str, Any] = Field(default_factory=dict)
    trials_k: Optional[int] = Field(None, alias="trialsK")
    baseline_run_id: Optional[str] = Field(None, alias="baselineRunId")
    include_llm: bool = Field(True, alias="includeLlm")
    async_mode: bool = Field(True, alias="async")

    model_config = {"populate_by_name": True}


class ScoreAgentRunIn(BaseModel):
    agent_run_id: str = Field(alias="agentRunId")
    artifact_version_id: str = Field(alias="artifactVersionId")
    rubric_keys: Optional[list[str]] = Field(None, alias="rubricKeys")
    include_llm: bool = Field(False, alias="includeLlm")

    model_config = {"populate_by_name": True}


class ScoreArtifactIn(BaseModel):
    artifact_id: Optional[str] = Field(None, alias="artifactId")
    text: Optional[str] = None
    format: str = "*"
    artifact_type: str = Field("manuscript", alias="artifactType")
    rubric_keys: Optional[list[str]] = Field(None, alias="rubricKeys")
    include_llm: bool = Field(True, alias="includeLlm")
    reference: Optional[str] = None

    model_config = {"populate_by_name": True}


class TriageIn(BaseModel):
    status: str
    attribution: Optional[str] = None
    suite_id: Optional[str] = Field(None, alias="suiteId")

    model_config = {"populate_by_name": True}


class AnnotateIn(BaseModel):
    rubric_key: str = Field(alias="rubricKey")
    verdict: str
    trial_id: Optional[str] = Field(None, alias="trialId")
    artifact_id: Optional[str] = Field(None, alias="artifactId")
    evidence_quote: str = Field("", alias="evidenceQuote")
    reasoning: str = ""
    annotator: str = "user"
    blind: bool = True

    model_config = {"populate_by_name": True}


class PairwiseIn(BaseModel):
    text_a: str = Field(alias="textA")
    text_b: str = Field(alias="textB")
    criteria: Optional[list[str]] = None

    model_config = {"populate_by_name": True}


class FlagArtifactIn(BaseModel):
    artifact_id: str = Field(alias="artifactId")
    project_id: Optional[str] = Field(None, alias="projectId")
    good: bool = True

    model_config = {"populate_by_name": True}


class ConfigIn(BaseModel):
    judge_model: Optional[str] = Field(None, alias="judgeModel")
    monthly_budget_tokens: Optional[int] = Field(None, alias="monthlyBudgetTokens")
    online_sample_rate: Optional[float] = Field(None, alias="onlineSampleRate")
    auto_revise_enabled: Optional[bool] = Field(None, alias="autoReviseEnabled")
    auto_revise_threshold: Optional[float] = Field(None, alias="autoReviseThreshold")
    regression_tolerance: Optional[float] = Field(None, alias="regressionTolerance")

    model_config = {"populate_by_name": True}


# ─── seed / config ────────────────────────────────────────────────────────────


@router.post("/seed")
def seed_eval(session: Session = Depends(get_session)) -> dict[str, Any]:
    return ensure_eval_seeds(session)


@router.get("/config")
def get_config(session: Session = Depends(get_session)) -> dict[str, Any]:
    cfg = get_eval_config(session)
    used = eval_tokens_used_this_month(session)
    return {
        **{ _camel(k): v for k, v in cfg.items() },
        "tokensUsedThisMonth": used,
        "budgetRemaining": max(0, int(cfg.get("monthly_budget_tokens") or 0) - used),
    }


def _camel(k: str) -> str:
    parts = k.split("_")
    return parts[0] + "".join(p.title() for p in parts[1:])


@router.put("/config")
def put_config(body: ConfigIn, session: Session = Depends(get_session)) -> dict[str, Any]:
    patch = {k: v for k, v in body.model_dump(by_alias=False).items() if v is not None}
    cfg = put_eval_config(session, patch)
    return { _camel(k): v for k, v in cfg.items() }


# ─── rubrics ──────────────────────────────────────────────────────────────────


@router.get("/rubrics")
def list_rubrics(
    format: str | None = None,
    artifact_type: str | None = Query(None, alias="artifactType"),
    grader: str | None = None,
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    ensure_eval_seeds(session)
    rows = list(session.exec(select(EvalRubric).order_by(EvalRubric.format, EvalRubric.key)).all())
    if format:
        rows = [r for r in rows if r.format in {"*", format}]
    if artifact_type:
        rows = [r for r in rows if r.artifact_type == artifact_type]
    if grader:
        rows = [r for r in rows if r.grader == grader]
    return {"rubrics": [_rubric_out(r) for r in rows], "count": len(rows)}


@router.patch("/rubrics/{key}")
def patch_rubric(key: str, body: RubricPatch, session: Session = Depends(get_session)) -> dict[str, Any]:
    row = session.exec(select(EvalRubric).where(EvalRubric.key == key)).first()
    if not row:
        raise HTTPException(404, "rubric not found")
    data = body.model_dump(by_alias=False, exclude_none=True)
    for k, v in data.items():
        setattr(row, k, v)
    row.version = int(row.version or 1) + 1
    row.updated_at = utcnow()
    session.add(row)
    session.commit()
    session.refresh(row)
    return _rubric_out(row)


@router.get("/rubrics/{key}/stats")
def rubric_stats(key: str, session: Session = Depends(get_session)) -> dict[str, Any]:
    js = list(session.exec(select(EvalJudgment).where(EvalJudgment.rubric_key == key)).all())
    total = len(js) or 1
    machine = [j for j in js if j.grader in {"code", "llm"}]
    human = [j for j in js if j.grader == "human"]
    # pair by trial_id+rubric for agreement
    human_by_trial = {(j.trial_id or j.artifact_id or j.id): j.verdict for j in human}
    machine_by_trial = {(j.trial_id or j.artifact_id or j.id): j.verdict for j in machine}
    keys = [k for k in human_by_trial if k in machine_by_trial]
    a = [human_by_trial[k] for k in keys]
    b = [machine_by_trial[k] for k in keys]
    return {
        "rubricKey": key,
        "total": len(js),
        "passRate": sum(1 for j in js if j.verdict == "pass") / total,
        "failRate": sum(1 for j in js if j.verdict == "fail") / total,
        "unknownRate": sum(1 for j in js if j.verdict == "unknown") / total,
        "humanMachineAgreement": raw_agreement(a, b) if keys else None,
        "cohenKappa": cohens_kappa(a, b) if keys else None,
        "pairedCount": len(keys),
    }


# ─── suites / cases ───────────────────────────────────────────────────────────


@router.get("/suites")
def list_suites(
    format: str | None = None,
    tier: str | None = None,
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    ensure_eval_seeds(session)
    rows = list(session.exec(select(EvalSuite).order_by(EvalSuite.tier, EvalSuite.name)).all())
    if format:
        rows = [s for s in rows if s.format in {"*", format}]
    if tier:
        rows = [s for s in rows if s.tier == tier]
    out = []
    for s in rows:
        cnt = len(list(session.exec(select(EvalCase).where(EvalCase.suite_id == s.id)).all()))
        out.append(_suite_out(s, cnt))
    return {"suites": out, "count": len(out)}


@router.post("/suites")
def create_suite(body: SuiteCreate, session: Session = Depends(get_session)) -> dict[str, Any]:
    s = EvalSuite(
        name=body.name,
        kind=body.kind,
        tier=body.tier,
        format=body.format,
        target_agent_id=body.target_agent_id,
        pipeline=body.pipeline,
        rubric_keys=body.rubric_keys,
        trials_k=body.trials_k,
        thresholds_json=body.thresholds,
        description=body.description,
    )
    session.add(s)
    session.commit()
    session.refresh(s)
    return _suite_out(s, 0)


@router.get("/suites/{suite_id}/cases")
def list_cases(suite_id: str, session: Session = Depends(get_session)) -> dict[str, Any]:
    if not session.get(EvalSuite, suite_id):
        raise HTTPException(404, "suite not found")
    rows = list(session.exec(select(EvalCase).where(EvalCase.suite_id == suite_id)).all())
    return {"cases": [_case_out(c) for c in rows], "count": len(rows)}


@router.post("/suites/{suite_id}/cases")
def create_case(suite_id: str, body: CaseCreate, session: Session = Depends(get_session)) -> dict[str, Any]:
    if not session.get(EvalSuite, suite_id):
        raise HTTPException(404, "suite not found")
    c = EvalCase(
        suite_id=suite_id,
        title=body.title,
        input_json=body.input_json,
        reference_markdown=body.reference_markdown,
        expected_behavior=body.expected_behavior,
        label=body.label,
        tags=body.tags,
        origin=body.origin,
        source_ref=body.source_ref,
    )
    session.add(c)
    session.commit()
    session.refresh(c)
    return _case_out(c)


@router.post("/cases/from-artifact")
def case_from_artifact(body: CaseFromArtifact, session: Session = Depends(get_session)) -> dict[str, Any]:
    art = session.get(Artifact, body.artifact_id)
    if not art:
        raise HTTPException(404, "artifact not found")
    if not session.get(EvalSuite, body.suite_id):
        raise HTTPException(404, "suite not found")
    c = EvalCase(
        suite_id=body.suite_id,
        title=body.title or art.title or f"artifact {art.id[:8]}",
        input_json={"score_text": art.body_markdown or ""},
        reference_markdown=art.body_markdown or "",
        expected_behavior="从生产产物导入",
        label=body.label,
        origin="production",
        source_ref=f"artifact:{art.id}@v{art.version}",
    )
    session.add(c)
    session.commit()
    session.refresh(c)
    return _case_out(c)


# ─── runs ─────────────────────────────────────────────────────────────────────


@router.post("/score-agent-run")
async def score_completed_agent_run(body: ScoreAgentRunIn, session: Session = Depends(get_session),
                                    x_user_id: str | None = Header(default=None, alias="X-User-Id")) -> dict[str, Any]:
    try:
        return await score_agent_run_evidence(session, body.agent_run_id, body.artifact_version_id,
            user_id=x_user_id or get_settings().demo_user_id,
            rubric_keys=body.rubric_keys, include_llm=body.include_llm)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/runs")
async def create_run(body: RunCreate, session: Session = Depends(get_session)) -> dict[str, Any]:
    suite = session.get(EvalSuite, body.suite_id)
    if not suite:
        raise HTTPException(404, "suite not found")
    run = EvalRun(
        suite_id=body.suite_id,
        mode="scorer_regression",
        variant_json=body.variant,
        baseline_run_id=body.baseline_run_id,
        status="queued",
    )
    session.add(run)
    session.commit()
    session.refresh(run)

    if body.async_mode:
        job = Job(
            type="eval.run",
            payload={
                "suiteId": body.suite_id,
                "evalRunId": run.id,
                "variant": body.variant,
                "trialsK": body.trials_k,
                "baselineRunId": body.baseline_run_id,
                "includeLlm": body.include_llm,
            },
            user_id="eval",
            status="queued",
        )
        session.add(job)
        session.commit()
        session.refresh(job)
        run.job_id = job.id
        run.status = "queued"
        session.add(run)
        session.commit()
        enqueue_job(job.id, {"type": job.type, "payload": job.payload})
        session.refresh(run)
        return _run_out(run)

    # sync path (tests / small suites)
    run = await run_suite(
        session,
        body.suite_id,
        eval_run_id=run.id,
        variant=body.variant,
        trials_k=body.trials_k,
        include_llm=body.include_llm,
        baseline_run_id=body.baseline_run_id,
    )
    return _run_out(run)


@router.get("/runs")
def list_runs(
    suite_id: str | None = Query(None, alias="suiteId"),
    limit: int = 30,
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    rows = list(session.exec(select(EvalRun).order_by(EvalRun.created_at.desc()).limit(limit)).all())
    if suite_id:
        rows = [r for r in rows if r.suite_id == suite_id]
    return {"runs": [_run_out(r) for r in rows], "count": len(rows)}


@router.get("/runs/{run_id}")
def get_run(run_id: str, session: Session = Depends(get_session)) -> dict[str, Any]:
    run = session.get(EvalRun, run_id)
    if not run:
        raise HTTPException(404, "run not found")
    matrix = build_run_matrix(session, run_id)
    return {**_run_out(run), "matrix": matrix}


@router.get("/runs/{run_id}/compare/{baseline_id}")
def compare_run(run_id: str, baseline_id: str, session: Session = Depends(get_session)) -> dict[str, Any]:
    from ..eval.metrics import compare_runs
    from ..eval.config import get_eval_config as _cfg

    a = session.get(EvalRun, run_id)
    b = session.get(EvalRun, baseline_id)
    if not a or not b:
        raise HTTPException(404, "run not found")
    tol = float(_cfg(session).get("regression_tolerance") or 0.02)
    return {
        "candidate": _run_out(a),
        "baseline": _run_out(b),
        "compare": compare_runs(b.metrics_json or {}, a.metrics_json or {}, tolerance=tol),
    }


@router.get("/trials/{trial_id}")
def get_trial(trial_id: str, session: Session = Depends(get_session)) -> dict[str, Any]:
    t = session.get(EvalTrial, trial_id)
    if not t:
        raise HTTPException(404, "trial not found")
    judgments = list(session.exec(select(EvalJudgment).where(EvalJudgment.trial_id == trial_id)).all())
    return {
        "id": t.id,
        "evalRunId": t.eval_run_id,
        "caseId": t.case_id,
        "trialIdx": t.trial_idx,
        "agentRunId": t.agent_run_id,
        "artifactId": t.artifact_id,
        "outputSnapshot": t.output_snapshot,
        "passed": t.passed,
        "score": t.score,
        "cost": t.cost,
        "processMetrics": t.process_metrics,
        "judgments": [serialize_judgment(j) for j in judgments],
    }


@router.post("/trials/{trial_id}/override")
def override_judgment(
    trial_id: str,
    body: AnnotateIn,
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    if not session.get(EvalTrial, trial_id):
        raise HTTPException(404, "trial not found")
    j = submit_human_judgment(
        session,
        rubric_key=body.rubric_key,
        verdict=body.verdict,
        trial_id=trial_id,
        artifact_id=body.artifact_id,
        evidence_quote=body.evidence_quote,
        reasoning=body.reasoning or "人工推翻机评",
        annotator=body.annotator,
        blind=False,
    )
    return serialize_judgment(j)


# ─── score artifact ───────────────────────────────────────────────────────────


@router.post("/score-artifact")
async def score_artifact_api(body: ScoreArtifactIn, session: Session = Depends(get_session)) -> dict[str, Any]:
    ensure_eval_seeds(session)
    if body.artifact_id:
        try:
            return await score_artifact(
                session,
                body.artifact_id,
                rubric_keys=body.rubric_keys,
                include_llm=body.include_llm,
                create_run=True,
            )
        except ValueError as exc:
            raise HTTPException(404, str(exc)) from exc
    if not body.text:
        raise HTTPException(400, "artifactId or text required")
    return await score_text(
        session,
        body.text,
        format=body.format,
        artifact_type=body.artifact_type,
        rubric_keys=body.rubric_keys,
        reference=body.reference,
        include_llm=body.include_llm,
        persist=True,
    )


# ─── case pool ────────────────────────────────────────────────────────────────


@router.get("/case-pool")
def case_pool(
    status: str | None = None,
    signal: str | None = None,
    limit: int = 50,
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    rows = list_case_pool(session, status=status, signal=signal, limit=limit)
    return {"candidates": [_candidate_out(c) for c in rows], "count": len(rows)}


@router.post("/case-pool/{candidate_id}/triage")
def triage(candidate_id: str, body: TriageIn, session: Session = Depends(get_session)) -> dict[str, Any]:
    try:
        row = triage_candidate(
            session,
            candidate_id,
            status=body.status,
            attribution=body.attribution,
            suite_id=body.suite_id,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return _candidate_out(row)


@router.post("/case-pool/{candidate_id}/attribute")
async def attribute(candidate_id: str, session: Session = Depends(get_session)) -> dict[str, Any]:
    try:
        row = await suggest_attribution(session, candidate_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    return _candidate_out(row)


@router.post("/case-pool/flag")
def flag_artifact(body: FlagArtifactIn, session: Session = Depends(get_session)) -> dict[str, Any]:
    row = emit_case_signal(
        session,
        signal="user_flag_good" if body.good else "user_flag_bad",
        artifact_id=body.artifact_id,
        project_id=body.project_id,
    )
    return _candidate_out(row)


# ─── annotate / agreement ─────────────────────────────────────────────────────


@router.get("/annotate/queue")
def annotate_queue(
    limit: int = 20,
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """盲标队列：取最近有机评、尚无人工标注的 judgment。"""
    machine = list(
        session.exec(
            select(EvalJudgment)
            .where(EvalJudgment.grader.in_(["code", "llm"]))  # type: ignore[arg-type]
            .order_by(EvalJudgment.created_at.desc())
            .limit(200)
        ).all()
    )
    human_keys = {
        (j.trial_id, j.rubric_key)
        for j in session.exec(select(EvalJudgment).where(EvalJudgment.grader == "human")).all()
    }
    queue = []
    for j in machine:
        key = (j.trial_id, j.rubric_key)
        if key in human_keys:
            continue
        rubric = session.exec(select(EvalRubric).where(EvalRubric.key == j.rubric_key)).first()
        trial = session.get(EvalTrial, j.trial_id) if j.trial_id else None
        queue.append(
            {
                "judgmentId": j.id,
                "trialId": j.trial_id,
                "artifactId": j.artifact_id,
                "rubricKey": j.rubric_key,
                "question": rubric.question if rubric else j.rubric_key,
                "outputPreview": (trial.output_snapshot[:800] if trial else ""),
                # blind: hide machine verdict
            }
        )
        if len(queue) >= limit:
            break
    return {"queue": queue, "count": len(queue)}


@router.post("/annotate")
def annotate(body: AnnotateIn, session: Session = Depends(get_session)) -> dict[str, Any]:
    j = submit_human_judgment(
        session,
        rubric_key=body.rubric_key,
        verdict=body.verdict,
        trial_id=body.trial_id,
        artifact_id=body.artifact_id,
        evidence_quote=body.evidence_quote,
        reasoning=body.reasoning,
        annotator=body.annotator,
        blind=body.blind,
    )
    return serialize_judgment(j)


@router.get("/agreement")
def agreement(session: Session = Depends(get_session)) -> dict[str, Any]:
    machine = list(session.exec(select(EvalJudgment).where(EvalJudgment.grader.in_(["code", "llm"]))).all())  # type: ignore[arg-type]
    human = list(session.exec(select(EvalJudgment).where(EvalJudgment.grader == "human")).all())
    m_map = {(j.trial_id or j.artifact_id, j.rubric_key): j.verdict for j in machine}
    h_map = {(j.trial_id or j.artifact_id, j.rubric_key): j.verdict for j in human}
    keys = [k for k in h_map if k in m_map]
    a = [h_map[k] for k in keys]
    b = [m_map[k] for k in keys]
    # human-human: group by rubric+trial with multiple annotators — simplified skip
    by_rubric: dict[str, list[tuple[str, str]]] = {}
    for k in keys:
        rk = k[1]
        by_rubric.setdefault(rk, []).append((h_map[k], m_map[k]))
    per_rubric = []
    for rk, pairs in by_rubric.items():
        ha = [p[0] for p in pairs]
        ma = [p[1] for p in pairs]
        per_rubric.append(
            {
                "rubricKey": rk,
                "agreement": raw_agreement(ha, ma),
                "kappa": cohens_kappa(ha, ma),
                "n": len(pairs),
                "needsRewrite": raw_agreement(ha, ma) < 0.85,
            }
        )
    per_rubric.sort(key=lambda x: x["agreement"])
    return {
        "pairedCount": len(keys),
        "humanMachineAgreement": raw_agreement(a, b) if keys else None,
        "cohenKappa": cohens_kappa(a, b) if keys else None,
        "perRubric": per_rubric,
    }


# ─── pairwise ─────────────────────────────────────────────────────────────────


@router.post("/pairwise")
async def pairwise(body: PairwiseIn, session: Session = Depends(get_session)) -> dict[str, Any]:
    return await pairwise_judge(session, body.text_a, body.text_b, criteria=body.criteria)


# ─── overview / feedback ──────────────────────────────────────────────────────


@router.get("/overview")
def overview(session: Session = Depends(get_session)) -> dict[str, Any]:
    ensure_eval_seeds(session)
    rubrics = list(session.exec(select(EvalRubric)).all())
    suites = list(session.exec(select(EvalSuite)).all())
    runs = list(session.exec(select(EvalRun).order_by(EvalRun.created_at.desc()).limit(50)).all())
    candidates = list(session.exec(select(EvalCaseCandidate).limit(100)).all())
    judgments = session.exec(
        select(EvalJudgment, EvalTrial.process_metrics, EvalRun.metrics_json["scoringPolicy"].as_string())
        .outerjoin(EvalTrial, EvalJudgment.trial_id == EvalTrial.id)
        .outerjoin(EvalRun, EvalTrial.eval_run_id == EvalRun.id)
        .order_by(EvalJudgment.created_at.desc()).limit(1000)
    ).all()

    # scorecards by format from recent offline runs
    scorecards: dict[str, Any] = {}
    for r in runs:
        if r.status != "succeeded" or not r.metrics_json:
            continue
        fmt = (r.metrics_json or {}).get("format") or "*"
        if fmt in scorecards:
            continue
        scorecards[fmt] = {
            "format": fmt,
            "passRate": r.metrics_json.get("passRate"),
            "passHatK": r.metrics_json.get("passHatK"),
            "passAtK": r.metrics_json.get("passAtK"),
            "vetoHits": r.metrics_json.get("vetoHits"),
            "runId": r.id,
            "gateVerdict": r.gate_verdict,
            "suiteName": r.metrics_json.get("suiteName"),
        }

    verdicts_by_key: dict[str, list[str]] = {}
    w_dist: dict[str, int] = {}
    scope_counts = {"required": 0, "advisory": 0, "unscoped": 0}
    rubric_map = {r.key: r for r in rubrics}
    for j, trial_metrics, scoring_policy in judgments:
        scope = trial_metrics or {}
        advisory_keys = scope.get("advisoryKeys")
        if (scoring_policy != SCORING_POLICY
                or not scope.get("assessment") or not isinstance(advisory_keys, list)):
            scope_counts["unscoped"] += 1
            continue
        if j.rubric_key in advisory_keys:
            scope_counts["advisory"] += 1
            continue
        if scope["assessment"] == "not_assessed":
            scope_counts["unscoped"] += 1
            continue
        scope_counts["required"] += 1
        rub = rubric_map.get(j.rubric_key)
        verdicts_by_key.setdefault(j.rubric_key, []).append(j.verdict)
        if rub and j.verdict == "fail":
            for w in rub.w_codes or []:
                w_dist[w] = w_dist.get(w, 0) + 1

    top_fail = rubric_failure_ranking(verdicts_by_key, top_n=10)
    for item in top_fail:
        rub = next((x for x in rubrics if x.key == item["rubricKey"]), None)
        if rub:
            item["name"] = rub.name
            item["sourceRef"] = rub.source_ref
            item["question"] = rub.question

    trend = []
    for r in reversed(runs[:20]):
        if r.status != "succeeded":
            continue
        trend.append(
            {
                "runId": r.id,
                "createdAt": r.created_at.isoformat() if r.created_at else None,
                "passRate": (r.metrics_json or {}).get("passRate"),
                "gateVerdict": r.gate_verdict,
                "suiteId": r.suite_id,
            }
        )

    agr = agreement(session)
    cfg = get_eval_config(session)
    used = eval_tokens_used_this_month(session)
    has_patrol = any(s.tier == "patrol" for s in suites)
    maturity = maturity_self_check(
        has_rubrics=bool(rubrics),
        has_suites=bool(suites),
        has_runs=any(r.status == "succeeded" for r in runs),
        has_case_pool=bool(candidates),
        has_online_sample=any(c.signal == "random_sample" for c in candidates),
        agreement_rate=agr.get("humanMachineAgreement"),
        has_patrol=has_patrol,
    )

    recent_gate = next((r for r in runs if r.mode == "offline" and r.gate_verdict), None)

    return {
        "scorecards": list(scorecards.values()),
        "trend": trend,
        "topFailingRubrics": top_fail,
        "judgmentScopeCounts": scope_counts,
        "wCodeDistribution": w_dist,
        "agreement": {
            "humanMachineAgreement": agr.get("humanMachineAgreement"),
            "cohenKappa": agr.get("cohenKappa"),
            "pairedCount": agr.get("pairedCount"),
        },
        "cost": {
            "tokensUsedThisMonth": used,
            "monthlyBudgetTokens": cfg.get("monthly_budget_tokens"),
            "budgetRemaining": max(0, int(cfg.get("monthly_budget_tokens") or 0) - used),
        },
        "maturity": maturity,
        "recentRegressionGate": _run_out(recent_gate) if recent_gate else None,
        "counts": {
            "rubrics": len(rubrics),
            "suites": len(suites),
            "runs": len(runs),
            "casePoolTriage": sum(1 for c in candidates if c.status == "triage"),
            "sandboxProjects": len(
                list(session.exec(select(Project).where(Project.status == SANDBOX_STATUS)).all())
            ),
        },
        "config": { _camel(k): v for k, v in cfg.items() },
    }


@router.get("/feedback/prompt-suggestions")
def feedback_prompts(
    agent_id: str | None = Query(None, alias="agentId"),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    return {"suggestions": prompt_fix_suggestions(session, agent_id=agent_id)}


# ─── 人工偏好：段落反馈 / A/B 与 best-of-N 偏好对 / 好坏例 / DPO 导出 ─────────


class FeedbackIn(BaseModel):
    artifact_id: str = Field(alias="artifactId")
    span_text: str = Field(alias="spanText", min_length=1, max_length=4000)
    polarity: str  # good | bad
    span_start: int = Field(0, alias="spanStart")
    span_end: int = Field(0, alias="spanEnd")
    reason_tags: list[str] = Field(default_factory=list, alias="reasonTags")
    note: str = ""
    project_id: Optional[str] = Field(None, alias="projectId")
    format: str = "*"
    artifact_type: str = Field("manuscript", alias="artifactType")
    artifact_version: Optional[int] = Field(None, alias="artifactVersion")

    model_config = {"populate_by_name": True}


class PreferenceIn(BaseModel):
    chosen_text: str = Field(alias="chosenText")
    rejected_text: str = Field(alias="rejectedText")
    source: str  # ab_pick | bestofn_pick | manual
    prompt: str = ""
    context_key: Optional[str] = Field(None, alias="contextKey")
    reason_tags: list[str] = Field(default_factory=list, alias="reasonTags")
    format: str = "*"
    project_id: Optional[str] = Field(None, alias="projectId")
    artifact_id: Optional[str] = Field(None, alias="artifactId")
    chosen_artifact_id: Optional[str] = Field(None, alias="chosenArtifactId")
    rejected_artifact_id: Optional[str] = Field(None, alias="rejectedArtifactId")
    step: Optional[str] = None
    meta: dict[str, Any] = Field(default_factory=dict)

    model_config = {"populate_by_name": True}


@router.get("/feedback/tags")
def feedback_tags() -> dict[str, Any]:
    return {"tags": REASON_TAG_OPTIONS}


@router.post("/feedback")
def post_feedback(body: FeedbackIn, session: Session = Depends(get_session)) -> dict[str, Any]:
    try:
        row = create_feedback(
            session,
            artifact_id=body.artifact_id,
            span_text=body.span_text,
            polarity=body.polarity,
            span_start=body.span_start,
            span_end=body.span_end,
            reason_tags=body.reason_tags,
            note=body.note,
            project_id=body.project_id,
            format=body.format,
            artifact_type=body.artifact_type,
            artifact_version=body.artifact_version,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return feedback_out(row)


@router.get("/feedback")
def get_feedback(
    artifact_id: Optional[str] = Query(None, alias="artifactId"),
    project_id: Optional[str] = Query(None, alias="projectId"),
    polarity: Optional[str] = None,
    limit: int = 100,
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    rows = list_feedback(
        session, artifact_id=artifact_id, project_id=project_id, polarity=polarity, limit=limit
    )
    return {"items": [feedback_out(r) for r in rows], "count": len(rows)}


@router.post("/preferences")
def post_preference(body: PreferenceIn, session: Session = Depends(get_session)) -> dict[str, Any]:
    try:
        row = create_preference(
            session,
            chosen_text=body.chosen_text,
            rejected_text=body.rejected_text,
            source=body.source,
            prompt=body.prompt,
            context_key=body.context_key,
            reason_tags=body.reason_tags,
            format=body.format,
            project_id=body.project_id,
            artifact_id=body.artifact_id,
            chosen_artifact_id=body.chosen_artifact_id,
            rejected_artifact_id=body.rejected_artifact_id,
            meta=body.meta,
            step=body.step,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return preference_out(row)


@router.get("/preferences")
def get_preferences(
    format: Optional[str] = None,
    source: Optional[str] = None,
    project_id: Optional[str] = Query(None, alias="projectId"),
    limit: int = 100,
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    rows = list_preferences(session, format=format, source=source, project_id=project_id, limit=limit)
    return {"items": [preference_out(r) for r in rows], "count": len(rows)}


@router.get("/preferences/export")
def export_preferences(
    format: str = "dpo_jsonl",
    min_per_context: int = Query(2, alias="minPerContext", ge=1),
    write_file: bool = Query(True, alias="writeFile"),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """导出训练数据；需评测设置里 preference_export_authorized=true。

    - dpo_jsonl：{prompt, chosen, rejected}，同 context 至少 minPerContext 条
    - grpo_prompts：{prompt, meta}，附程序化奖励与人工偏好的一致率
    """
    if format == "dpo_jsonl":
        return export_preferences_dpo(
            session, min_per_context=min_per_context, write_file=write_file
        )
    if format == "grpo_prompts":
        return export_grpo_prompts(session, write_file=write_file)
    raise HTTPException(400, "仅支持 dpo_jsonl / grpo_prompts")


class BestOfNCandidate(BaseModel):
    id: str
    text: str


class BestOfNRankIn(BaseModel):
    candidates: list[BestOfNCandidate]
    format: str = "*"
    include_llm: bool = Field(False, alias="includeLlm")

    model_config = {"populate_by_name": True}


class BestOfNPickIn(BaseModel):
    candidates: list[BestOfNCandidate]
    picked_id: str = Field(alias="pickedId")
    prompt: str = ""
    format: str = "*"
    project_id: Optional[str] = Field(None, alias="projectId")
    artifact_id: Optional[str] = Field(None, alias="artifactId")
    step: Optional[str] = None
    reason_tags: list[str] = Field(default_factory=list, alias="reasonTags")

    model_config = {"populate_by_name": True}


@router.post("/best-of-n/rank")
async def best_of_n_rank(body: BestOfNRankIn, session: Session = Depends(get_session)) -> dict[str, Any]:
    """对同一步的候选稿计分排序（代码闸为主，默认不调 LLM 评委以控制本地耗时）。"""
    try:
        return await rank_candidates(
            session,
            [c.model_dump() for c in body.candidates],
            format=body.format,
            include_llm=body.include_llm,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/best-of-n/pick")
def best_of_n_pick(body: BestOfNPickIn, session: Session = Depends(get_session)) -> dict[str, Any]:
    """用户选稿：未选中的候选与选中稿配对，写入 PreferencePair(bestofn_pick)。"""
    try:
        return record_unpicked_pairs(
            session,
            candidates=[c.model_dump() for c in body.candidates],
            picked_id=body.picked_id,
            prompt=body.prompt,
            format=body.format,
            project_id=body.project_id,
            artifact_id=body.artifact_id,
            step=body.step,
            reason_tags=body.reason_tags,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/exemplars")
def get_exemplars(
    format: str = "*",
    artifact_type: str = Query("manuscript", alias="artifactType"),
    tags: Optional[str] = None,
    max_chars: Optional[int] = Query(None, alias="maxChars", ge=200, le=8000),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    tag_list = [t.strip() for t in (tags or "").split(",") if t.strip()]
    return select_exemplars(
        session,
        format=format,
        artifact_type=artifact_type,
        tags=tag_list,
        max_chars=max_chars,
    )
