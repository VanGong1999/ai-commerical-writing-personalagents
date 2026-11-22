"""代码评分器：复用 gates / deai_detector，不重复实现检查逻辑。"""

from __future__ import annotations

import re
from typing import Any

from ...deai_detector import get_detector
from ...gates import run_gate_battery
from ...models import EvalJudgment, EvalRubric, new_id


def _gate_result_to_verdict(checks: list[dict[str, str]]) -> tuple[str, str, str]:
    if not checks:
        return "unknown", "", "无检查结果"
    fails = [c for c in checks if (c.get("result") or "").lower() == "fail"]
    warns = [c for c in checks if (c.get("result") or "").lower() == "warn"]
    if fails:
        msg = "; ".join(f"{c.get('name') or c.get('id')}: {c.get('message')}" for c in fails)
        return "fail", "", msg
    if all((c.get("result") or "").lower() == "pass" for c in checks):
        msg = "; ".join(f"{c.get('name') or c.get('id')}: {c.get('message')}" for c in checks)
        return "pass", "", msg or "全部通过"
    if warns and not fails:
        msg = "; ".join(f"{c.get('name') or c.get('id')}: {c.get('message')}" for c in warns)
        return "unknown", "", msg or "仅警告"
    return "unknown", "", "结果 inconclusive"


def _build_gate_kwargs(rubric: EvalRubric, text: str, context: dict[str, Any] | None) -> dict[str, Any]:
    ctx = dict(context or {})
    body = ctx.get("body")
    if body is None and text.strip().startswith("{"):
        try:
            import json

            body = json.loads(text)
        except Exception:  # noqa: BLE001
            body = None
    if not isinstance(body, dict):
        body = ctx.get("body_json")
    if isinstance(body, dict):
        ctx = {**body, **ctx}
    kwargs: dict[str, Any] = {
        "text": text,
        "body": body if isinstance(body, dict) else {"raw": text},
        "format": ctx.get("format") or rubric.format,
        "min_chars": int(ctx.get("min_chars") or 800),
        "max_chars": int(ctx.get("max_chars") or 1200),
        "max_scenes": int(ctx.get("max_scenes") or 3),
        "hook_flag": ctx.get("hook_flag"),
        "beats": ctx.get("beats"),
        "expect": int(ctx.get("expect") or 20),
        "slots": ctx.get("slots"),
        "min_slots": int(ctx.get("min_slots") or 3),
        "shell": ctx.get("shell"),
        "path": ctx.get("path"),
        "index": ctx.get("midpoint_index"),
        "total": int(ctx.get("midpoint_total") or 20),
        "tropes": ctx.get("tropes"),
        "score": ctx.get("similarity_score"),
        "threshold": float(ctx.get("similarity_threshold") or 0.75),
        "mode": ctx.get("core_hook_mode") or "strong",
        "acked": bool(ctx.get("acked")),
        "used": int(ctx.get("used") or 0),
        "budget": ctx.get("budget"),
        "previous_len": ctx.get("previous_len"),
        "current_len": ctx.get("current_len") or len(text),
        "counts": ctx.get("counts"),
        "logline": ctx.get("logline"),
        "editable_instruction": ctx.get("editable_instruction") or "",
        "required_phrases": ctx.get("required_phrases") or [],
        "locked_hash": ctx.get("locked_hash") or "",
        "current_locked_system": ctx.get("current_locked_system") or "",
        "requested_chars": ctx.get("requested_chars"),
        "whole_book": bool(ctx.get("whole_book")),
        "required": ctx.get("required") or [],
        "genre": ctx.get("genre"),
        "blacklist": ctx.get("blacklist"),
        "strict": bool(ctx.get("strict", True)),
        "bible": ctx.get("bible"),
        "names": ctx.get("names"),
    }
    # CoreHookAdoption expects body fields
    if rubric.code_gate == "CoreHookAdoption" and isinstance(kwargs["body"], dict):
        raw = kwargs["body"]
        if "raw" in raw and isinstance(raw["raw"], str):
            # try parse markdown-ish core hook into fields
            kwargs["body"] = _parse_core_hook_text(text)
    if rubric.code_gate == "LengthBand" and rubric.format == "manju":
        kwargs["min_chars"] = int(ctx.get("min_chars") or 800)
        kwargs["max_chars"] = int(ctx.get("max_chars") or 1200)
    return kwargs


def _parse_core_hook_text(text: str) -> dict[str, Any]:
    fields = {
        "titleHook": "",
        "coreHook": "",
        "tags": [],
        "motivation": "",
        "crisis": "",
        "openingStructure": "",
    }
    patterns = [
        ("titleHook", r"标题钩[】\]]?\s*[:：]?\s*(.+)"),
        ("coreHook", r"核心梗[】\]]?\s*[:：]?\s*(.+)"),
        ("motivation", r"动机[】\]]?\s*[:：]?\s*(.+)"),
        ("crisis", r"危机[】\]]?\s*[:：]?\s*(.+)"),
        ("openingStructure", r"开篇[】\]]?\s*[:：]?\s*(.+)"),
    ]
    for key, pat in patterns:
        m = re.search(pat, text)
        if m:
            fields[key] = m.group(1).strip()
    tags_m = re.search(r"标签[】\]]?\s*[:：]?\s*(.+)", text)
    if tags_m:
        fields["tags"] = [t.strip() for t in re.split(r"[/、,，]", tags_m.group(1)) if t.strip()]
    return fields


def _special_deai_rubric(rubric: EvalRubric, text: str) -> tuple[str, str, str]:
    phrases = ("像", "仿佛") if rubric.key.endswith("no_simile") else ("综上所述", "值得注意的是", "总而言之", "由此可见")
    for phrase in phrases:
        pos = text.find(phrase)
        if pos >= 0:
            quote = text[max(0, pos - 24):pos + 40]
            return "unknown", quote, "可选文风建议：请结合角色对白、引语和作者意图判断是否保留。"
    return "pass", "", "未发现该词表中的表达。"


def missing_gate_input(gate: str | None, kwargs: dict[str, Any]) -> bool:
    field = {"BeatCompleteness": "beats", "MidpointPosition": "index", "PaywallCoverage": "slots",
             "GenderPath": "path", "Ep1Hook": "hook_flag", "SimilarityRisk": "score"}.get(gate)
    if field:
        return kwargs.get(field) is None
    return gate == "SceneTriple" and set(kwargs["body"]) == {"raw"}


async def grade_code(
    rubric: EvalRubric,
    text: str,
    *,
    context: dict[str, Any] | None = None,
    gate_kwargs: dict[str, Any] | None = None,
    trial_id: str | None = None,
    artifact_id: str | None = None,
    artifact_version_id: str | None = None,
) -> EvalJudgment:
    ctx = context or {}
    verdict, evidence, reasoning = "unknown", "", ""

    if not text.strip():
        return EvalJudgment(trial_id=trial_id, artifact_id=artifact_id, artifact_version_id=artifact_version_id,
            rubric_key=rubric.key, grader="code", verdict="unknown", reasoning="候选正文缺失，不能判定合规")

    if rubric.key.startswith("common.deai.") and rubric.code_gate == "DeAIChecklist":
        verdict, evidence, reasoning = _special_deai_rubric(rubric, text)
    elif rubric.code_gate:
        try:
            kwargs = gate_kwargs or _build_gate_kwargs(rubric, text, ctx)
            if missing_gate_input(rubric.code_gate, kwargs):
                reasoning = "缺少该项所需的结构化输入，无法判定。"
            else:
                checks = run_gate_battery(rubric.code_gate, **kwargs)
                verdict, evidence, reasoning = _gate_result_to_verdict(checks)
            # pull a short evidence quote from fail message if possible
            if not evidence and text:
                for token in ("像", "仿佛", "综上所述", "退婚", "系统"):
                    if token in text and token in reasoning:
                        evidence = text[max(0, text.find(token) - 4) : text.find(token) + 12]
                        break
        except Exception as exc:  # noqa: BLE001
            verdict, reasoning = "unknown", f"gate error: {exc}"
    else:
        # optional: use detector score as soft signal
        try:
            det = get_detector()
            result = await det.detect(text)
            d = result.to_dict() if hasattr(result, "to_dict") else dict(result)
            score = float(d.get("score") or 0)
            v = (d.get("verdict") or "").lower()
            evidence = next((str(hit)[:80] for hit in (d.get("hits") or []) if hit and str(hit) in text), "")
            reasons = "；".join(str(reason)[:120] for reason in (d.get("reasons") or [])[:3])
            verdict = "unknown"
            reasoning = f"{reasons} 可选检测信号 detector={v} score={score:.2f}，作者可结合上下文判断"
        except Exception as exc:  # noqa: BLE001
            verdict, reasoning = "unknown", f"detector error: {exc}"

    return EvalJudgment(
        id=new_id(),
        trial_id=trial_id,
        artifact_id=artifact_id,
        artifact_version_id=artifact_version_id,
        rubric_key=rubric.key,
        grader="code",
        verdict=verdict,
        evidence_quote=evidence,
        reasoning=reasoning,
    )
