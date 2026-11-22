"""单篇 / 批量评分编排。"""

from __future__ import annotations

from typing import Any

from sqlmodel import Session, select

from ..models import (
    Artifact,
    EvalJudgment,
    EvalRubric,
    EvalRun,
    EvalTrial,
    utcnow,
)
from .graders.code import _build_gate_kwargs, grade_code, missing_gate_input
from .graders.llm_judge import grade_llm_batch
from .metrics import aggregate_trial_score


def select_rubrics(
    session: Session,
    *,
    format: str | None = None,
    artifact_type: str | None = None,
    keys: list[str] | None = None,
) -> list[EvalRubric]:
    rows = list(session.exec(select(EvalRubric).where(EvalRubric.enabled == True)).all())  # noqa: E712
    if keys:
        keyset = set(keys)
        rows = [r for r in rows if r.key in keyset]
    if format:
        rows = [r for r in rows if r.format in {"*", format}]
    if artifact_type:
        rows = [r for r in rows if r.artifact_type in {"*", artifact_type} or artifact_type.startswith(r.artifact_type)]
    return rows


async def score_text(
    session: Session,
    text: str,
    *,
    format: str = "*",
    artifact_type: str = "manuscript",
    rubric_keys: list[str] | None = None,
    reference: str | None = None,
    context: dict[str, Any] | None = None,
    artifact_id: str | None = None,
    artifact_version_id: str | None = None,
    trial_id: str | None = None,
    include_llm: bool = True,
    persist: bool = True,
) -> dict[str, Any]:
    rubrics = select_rubrics(
        session,
        format=format if format != "*" else None,
        artifact_type=artifact_type,
        keys=rubric_keys,
    )
    # if format filter emptied everything for * artifacts, fall back to common
    if not rubrics and not rubric_keys:
        rubrics = select_rubrics(session, format="*", artifact_type=artifact_type)

    code_rs = [r for r in rubrics if r.grader == "code"]
    llm_rs = [r for r in rubrics if r.grader == "llm"] if include_llm else []
    # human-only skipped in auto score

    judgments: list[EvalJudgment] = []
    sev = {r.key: r.severity for r in rubrics}
    conditional_builtin = {"duanju.beat20", "duanju.midpoint", "duanju.scene_triple", "duanju.paywall"}
    for r in code_rs:
        try:
            kwargs = _build_gate_kwargs(r, text, context) if r.code_gate else {}
        except (ValueError, TypeError):
            kwargs = None  # grade_code records malformed context as unknown
        if not r.code_gate or (kwargs is not None and r.key in conditional_builtin and r.version == 1 and text.strip()
                               and missing_gate_input(r.code_gate, kwargs)):
            sev[r.key] = "advisory"
        j = await grade_code(
            r,
            text,
            context=context,
            gate_kwargs=kwargs,
            trial_id=trial_id,
            artifact_id=artifact_id,
            artifact_version_id=artifact_version_id,
        )
        judgments.append(j)

    if llm_rs:
        judgments.extend(
            await grade_llm_batch(
                session,
                llm_rs,
                text,
                reference=reference,
                trial_id=trial_id,
                artifact_id=artifact_id,
                artifact_version_id=artifact_version_id,
            )
        )

    assessed = {j.rubric_key for j in judgments}
    for r in rubrics:
        if r.key not in assessed:
            judgments.append(EvalJudgment(trial_id=trial_id, artifact_id=artifact_id,
                artifact_version_id=artifact_version_id, rubric_key=r.key, grader=r.grader,
                verdict="unknown", reasoning="LLM 评委已禁用" if r.grader == "llm" else "待人工评审"))

    weights = {r.key: r.weight for r in rubrics}
    payload = []
    for j in judgments:
        d = {
            "rubric_key": j.rubric_key,
            "verdict": j.verdict,
            "severity": sev.get(j.rubric_key, "major"),
            "weight": weights.get(j.rubric_key, 1.0),
            "evidence_quote": j.evidence_quote,
            "reasoning": j.reasoning,
            "grader": j.grader,
        }
        payload.append(d)

    passed, score, detail = aggregate_trial_score(payload, severities=sev)

    if persist:
        for j in judgments:
            session.add(j)
        session.commit()

    return {
        "passed": passed,
        "score": score,
        "detail": detail,
        "judgments": [
            {
                "id": j.id,
                "rubricKey": j.rubric_key,
                "grader": j.grader,
                "verdict": j.verdict,
                "evidenceQuote": j.evidence_quote,
                "reasoning": j.reasoning,
                "judgeModel": j.judge_model,
                "severity": sev.get(j.rubric_key),
            }
            for j in judgments
        ],
        "rubricCount": len(judgments),
    }


async def score_artifact(
    session: Session,
    artifact_id: str,
    *,
    rubric_keys: list[str] | None = None,
    include_llm: bool = True,
    create_run: bool = True,
) -> dict[str, Any]:
    art = session.get(Artifact, artifact_id)
    if not art:
        raise ValueError("artifact not found")
    from ..models import Project

    project = session.get(Project, art.project_id)
    fmt = project.format if project else "*"
    text = art.body_markdown or ""
    if not text and art.body_json:
        import json

        text = json.dumps(art.body_json, ensure_ascii=False)

    run = None
    trial = None
    if create_run:
        run = EvalRun(
            mode="score_artifact",
            variant_json={"artifactId": artifact_id, "format": fmt, "type": art.type},
            status="running",
        )
        session.add(run)
        session.commit()
        session.refresh(run)
        trial = EvalTrial(
            eval_run_id=run.id,
            trial_idx=0,
            artifact_id=artifact_id,
            output_snapshot=text[:20000],
        )
        session.add(trial)
        session.commit()
        session.refresh(trial)

    result = await score_text(
        session,
        text,
        format=fmt,
        artifact_type=art.type,
        rubric_keys=rubric_keys,
        context={"format": fmt, "body_json": art.body_json},
        artifact_id=artifact_id,
        trial_id=trial.id if trial else None,
        include_llm=include_llm,
        persist=True,
    )

    if trial:
        trial.process_metrics = {**(trial.process_metrics or {}), "assessment": result["detail"]["assessment"],
                                 "advisoryKeys": list(result["detail"]["advisoryByRubric"])}
        trial.passed = None if result["detail"]["assessment"] == "not_assessed" else result["passed"]
        trial.score = float(result["score"])
        session.add(trial)
    if run:
        run.status = "succeeded"
        run.metrics_json = {
            "scoringPolicy": result["detail"]["scoringPolicy"],
            "passRate": result["score"] if result["detail"]["byRubric"] else None,
            "passed": result["passed"],
            "detail": result["detail"],
        }
        run.gate_verdict = result["detail"]["assessment"]
        run.progress_pct = 100
        run.finished_at = utcnow()
        session.add(run)
        session.commit()
        result["evalRunId"] = run.id
        result["trialId"] = trial.id if trial else None
    else:
        session.commit()

    result["artifactId"] = artifact_id
    result["format"] = fmt
    result["artifactType"] = art.type
    return result
