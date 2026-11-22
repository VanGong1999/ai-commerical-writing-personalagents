"""人工标注提交。"""

from __future__ import annotations

from typing import Any

from sqlmodel import Session

from ...models import EvalJudgment, utcnow


def submit_human_judgment(
    session: Session,
    *,
    rubric_key: str,
    verdict: str,
    trial_id: str | None = None,
    artifact_id: str | None = None,
    artifact_version_id: str | None = None,
    evidence_quote: str = "",
    reasoning: str = "",
    annotator: str = "user",
    blind: bool = True,
) -> EvalJudgment:
    v = verdict if verdict in {"pass", "fail", "unknown"} else "unknown"
    row = EvalJudgment(
        trial_id=trial_id,
        artifact_id=artifact_id,
        artifact_version_id=artifact_version_id,
        rubric_key=rubric_key,
        grader="human",
        verdict=v,
        evidence_quote=evidence_quote,
        reasoning=reasoning,
        annotator=annotator,
        blind=blind,
        created_at=utcnow(),
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def serialize_judgment(j: EvalJudgment, *, hide_machine: bool = False) -> dict[str, Any]:
    if hide_machine and j.grader != "human":
        return {
            "id": j.id,
            "rubricKey": j.rubric_key,
            "grader": j.grader,
            "verdict": None,
            "blind": True,
        }
    return {
        "id": j.id,
        "trialId": j.trial_id,
        "artifactId": j.artifact_id,
        "artifactVersionId": j.artifact_version_id,
        "rubricKey": j.rubric_key,
        "grader": j.grader,
        "verdict": j.verdict,
        "evidenceQuote": j.evidence_quote,
        "reasoning": j.reasoning,
        "judgeModel": j.judge_model,
        "annotator": j.annotator,
        "blind": j.blind,
        "createdAt": j.created_at.isoformat() if j.created_at else None,
    }
