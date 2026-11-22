"""Bad Case 归因建议（LLM 辅助，人工确认后生效）。"""

from __future__ import annotations

import json
import re
from typing import Any

from sqlmodel import Session, select

from ..llm_service import chat_completion, resolve_default_model
from ..models import AgentRun, EvalCaseCandidate, RunStep, UsageEvent, utcnow
from .config import can_spend_llm_judge, get_eval_config

ATTR_OPTIONS = [
    "prompt",
    "skill_routing",
    "context_loss",
    "kb_missing",
    "model",
    "rubric_wrong",
    "upstream_artifact",
]


def _summarize_trace(session: Session, agent_run_id: str | None) -> dict[str, Any]:
    if not agent_run_id:
        return {}
    run = session.get(AgentRun, agent_run_id)
    steps = list(
        session.exec(
            select(RunStep).where(RunStep.run_id == agent_run_id).order_by(RunStep.seq)
        ).all()
    )[:40]
    tool_errors = [
        s
        for s in steps
        if s.kind == "tool_result" and (s.payload or {}).get("isError")
    ]
    return {
        "agentId": run.agent_id if run else None,
        "status": run.status if run else None,
        "gateResults": (run.gate_results if run else [])[:20],
        "tokenPrompt": run.token_prompt if run else 0,
        "tokenCompletion": run.token_completion if run else 0,
        "stepCount": len(steps),
        "toolErrorCount": len(tool_errors),
        "stepKinds": [s.kind for s in steps[-15:]],
    }


async def suggest_attribution(
    session: Session,
    candidate_id: str,
) -> EvalCaseCandidate:
    row = session.get(EvalCaseCandidate, candidate_id)
    if not row:
        raise ValueError("candidate not found")

    trace = _summarize_trace(session, row.agent_run_id)
    detail = dict(row.detail or {})
    detail["trace"] = trace

    suggestion = {
        "attribution": "model",
        "reason": "默认：信息不足，建议先查轨迹与门禁",
        "fixSuggestion": "补充人工复盘后再改 Prompt/Skill",
    }

    if can_spend_llm_judge(session, estimate=1500):
        cfg = get_eval_config(session)
        model = cfg.get("judge_model") or resolve_default_model()
        messages = [
            {
                "role": "system",
                "content": (
                    "你是 Agent 评测归因助手。根据信号与轨迹摘要，从下列归因选一个：\n"
                    + ", ".join(ATTR_OPTIONS)
                    + "\n输出 JSON："
                    '{"attribution":"...","reason":"...","fixSuggestion":"..."}'
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "signal": row.signal,
                        "detail": detail,
                        "artifactId": row.artifact_id,
                        "projectId": row.project_id,
                    },
                    ensure_ascii=False,
                ),
            },
        ]
        try:
            resp = await chat_completion(messages, model=model, temperature=0.2, max_tokens=800)
            from .graders.llm_judge import _response_parts
            from ..personal_agent_output import actual_usage
            content, _, _ = _response_parts(resp)
            session.add(UsageEvent(user_id="eval", agent_id="eval.judge",
                                   bot_id="system:eval.judge", **actual_usage(resp)))
            m = re.search(r"\{[\s\S]*\}", content)
            if m:
                parsed = json.loads(m.group(0))
                attr = str(parsed.get("attribution") or "")
                if attr in ATTR_OPTIONS:
                    suggestion["attribution"] = attr
                suggestion["reason"] = str(parsed.get("reason") or suggestion["reason"])
                suggestion["fixSuggestion"] = str(
                    parsed.get("fixSuggestion") or parsed.get("fix_suggestion") or suggestion["fixSuggestion"]
                )
        except Exception as exc:  # noqa: BLE001
            suggestion["reason"] = f"LLM 归因失败，保留默认。{exc}"

    # heuristic overrides
    if row.signal == "gate_fail":
        suggestion["attribution"] = suggestion.get("attribution") or "prompt"
    if row.signal == "rollback":
        suggestion.setdefault("attribution", "model")

    row.attribution_suggestion = (
        f"{suggestion['attribution']}: {suggestion['reason']}"
    )
    row.fix_suggestion = suggestion["fixSuggestion"]
    # do NOT set attribution until human confirms
    row.detail = {**(row.detail or {}), "attributionDraft": suggestion}
    row.updated_at = utcnow()
    session.add(row)
    session.commit()
    session.refresh(row)
    return row
