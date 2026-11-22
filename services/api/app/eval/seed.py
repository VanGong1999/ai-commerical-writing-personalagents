"""幂等播种 Eval Rubric / Suite / Case 与默认配置。"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from sqlmodel import Session, select

from ..models import AppSetting, EvalCase, EvalRubric, EvalSuite, ScheduledTask, utcnow
from . import DEFAULT_EVAL_CONFIG

_SEEDS = Path(__file__).resolve().parent / "seeds"


def _load_json(name: str) -> list[dict[str, Any]]:
    path = _SEEDS / name
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    return list(data) if isinstance(data, list) else []


def ensure_eval_config(session: Session) -> None:
    row = session.get(AppSetting, "eval.config")
    if row is None:
        session.add(AppSetting(key="eval.config", value_json=dict(DEFAULT_EVAL_CONFIG)))
        session.commit()
        return
    merged = dict(DEFAULT_EVAL_CONFIG)
    merged.update(row.value_json or {})
    if merged != (row.value_json or {}):
        row.value_json = merged
        row.updated_at = utcnow()
        session.add(row)
        session.commit()


def seed_eval_rubrics(session: Session) -> int:
    n = 0
    for item in _load_json("rubrics.json"):
        key = item["key"]
        existing = session.exec(select(EvalRubric).where(EvalRubric.key == key)).first()
        original = EvalRubric(
            key=key,
            name=item["name"],
            format=item.get("format") or "*",
            artifact_type=item.get("artifact_type") or "manuscript",
            source=item.get("source") or "common",
            source_ref=item.get("source_ref") or "",
            grader=item.get("grader") or "llm",
            code_gate=item.get("code_gate"),
            question=item["question"],
            guidance=item.get("guidance") or "",
            severity=item.get("severity") or "major",
            weight=float(item.get("weight") or 1.0),
            w_codes=list(item.get("w_codes") or []),
            pass_example=item.get("pass_example") or "",
            fail_example=item.get("fail_example") or "",
            version=int(item.get("version") or 1),
            enabled=True,
        )
        if existing:
            prior_configs = item.get("previous_configs") or {
                str(original.version - 1): item.get("previous_config_sha256")
            }
            previous = prior_configs.get(str(existing.version))
            if not previous:
                continue
            config = existing.model_dump(exclude={"id", "created_at", "updated_at"})
            encoded = json.dumps(config, sort_keys=True, ensure_ascii=False).encode()
            if hashlib.sha256(encoded).hexdigest() != previous:
                continue
            existing.severity = original.severity
            existing.guidance = original.guidance
            existing.version = original.version
            existing.updated_at = utcnow()
        session.add(existing or original)
        n += 1
    if n:
        session.commit()
    return n


def seed_eval_suites(session: Session) -> int:
    n = 0
    for item in _load_json("suites.json"):
        sid = item.get("id")
        existing = session.get(EvalSuite, sid) if sid else None
        if existing is None and sid:
            # also match by name+format+tier
            existing = session.exec(
                select(EvalSuite).where(
                    EvalSuite.name == item["name"],
                    EvalSuite.format == (item.get("format") or "*"),
                    EvalSuite.tier == (item.get("tier") or "regression"),
                )
            ).first()
        if existing:
            continue
        kwargs: dict[str, Any] = dict(
            name=item["name"],
            kind=item.get("kind") or "process",
            tier=item.get("tier") or "regression",
            format=item.get("format") or "*",
            target_agent_id=item.get("target_agent_id"),
            pipeline=item.get("pipeline"),
            rubric_keys=list(item.get("rubric_keys") or []),
            trials_k=int(item.get("trials_k") or 1),
            thresholds_json=dict(item.get("thresholds_json") or {}),
            description=item.get("description") or "",
            enabled=True,
        )
        if sid:
            kwargs["id"] = sid
        session.add(EvalSuite(**kwargs))
        n += 1
    if n:
        session.commit()
    return n


def seed_eval_cases(session: Session) -> int:
    n = 0
    for item in _load_json("cases.json"):
        suite_id = item["suite_id"]
        title = item.get("title") or ""
        existing = session.exec(
            select(EvalCase).where(EvalCase.suite_id == suite_id, EvalCase.title == title)
        ).first()
        if existing:
            continue
        if not session.get(EvalSuite, suite_id):
            continue
        session.add(
            EvalCase(
                suite_id=suite_id,
                title=title,
                input_json=dict(item.get("input_json") or {}),
                reference_markdown=item.get("reference_markdown") or "",
                expected_behavior=item.get("expected_behavior") or "",
                label=item.get("label") or "good",
                tags=list(item.get("tags") or []),
                origin=item.get("origin") or "course",
                source_ref=item.get("source_ref") or "",
                enabled=True,
            )
        )
        n += 1
    if n:
        session.commit()
    return n


def ensure_eval_patrol_schedule(session: Session) -> int:
    """每日凌晨巡检（默认关闭，可在设置里启用）。"""
    tid = "eval.patrol"
    existing = session.get(ScheduledTask, tid)
    if existing:
        return 0
    session.add(
        ScheduledTask(
            id=tid,
            name="质量评测每日巡检",
            cron_or_interval="0 3 * * *",
            enabled=False,
            owner_scope="system",
            description="跑 tier=patrol 的评测集，发现未知退化。",
            payload_template={"type": "eval.patrol", "includeLlm": True},
        )
    )
    session.commit()
    return 1


def ensure_eval_seeds(session: Session) -> dict[str, int]:
    ensure_eval_config(session)
    rubrics = seed_eval_rubrics(session)
    suites = seed_eval_suites(session)
    cases = seed_eval_cases(session)
    patrol = ensure_eval_patrol_schedule(session)
    return {"rubrics": rubrics, "suites": suites, "cases": cases, "patrolSchedule": patrol}
