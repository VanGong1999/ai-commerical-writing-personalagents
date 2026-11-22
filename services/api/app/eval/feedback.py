"""段落反馈、好坏例检索、偏好对与 DPO 导出。"""

from __future__ import annotations

import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from sqlmodel import Session, select

from ..models import (
    ArtifactFeedback,
    EvalJudgment,
    EvalRubric,
    EvalTrial,
    PreferencePair,
    Project,
    utcnow,
)
from .config import get_eval_config

_REPO_ROOT = Path(__file__).resolve().parents[4]
_EXPORT_DIR = _REPO_ROOT / ".data" / "preferences"

# 常用 W 标签（与 Rubric w_codes 对齐，供前端选择）
REASON_TAG_OPTIONS = [
    {"code": "W06", "label": "小说化/镜头感差"},
    {"code": "W07", "label": "AI 味/套路比喻"},
    {"code": "W08", "label": "钩子弱/开篇信息点"},
    {"code": "W09", "label": "金手指贴皮/无限制"},
    {"code": "W10", "label": "爽点节奏/打脸缺失"},
    {"code": "W11", "label": "结构节拍不完整"},
    {"code": "W12", "label": "场三件事/三角缺失"},
    {"code": "W13", "label": "男女频路径错误"},
    {"code": "W14", "label": "付费点/卡点弱"},
    {"code": "W15", "label": "台词千人一面"},
    {"code": "W16", "label": "相似度风险"},
    {"code": "W17", "label": "机械降神"},
    {"code": "GOOD_HOOK", "label": "钩子强"},
    {"code": "GOOD_COOL", "label": "爽点到位"},
    {"code": "GOOD_VOICE", "label": "声线分明"},
    {"code": "GOOD_TRIAD", "label": "三角设计好"},
]


def create_feedback(
    session: Session,
    *,
    artifact_id: str,
    span_text: str,
    polarity: str,
    span_start: int = 0,
    span_end: int = 0,
    reason_tags: list[str] | None = None,
    note: str = "",
    project_id: str | None = None,
    format: str = "*",
    artifact_type: str = "manuscript",
    artifact_version: int | None = None,
    actor: str = "user",
) -> ArtifactFeedback:
    if polarity not in {"good", "bad"}:
        raise ValueError("polarity must be good|bad")
    text = (span_text or "").strip()
    if not text:
        raise ValueError("span_text required")
    if span_end <= span_start and text:
        span_end = span_start + len(text)

    # enrich format from project if missing
    fmt = format
    if (not fmt or fmt == "*") and project_id:
        p = session.get(Project, project_id)
        if p:
            fmt = p.format

    row = ArtifactFeedback(
        artifact_id=artifact_id,
        artifact_version=artifact_version,
        project_id=project_id,
        format=fmt or "*",
        artifact_type=artifact_type or "manuscript",
        span_start=int(span_start),
        span_end=int(span_end),
        span_text=text[:4000],
        polarity=polarity,
        reason_tags=list(reason_tags or []),
        note=note or "",
        actor=actor,
    )
    session.add(row)
    session.commit()
    session.refresh(row)

    # also emit case-pool signal for bad/good spans
    try:
        from .online import emit_case_signal

        emit_case_signal(
            session,
            signal="user_flag_good" if polarity == "good" else "user_flag_bad",
            artifact_id=artifact_id,
            project_id=project_id,
            detail={
                "feedbackId": row.id,
                "spanText": text[:200],
                "reasonTags": row.reason_tags,
            },
        )
    except Exception:  # noqa: BLE001
        pass
    return row


def list_feedback(
    session: Session,
    *,
    artifact_id: str | None = None,
    project_id: str | None = None,
    polarity: str | None = None,
    format: str | None = None,
    limit: int = 100,
) -> list[ArtifactFeedback]:
    stmt = select(ArtifactFeedback).order_by(ArtifactFeedback.created_at.desc()).limit(limit)
    rows = list(session.exec(stmt).all())
    if artifact_id:
        rows = [r for r in rows if r.artifact_id == artifact_id]
    if project_id:
        rows = [r for r in rows if r.project_id == project_id]
    if polarity:
        rows = [r for r in rows if r.polarity == polarity]
    if format:
        rows = [r for r in rows if r.format in {"*", format}]
    return rows


def select_exemplars(
    session: Session,
    *,
    format: str = "*",
    artifact_type: str = "manuscript",
    tags: list[str] | None = None,
    max_chars: int | None = None,
    max_good: int = 3,
    max_bad: int = 2,
) -> dict[str, Any]:
    """按格式/类型/标签取近期好坏例，总长不超过 max_chars。"""
    cfg = get_eval_config(session)
    if not cfg.get("exemplar_inject_enabled", True):
        return {"enabled": False, "good": [], "bad": [], "text": "", "chars": 0}

    limit = int(max_chars if max_chars is not None else cfg.get("exemplar_max_chars") or 1200)
    rows = list(
        session.exec(
            select(ArtifactFeedback)
            .order_by(ArtifactFeedback.created_at.desc())
            .limit(400)
        ).all()
    )
    tagset = set(tags or [])

    def match(r: ArtifactFeedback) -> bool:
        if r.format not in {"*", format} and format != "*":
            # allow exact or wildcard stored
            if r.format != format and format not in {r.format, "*"}:
                return False
        if artifact_type and r.artifact_type not in {"*", artifact_type}:
            return False
        if tagset and not (tagset & set(r.reason_tags or [])):
            # if tags requested, prefer overlap; still allow untagged good later
            return False
        return True

    matched = [r for r in rows if match(r)]
    # fallback: drop tag filter if too few
    if len(matched) < 2 and tagset:
        matched = [
            r
            for r in rows
            if r.format in {"*", format}
            and r.artifact_type in {"*", artifact_type}
        ]

    goods = [r for r in matched if r.polarity == "good"][: max_good * 2]
    bads = [r for r in matched if r.polarity == "bad"][: max_bad * 2]

    good_out: list[dict[str, Any]] = []
    bad_out: list[dict[str, Any]] = []
    used = 0

    def take(src: list[ArtifactFeedback], dest: list[dict[str, Any]], n: int, header: str) -> None:
        nonlocal used
        for r in src:
            if len(dest) >= n:
                break
            snippet = (r.span_text or "").strip()
            if not snippet:
                continue
            # leave room for headers
            room = limit - used - 40
            if room < 40:
                break
            if len(snippet) > room:
                snippet = snippet[: room - 1] + "…"
            dest.append(
                {
                    "id": r.id,
                    "text": snippet,
                    "tags": list(r.reason_tags or []),
                    "format": r.format,
                    "artifactType": r.artifact_type,
                }
            )
            used += len(snippet) + len(header)

    take(goods, good_out, max_good, "好例")
    take(bads, bad_out, max_bad, "避免")

    parts: list[str] = []
    if good_out:
        parts.append("## 好例（请对齐这种写法）")
        for i, g in enumerate(good_out, 1):
            tag = f"（{','.join(g['tags'])}）" if g["tags"] else ""
            parts.append(f"{i}. {tag}\n{g['text']}")
    if bad_out:
        parts.append("## 避免（不要这样写）")
        for i, b in enumerate(bad_out, 1):
            tag = f"（{','.join(b['tags'])}）" if b["tags"] else ""
            parts.append(f"{i}. {tag}\n{b['text']}")
    text = "\n\n".join(parts)
    if len(text) > limit:
        text = text[: limit - 1] + "…"

    return {
        "enabled": True,
        "good": good_out,
        "bad": bad_out,
        "text": text,
        "chars": len(text),
        "maxChars": limit,
    }


def make_context_key(
    *,
    project_id: str | None,
    step: str | None,
    prompt: str,
) -> str:
    h = hashlib.sha256((prompt or "").encode("utf-8")).hexdigest()[:12]
    return f"{project_id or 'noproj'}|{step or 'step'}|{h}"


def create_preference(
    session: Session,
    *,
    chosen_text: str,
    rejected_text: str,
    source: str,
    prompt: str = "",
    context_key: str | None = None,
    reason_tags: list[str] | None = None,
    format: str = "*",
    project_id: str | None = None,
    artifact_id: str | None = None,
    chosen_artifact_id: str | None = None,
    rejected_artifact_id: str | None = None,
    meta: dict[str, Any] | None = None,
    step: str | None = None,
) -> PreferencePair:
    if source not in {"ab_pick", "bestofn_pick", "manual"}:
        raise ValueError("invalid source")
    chosen = (chosen_text or "").strip()
    rejected = (rejected_text or "").strip()
    if not chosen or not rejected:
        raise ValueError("chosen_text and rejected_text required")
    if chosen == rejected:
        raise ValueError("chosen and rejected must differ")
    key = context_key or make_context_key(project_id=project_id, step=step, prompt=prompt)
    row = PreferencePair(
        context_key=key,
        prompt=prompt or "",
        chosen_text=chosen[:50000],
        rejected_text=rejected[:50000],
        reason_tags=list(reason_tags or []),
        source=source,
        format=format or "*",
        project_id=project_id,
        artifact_id=artifact_id,
        chosen_artifact_id=chosen_artifact_id,
        rejected_artifact_id=rejected_artifact_id,
        meta=dict(meta or {}),
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def list_preferences(
    session: Session,
    *,
    format: str | None = None,
    source: str | None = None,
    project_id: str | None = None,
    limit: int = 100,
) -> list[PreferencePair]:
    rows = list(
        session.exec(select(PreferencePair).order_by(PreferencePair.created_at.desc()).limit(limit)).all()
    )
    if format:
        rows = [r for r in rows if r.format in {"*", format}]
    if source:
        rows = [r for r in rows if r.source == source]
    if project_id:
        rows = [r for r in rows if r.project_id == project_id]
    return rows


def export_preferences_dpo(
    session: Session,
    *,
    format: str | None = None,
    min_per_context: int = 1,
    write_file: bool = True,
) -> dict[str, Any]:
    """导出 DPO JSONL。默认需 preference_export_authorized。

    同一 context_key 至少 min_per_context 条才纳入（计划要求可设 2）。
    """
    cfg = get_eval_config(session)
    if not cfg.get("preference_export_authorized"):
        return {
            "ok": False,
            "error": "preference_export_authorized 未开启。请在评测设置中授权后再导出。",
            "count": 0,
            "path": None,
            "lines": [],
        }

    rows = list_preferences(session, format=format, limit=5000)
    by_ctx: dict[str, list[PreferencePair]] = {}
    for r in rows:
        by_ctx.setdefault(r.context_key, []).append(r)

    lines: list[dict[str, Any]] = []
    for key, items in by_ctx.items():
        if len(items) < min_per_context:
            continue
        for r in items:
            lines.append(
                {
                    "prompt": r.prompt or f"format={r.format} context={key}",
                    "chosen": r.chosen_text,
                    "rejected": r.rejected_text,
                    "meta": {
                        "id": r.id,
                        "source": r.source,
                        "format": r.format,
                        "contextKey": r.context_key,
                        "reasonTags": r.reason_tags,
                    },
                }
            )

    path = None
    if write_file and lines:
        _EXPORT_DIR.mkdir(parents=True, exist_ok=True)
        stamp = utcnow().strftime("%Y%m%d-%H%M%S")
        path = _EXPORT_DIR / f"dpo-{stamp}.jsonl"
        with path.open("w", encoding="utf-8") as f:
            for obj in lines:
                f.write(json.dumps(obj, ensure_ascii=False) + "\n")

    return {
        "ok": True,
        "count": len(lines),
        "contexts": len([k for k, v in by_ctx.items() if len(v) >= min_per_context]),
        "path": str(path) if path else None,
        "lines": lines[:20],  # preview only
        "minPerContext": min_per_context,
    }


def export_grpo_prompts(
    session: Session,
    *,
    format: str | None = None,
    write_file: bool = True,
    min_chars: int = 800,
    max_chars: int = 1200,
) -> dict[str, Any]:
    """导出 GRPO 用的 prompt 列表 + 程序化奖励参考。

    GRPO 只需要 prompt；训练时奖励由 eval/reward.py 现算。
    这里同时输出 chosen/rejected 的奖励，并统计“奖励与人工偏好”的一致率，
    用于判断程序化奖励是否可信。同样需要 preference_export_authorized。
    """
    from .reward import reward_agreement, score_completion

    cfg = get_eval_config(session)
    if not cfg.get("preference_export_authorized"):
        return {
            "ok": False,
            "error": "preference_export_authorized 未开启。请在评测设置中授权后再导出。",
            "count": 0,
            "path": None,
            "lines": [],
        }

    rows = list_preferences(session, format=format, limit=5000)
    seen: set[str] = set()
    lines: list[dict[str, Any]] = []
    pairs: list[tuple[str, str]] = []
    for r in rows:
        prompt = (r.prompt or "").strip()
        # 没有有效任务描述的偏好对（如 A/B 版本对比）不能作为 prompt
        if len(prompt) < 10 or prompt in seen:
            continue
        seen.add(prompt)
        rc = score_completion(r.chosen_text, format=r.format if r.format != "*" else "manju",
                              min_chars=min_chars, max_chars=max_chars)
        rr = score_completion(r.rejected_text, format=r.format if r.format != "*" else "manju",
                              min_chars=min_chars, max_chars=max_chars)
        pairs.append((r.chosen_text, r.rejected_text))
        lines.append(
            {
                "prompt": prompt,
                "format": r.format,
                "meta": {
                    "id": r.id,
                    "source": r.source,
                    "contextKey": r.context_key,
                    "chosenCodeReward": rc["total"],
                    "rejectedCodeReward": rr["total"],
                },
            }
        )

    agreement = reward_agreement(
        pairs, format="manju", min_chars=min_chars, max_chars=max_chars
    ) if pairs else {"n": 0, "agreementRate": None}

    path = None
    if write_file and lines:
        _EXPORT_DIR.mkdir(parents=True, exist_ok=True)
        stamp = utcnow().strftime("%Y%m%d-%H%M%S")
        path = _EXPORT_DIR / f"grpo-{stamp}.jsonl"
        with path.open("w", encoding="utf-8") as f:
            for obj in lines:
                f.write(json.dumps(obj, ensure_ascii=False) + "\n")

    return {
        "ok": True,
        "count": len(lines),
        "path": str(path) if path else None,
        "rewardAgreement": agreement,
        "lines": lines[:20],
    }


def prompt_fix_suggestions(
    session: Session,
    *,
    agent_id: str | None = None,
    limit_runs: int = 20,
) -> list[dict[str, Any]]:
    """根据最近失败的 LLM/code 判定，聚类生成修改建议。"""
    judgments = list(
        session.exec(
            select(EvalJudgment)
            .where(EvalJudgment.verdict == "fail")
            .order_by(EvalJudgment.created_at.desc())
            .limit(500)
        ).all()
    )
    by_key: dict[str, list[EvalJudgment]] = defaultdict(list)
    trial_ids = {j.trial_id for j in judgments if j.trial_id}
    trial_scopes = {
        t.id: (t.process_metrics or {}).get("advisoryKeys")
        for t in session.exec(select(EvalTrial).where(EvalTrial.id.in_(trial_ids)))
    } if trial_ids else {}
    from .seed import _load_json
    legacy_advisory = {row["key"] for row in _load_json("rubrics.json") if row.get("severity") == "advisory"}
    for j in judgments:
        known_scope = trial_scopes.get(j.trial_id)
        if j.rubric_key in (legacy_advisory if known_scope is None else known_scope):
            continue
        by_key[j.rubric_key].append(j)

    rubrics = {
        r.key: r
        for r in session.exec(select(EvalRubric).where(EvalRubric.key.in_(list(by_key.keys())))).all()
    } if by_key else {}

    suggestions = []
    for key, js in sorted(by_key.items(), key=lambda kv: len(kv[1]), reverse=True):
        if len(suggestions) >= limit_runs:
            break
        r = rubrics.get(key)
        if not r or r.severity == "advisory" or (r.grader == "code" and not r.code_gate):
            continue
        reasons = Counter((j.reasoning or "")[:80] for j in js[:30])
        top_reason = reasons.most_common(1)[0][0] if reasons else ""
        suggestions.append(
            {
                "rubricKey": key,
                "rubricName": r.name if r else key,
                "question": r.question if r else "",
                "failCount": len(js),
                "sourceRef": r.source_ref if r else "",
                "guidance": r.guidance if r else "",
                "topReason": top_reason,
                "draftInstructionPatch": (
                    f"请在写作指令中强调：{r.question if r else key}。"
                    f" 反例：{(r.fail_example if r else '')[:80]}。"
                    f" 正例：{(r.pass_example if r else '')[:80]}。"
                ),
                "agentId": agent_id,
            }
        )
    return suggestions


def feedback_out(r: ArtifactFeedback) -> dict[str, Any]:
    return {
        "id": r.id,
        "artifactId": r.artifact_id,
        "artifactVersion": r.artifact_version,
        "projectId": r.project_id,
        "format": r.format,
        "artifactType": r.artifact_type,
        "spanStart": r.span_start,
        "spanEnd": r.span_end,
        "spanText": r.span_text,
        "polarity": r.polarity,
        "reasonTags": r.reason_tags,
        "note": r.note,
        "actor": r.actor,
        "createdAt": r.created_at.isoformat() if r.created_at else None,
    }


def preference_out(r: PreferencePair) -> dict[str, Any]:
    return {
        "id": r.id,
        "contextKey": r.context_key,
        "prompt": r.prompt,
        "chosenText": r.chosen_text,
        "rejectedText": r.rejected_text,
        "reasonTags": r.reason_tags,
        "source": r.source,
        "format": r.format,
        "projectId": r.project_id,
        "artifactId": r.artifact_id,
        "chosenArtifactId": r.chosen_artifact_id,
        "rejectedArtifactId": r.rejected_artifact_id,
        "meta": r.meta,
        "createdAt": r.created_at.isoformat() if r.created_at else None,
    }
