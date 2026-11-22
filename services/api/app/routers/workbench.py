"""灵感 / 换元 / 数据复盘 路由。"""
from __future__ import annotations

from ..usage_attribution import record_model_usage

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..db import get_session
from ..models import AnalyticsSnapshot, Inspiration, Job, Project, SwapPlan, utcnow
from ..schemas import (
    AnalyticsIn,
    AnalyticsOut,
    CreateInspirationIn,
    CreateSwapPlanIn,
    InspirationOut,
    SwapPlanOut,
)
from ..seed import DEMO_USER
from ..queue import enqueue_job, publish_job_event
from ..settings import get_settings

inspirations_router = APIRouter(prefix="/inspirations", tags=["workbench"])
swap_plans_router = APIRouter(prefix="/swap-plans", tags=["workbench"])
analytics_router = APIRouter(prefix="/analytics", tags=["workbench"])

_LEVEL_LABEL = {"notion": "一念", "idea": "灵感", "concept": "创意", "topic": "选题"}


def _expand_candidates(level: str, source_text: str) -> list[dict]:
    label = _LEVEL_LABEL.get(level, level)
    return [
        {
            "title": f"{label}候选 · {source_text[:24]}",
            "logline": f"以「{source_text}」为核，升级为可投稿选题。",
            "scores": {"empathy": 7, "thrill": 6, "shell": 7, "market": 8},
        },
        {
            "title": f"{label}候选 · 反向设定",
            "logline": f"保留「{source_text}」的情绪，反转身份与金手指。",
            "scores": {"empathy": 6, "thrill": 8, "shell": 7, "market": 7},
        },
    ]


def _analytics_changed(prev: AnalyticsSnapshot | None, new: AnalyticsIn) -> bool:
    """与上一快照对比 views/favorites/retention 是否有变化。首条快照（prev=None）不触发。"""
    if prev is None:
        return False
    return (
        prev.views != new.views
        or prev.favorites != new.favorites
        or (prev.retention or {}) != (new.retention or {})
    )


def _enqueue_analytics_review(session: Session, project_id: str, snapshot_id: str) -> None:
    settings = get_settings()
    job = Job(
        type="analytics.review",
        payload={"project_id": project_id, "snapshot_id": snapshot_id},
        user_id=settings.demo_user_id,
        status="queued",
    )
    session.add(job)
    session.commit()
    session.refresh(job)
    enqueue_job(job.id, {"type": job.type, "payload": job.payload})
    publish_job_event(job.id, {"type": "status", "status": "queued", "jobId": job.id})


@inspirations_router.get("", response_model=list[InspirationOut])
def list_inspirations(session: Session = Depends(get_session)) -> list[Inspiration]:
    return list(session.exec(select(Inspiration).order_by(Inspiration.updated_at.desc())))


@inspirations_router.post("", response_model=InspirationOut)
def create_inspiration(
    body: CreateInspirationIn,
    session: Session = Depends(get_session),
) -> Inspiration:
    row = Inspiration(
        user_id=DEMO_USER,
        level=body.level,
        source_text=body.source_text,
        tags=body.tags,
        format_hint=body.format_hint,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@inspirations_router.get("/{inspiration_id}", response_model=InspirationOut)
def get_inspiration(
    inspiration_id: str,
    session: Session = Depends(get_session),
) -> Inspiration:
    row = session.get(Inspiration, inspiration_id)
    if not row:
        raise HTTPException(404, "inspiration not found")
    return row


def _load_inspiration_skill() -> str:
    """Load inspiration.expand Skill body for system prompt (Agent-aligned)."""
    from pathlib import Path

    here = Path(__file__).resolve()
    candidates = [
        here.parents[4] / "packages/agent-runtime/skills/inspiration/expand/SKILL.md",
        here.parents[3] / "packages/agent-runtime/skills/inspiration/expand/SKILL.md",
        Path("packages/agent-runtime/skills/inspiration/expand/SKILL.md"),
    ]
    for p in candidates:
        try:
            if p.is_file():
                text = p.read_text(encoding="utf-8")
                if text.startswith("---"):
                    parts = text.split("---", 2)
                    return parts[2].strip() if len(parts) >= 3 else text
                return text
        except OSError:
            continue
    return (
        "你是九格灵感升级 Agent（inspiration.expand）。按灵感四层级把输入升级为可投稿候选。"
        "须先定层再扩展；输出商品思维四维评分。"
    )


def _normalize_candidates(data: object, level: str, source_text: str) -> list[dict]:
    if not isinstance(data, list) or not data:
        return _expand_candidates(level, source_text)
    out: list[dict] = []
    for item in data[:5]:
        if not isinstance(item, dict):
            continue
        scores = item.get("scores") if isinstance(item.get("scores"), dict) else {}
        empathy = int(scores.get("empathy") or scores.get("共鸣") or 6)
        thrill = int(scores.get("thrill") or scores.get("爽点") or 6)
        shell = int(scores.get("shell") or scores.get("壳") or 6)
        market = int(scores.get("market") or scores.get("市场") or 6)
        risk = item.get("risk") if isinstance(item.get("risk"), list) else []
        # 商品思维硬门槛：壳/共鸣过低标风险
        if shell < 5 and "壳不完整" not in risk:
            risk = [*risk, "壳不完整"]
        if empathy < 5 and "共鸣不足" not in risk:
            risk = [*risk, "共鸣不足"]
        if market < 5 and "市场弱" not in risk:
            risk = [*risk, "市场弱"]
        out.append(
            {
                "title": str(item.get("title") or f"候选 · {source_text[:20]}"),
                "logline": str(item.get("logline") or source_text),
                "scores": {
                    "empathy": empathy,
                    "thrill": thrill,
                    "shell": shell,
                    "market": market,
                },
                "risk": [str(r) for r in risk][:8],
                "level_judge": item.get("level_judge") or item.get("层级"),
                "agent": "inspiration.expand",
            }
        )
    return out or _expand_candidates(level, source_text)


@inspirations_router.post("/{inspiration_id}/expand", response_model=InspirationOut)
async def expand_inspiration(
    inspiration_id: str,
    session: Session = Depends(get_session),
) -> Inspiration:
    import json
    import re

    from ..llm_service import chat_completion

    row = session.get(Inspiration, inspiration_id)
    if not row:
        raise HTTPException(404, "inspiration not found")
    label = _LEVEL_LABEL.get(row.level, row.level)
    skill = _load_inspiration_skill()
    system = (
        f"{skill}\n\n"
        "——运行时补充——\n"
        "你就是 registry Agent `inspiration.expand`。"
        "最终除遵循 Skill 外，**必须**额外输出纯 JSON 数组（不要 markdown 围栏），"
        "每项：title, logline, scores{empathy,thrill,shell,market}, risk(array), level_judge。"
        "商品思维：共鸣/爽点/壳/市场四维打分 1–10；壳或共鸣 <5 必须写入 risk。"
    )
    try:
        result = await chat_completion(
            [
                {"role": "system", "content": system[:12000]},
                {
                    "role": "user",
                    "content": (
                        f"当前层级：{label}\n原文：{row.source_text}\n"
                        f"format_hint：{row.format_hint or 'manju'}\n"
                        "请先定层，再给出 3 个可投稿候选（JSON 数组）。"
                    ),
                },
            ],
            temperature=0.8,
            max_tokens=1600,
        )
        record_model_usage(result, agent_id="inspiration.expand", session=session, user_id=row.user_id)
        text = result.content.strip()
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
        match = re.search(r"\[[\s\S]*\]", text)
        raw = json.loads(text) if text.startswith("[") else (json.loads(match.group(0)) if match else None)
        row.candidates = _normalize_candidates(raw, row.level, row.source_text)
    except Exception:  # noqa: BLE001
        row.candidates = _expand_candidates(row.level, row.source_text)
    if row.level in ("notion", "idea"):
        row.level = "idea" if row.level == "notion" else "concept"
    elif row.level == "concept":
        row.level = "topic"
    row.updated_at = utcnow()
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@swap_plans_router.get("", response_model=list[SwapPlanOut])
def list_swap_plans(
    project_id: str | None = None,
    session: Session = Depends(get_session),
) -> list[SwapPlan]:
    rows = list(session.exec(select(SwapPlan).order_by(SwapPlan.updated_at.desc())))
    if project_id:
        rows = [r for r in rows if r.project_id == project_id]
    return rows


@swap_plans_router.post("", response_model=SwapPlanOut)
def create_swap_plan(
    body: CreateSwapPlanIn,
    session: Session = Depends(get_session),
) -> SwapPlan:
    row = SwapPlan(
        user_id=DEMO_USER,
        project_id=body.project_id,
        source_doc_id=body.source_doc_id,
        degree=body.degree,
        mapping_json=body.mapping_json,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@analytics_router.get("/projects/{project_id}", response_model=AnalyticsOut)
def get_project_analytics(
    project_id: str,
    session: Session = Depends(get_session),
) -> AnalyticsSnapshot:
    if not session.get(Project, project_id):
        raise HTTPException(404, "project not found")
    row = session.exec(
        select(AnalyticsSnapshot)
        .where(AnalyticsSnapshot.project_id == project_id)
        .order_by(AnalyticsSnapshot.created_at.desc())
    ).first()
    if not row:
        row = AnalyticsSnapshot(project_id=project_id)
        session.add(row)
        session.commit()
        session.refresh(row)
    return row


@analytics_router.post("/projects/{project_id}", response_model=AnalyticsOut)
def upsert_project_analytics(
    project_id: str,
    body: AnalyticsIn,
    session: Session = Depends(get_session),
) -> AnalyticsSnapshot:
    if not session.get(Project, project_id):
        raise HTTPException(404, "project not found")
    prev = session.exec(
        select(AnalyticsSnapshot)
        .where(AnalyticsSnapshot.project_id == project_id)
        .order_by(AnalyticsSnapshot.created_at.desc())
    ).first()
    row = AnalyticsSnapshot(
        project_id=project_id,
        views=body.views,
        favorites=body.favorites,
        retention=body.retention or {},
        meta=body.meta or {},
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    if _analytics_changed(prev, body):
        _enqueue_analytics_review(session, project_id, row.id)
    return row
