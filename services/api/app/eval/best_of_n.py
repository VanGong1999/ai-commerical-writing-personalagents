"""best-of-N：候选稿计分排序 + 用户选稿后生成偏好对。

计分复用 score_text（代码闸 + 可选 LLM 评委）；未选中的候选稿进入 PreferencePair(source=bestofn_pick)。
"""

from __future__ import annotations

from typing import Any

from sqlmodel import Session

from .feedback import create_preference, make_context_key
from .score import score_text


def sort_ranked(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """通过门禁优先，其次分数降序，最后按原始顺序稳定。"""
    indexed = list(enumerate(items))
    indexed.sort(
        key=lambda pair: (
            0 if pair[1].get("passed") else 1,
            -float(pair[1].get("score") or 0.0),
            pair[0],
        )
    )
    out: list[dict[str, Any]] = []
    for rank, (_, item) in enumerate(indexed, 1):
        out.append({**item, "rank": rank})
    return out


async def rank_candidates(
    session: Session,
    candidates: list[dict[str, str]],
    *,
    format: str = "*",
    artifact_type: str = "manuscript",
    include_llm: bool = False,
) -> dict[str, Any]:
    """candidates: [{"id": str, "text": str}]，返回按优劣排序的结果。"""
    if not candidates:
        raise ValueError("candidates 不能为空")
    if len(candidates) > 8:
        raise ValueError("best-of-N 最多 8 个候选")
    for c in candidates:
        if not (c.get("id") and (c.get("text") or "").strip()):
            raise ValueError("每个候选需要 id 与非空 text")

    scored: list[dict[str, Any]] = []
    for c in candidates:
        res = await score_text(
            session,
            c["text"],
            format=format,
            artifact_type=artifact_type,
            include_llm=include_llm,
            persist=False,
        )
        failed = [key for key, verdict in res["detail"]["byRubric"].items() if verdict == "fail"]
        scored.append(
            {
                "id": c["id"],
                "passed": bool(res["passed"]),
                "score": float(res["score"] or 0.0),
                "assessment": res["detail"]["assessment"],
                "advisoryJudgments": [j for j in res["judgments"] if j["severity"] == "advisory"],
                "failedRubrics": failed,
                "chars": len(c["text"]),
            }
        )
    ranked = sort_ranked(scored)
    return {"ranked": ranked, "best": ranked[0]["id"] if ranked[0]["assessment"] != "not_assessed" else None, "includeLlm": include_llm}


def record_unpicked_pairs(
    session: Session,
    *,
    candidates: list[dict[str, str]],
    picked_id: str,
    prompt: str = "",
    format: str = "*",
    project_id: str | None = None,
    artifact_id: str | None = None,
    step: str | None = None,
    reason_tags: list[str] | None = None,
) -> dict[str, Any]:
    """用户选中 picked_id 后，与每个未选候选配对写入 bestofn_pick。"""
    by_id = {c["id"]: c for c in candidates}
    if picked_id not in by_id:
        raise ValueError("picked_id 不在候选中")
    chosen = by_id[picked_id]["text"]
    key = make_context_key(project_id=project_id, step=step, prompt=prompt)
    created: list[str] = []
    for c in candidates:
        if c["id"] == picked_id:
            continue
        if (c.get("text") or "").strip() == chosen.strip():
            continue
        row = create_preference(
            session,
            chosen_text=chosen,
            rejected_text=c["text"],
            source="bestofn_pick",
            prompt=prompt,
            context_key=key,
            reason_tags=reason_tags or [],
            format=format,
            project_id=project_id,
            artifact_id=artifact_id,
            chosen_artifact_id=picked_id,
            rejected_artifact_id=c["id"],
            meta={"step": step, "pool": len(candidates)},
        )
        created.append(row.id)
    return {"created": created, "count": len(created), "contextKey": key}
