"""评测配置读写与月度预算。"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlmodel import Session, select

from ..models import AppSetting, UsageEvent, utcnow
from . import DEFAULT_EVAL_CONFIG


def get_eval_config(session: Session) -> dict[str, Any]:
    row = session.get(AppSetting, "eval.config")
    cfg = dict(DEFAULT_EVAL_CONFIG)
    if row and row.value_json:
        cfg.update(row.value_json)
    return cfg


def put_eval_config(session: Session, patch: dict[str, Any]) -> dict[str, Any]:
    cfg = get_eval_config(session)
    for k, v in patch.items():
        if k in DEFAULT_EVAL_CONFIG or k in cfg:
            cfg[k] = v
    row = session.get(AppSetting, "eval.config")
    if row is None:
        row = AppSetting(key="eval.config", value_json=cfg)
    else:
        row.value_json = cfg
        row.updated_at = utcnow()
    session.add(row)
    session.commit()
    session.refresh(row)
    return dict(row.value_json)


def month_start_utc() -> datetime:
    now = datetime.now(timezone.utc)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def eval_tokens_used_this_month(session: Session) -> int:
    start = month_start_utc()
    rows = session.exec(
        select(UsageEvent).where(
            UsageEvent.agent_id == "eval.judge",
            UsageEvent.created_at >= start,
        )
    ).all()
    return sum(int(r.prompt_tokens or 0) + int(r.completion_tokens or 0) for r in rows)


def can_spend_llm_judge(session: Session, estimate: int = 2000) -> bool:
    cfg = get_eval_config(session)
    budget = int(cfg.get("monthly_budget_tokens") or 0)
    if budget <= 0:
        return True
    used = eval_tokens_used_this_month(session)
    return used + estimate <= budget
