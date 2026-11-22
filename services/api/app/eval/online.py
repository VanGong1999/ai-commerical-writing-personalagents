"""线上抽检与 Case 池信号。"""

from __future__ import annotations

import random
from typing import Any

from sqlmodel import Session, select

from ..models import EvalCaseCandidate, Job, utcnow
from ..queue import enqueue_job
from .config import get_eval_config


def emit_case_signal(
    session: Session,
    *,
    signal: str,
    artifact_id: str | None = None,
    artifact_version: int | None = None,
    project_id: str | None = None,
    agent_run_id: str | None = None,
    detail: dict[str, Any] | None = None,
) -> EvalCaseCandidate:
    row = EvalCaseCandidate(
        artifact_id=artifact_id,
        artifact_version=artifact_version,
        project_id=project_id,
        agent_run_id=agent_run_id,
        signal=signal,
        status="triage",
        detail=dict(detail or {}),
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def maybe_enqueue_online_sample(
    session: Session,
    *,
    artifact_id: str,
    project_id: str | None = None,
    force: bool = False,
) -> Job | None:
    cfg = get_eval_config(session)
    rate = float(cfg.get("online_sample_rate") or 0)
    if not force and (rate <= 0 or random.random() > rate):
        return None
    job = Job(
        type="eval.score_artifact",
        payload={"artifactId": artifact_id, "includeLlm": True, "online": True},
        user_id="eval",
        project_id=project_id,
        status="queued",
    )
    session.add(job)
    session.commit()
    session.refresh(job)
    enqueue_job(job.id, {"type": job.type, "payload": job.payload})
    emit_case_signal(
        session,
        signal="random_sample" if not force else "adopted_unedited",
        artifact_id=artifact_id,
        project_id=project_id,
        detail={"jobId": job.id},
    )
    return job


def on_artifact_adopted(
    session: Session,
    *,
    artifact_id: str,
    project_id: str | None = None,
    version: int | None = None,
) -> None:
    emit_case_signal(
        session,
        signal="adopted_unedited",
        artifact_id=artifact_id,
        artifact_version=version,
        project_id=project_id,
    )
    maybe_enqueue_online_sample(session, artifact_id=artifact_id, project_id=project_id)


def on_artifact_rollback(
    session: Session,
    *,
    artifact_id: str,
    project_id: str | None = None,
    version: int | None = None,
) -> None:
    emit_case_signal(
        session,
        signal="rollback",
        artifact_id=artifact_id,
        artifact_version=version,
        project_id=project_id,
    )


def on_gate_fail(
    session: Session,
    *,
    artifact_id: str | None = None,
    project_id: str | None = None,
    agent_run_id: str | None = None,
    gate_results: list[dict[str, Any]] | None = None,
) -> None:
    emit_case_signal(
        session,
        signal="gate_fail",
        artifact_id=artifact_id,
        project_id=project_id,
        agent_run_id=agent_run_id,
        detail={"gateResults": gate_results or []},
    )


def on_low_score(
    session: Session,
    *,
    artifact_id: str,
    project_id: str | None = None,
    score: float,
    detail: dict[str, Any] | None = None,
) -> None:
    emit_case_signal(
        session,
        signal="low_score",
        artifact_id=artifact_id,
        project_id=project_id,
        detail={"score": score, **(detail or {})},
    )


def triage_candidate(
    session: Session,
    candidate_id: str,
    *,
    status: str,
    attribution: str | None = None,
    suite_id: str | None = None,
) -> EvalCaseCandidate:
    row = session.get(EvalCaseCandidate, candidate_id)
    if not row:
        raise ValueError("candidate not found")
    if status not in {"triage", "to_golden", "to_bad_case", "to_rubric_fix", "dismissed"}:
        raise ValueError("invalid status")
    row.status = status
    if attribution:
        row.attribution = attribution
    row.updated_at = utcnow()
    session.add(row)

    # promote into EvalCase when requested
    if status in {"to_golden", "to_bad_case"} and suite_id and row.artifact_id:
        from ..models import Artifact, EvalCase

        art = session.get(Artifact, row.artifact_id)
        if art:
            session.add(
                EvalCase(
                    suite_id=suite_id,
                    title=f"生产样本 {art.title or art.id[:8]}",
                    input_json={"score_text": art.body_markdown or "", "fromCandidate": row.id},
                    reference_markdown=art.body_markdown or "",
                    expected_behavior="从 Case 池晋升",
                    label="good" if status == "to_golden" else "bad",
                    tags=[],
                    origin="production",
                    source_ref=f"artifact:{art.id}@v{art.version}",
                )
            )
    session.commit()
    session.refresh(row)
    return row


def list_case_pool(
    session: Session,
    *,
    status: str | None = None,
    signal: str | None = None,
    limit: int = 50,
) -> list[EvalCaseCandidate]:
    stmt = select(EvalCaseCandidate).order_by(EvalCaseCandidate.created_at.desc()).limit(limit)
    rows = list(session.exec(stmt).all())
    if status:
        rows = [r for r in rows if r.status == status]
    if signal:
        rows = [r for r in rows if r.signal == signal]
    return rows
