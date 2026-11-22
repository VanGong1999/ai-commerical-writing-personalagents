from __future__ import annotations

from ..usage_attribution import record_model_usage

from collections import defaultdict
from typing import Any

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query
from sqlalchemy import update
from sqlmodel import Session, select

from ..crypto import decrypt_secret, encrypt_secret, mask_secret
from ..db import get_session
from ..scheduling import validate_schedule, initial_run_at
from ..gates import check_prompt_lock
from ..llm_service import resolve_default_model
from ..memory_service import (
    MemoryConflictError,
    MemoryFrozenError,
    cas_write_memory,
    hybrid_search_memory,
    scoped_memory_files,
    _private_store_ids,
    is_context_snapshot,
    resolve_store_id,
    touch_memory as touch_memory_impl,
)
from ..models import (
    AgentRun,
    AppSetting,
    Artifact,
    MemoryFile,
    MemoryVersion,
    Project,
    PromptTemplateRow,
    ProviderConfig,
    ScheduledTask,
    TaskProposal,
    UsageEvent,
    new_id,
    utcnow,
)
from ..pricing import build_pricing_map, cost_for_model, sanitize_pricing
from ..rbac import require_memory_access
from ..schemas import (
    ArtifactOut,
    GateCheckOut,
    CreateMemoryVersionIn,
    CreateScheduledTaskIn,
    PatchScheduledTaskIn,
    MemoryMetaOut,
    MemoryPutIn,
    MemoryVersionOut,
    PromptTemplateOut,
    PromptValidateIn,
    AppSettingsPatchIn,
    LlmGovernorReportIn,
    LlmTrafficPatchIn,
    ProviderOut,
    ProviderTestIn,
    ProviderTestOut,
    ProviderUpsertIn,
    RollbackMemoryIn,
    ScheduledTaskOut,
    TaskProposalOut,
    UsageEventOut,
)
router = APIRouter(tags=["misc"])


_FORMAT_LABELS = {
    "manju": "漫剧",
    "duanju": "短剧",
    "short_novel": "短篇",
    "male_long": "男频中长篇",
    "female_long": "女频中长篇",
    "ip_adapt": "IP 改编",
}


def _has_body(art: Artifact) -> bool:
    if (art.body_markdown or "").strip():
        return True
    return bool(art.body_json and isinstance(art.body_json, dict) and art.body_json)


def _word_count(art: Artifact) -> int:
    if art.body_json and isinstance(art.body_json, dict):
        n = art.body_json.get("wordCount")
        if isinstance(n, (int, float)) and n > 0:
            return int(n)
    return len((art.body_markdown or "").replace("\n", ""))


def _outline_ready(art: Artifact, fmt: str) -> bool:
    if art.type != "episode_outline":
        return False
    body = art.body_json or {}
    has_summary = bool(
        (body.get("summary") if isinstance(body, dict) else "")
        or (art.body_markdown or "").strip()
    )
    if not has_summary:
        return False
    beats = body.get("beats") if isinstance(body, dict) else None
    if fmt in {"manju", "duanju"}:
        paywall = bool(
            body.get("paywallPoint") or body.get("paywallHint") or body.get("cliffType") or body.get("cliffText")
        )
        return bool(body.get("hookAtEnd")) and bool(beats) and paywall
    return bool(beats) or has_summary


def _project_package_done(fmt: str, project: Project, arts: list[Artifact]) -> bool:
    has_hook = any(a.type == "core_hook" and a.status == "adopted" for a in arts)
    synopsis = ((project.cover_meta or {}).get("logline") or "").strip()
    has_synopsis = len(synopsis) >= 8
    has_characters = any(a.type == "character" and _has_body(a) for a in arts)
    has_emotion = any(a.type == "emotion_curve" and _has_body(a) for a in arts)
    outline_ready = sum(1 for a in arts if _outline_ready(a, fmt))
    manuscripts = [a for a in arts if a.type == "manuscript"]
    body_ready = sum(1 for a in manuscripts if a.status == "adopted")
    outline_target = 10 if fmt in {"manju", "duanju"} else 1
    body_target = 3 if fmt == "manju" else (10 if fmt == "duanju" else 1)
    first_ready = has_hook if fmt == "manju" else has_synopsis
    if fmt == "ip_adapt":
        return bool(
            has_characters and outline_ready >= 1 and has_emotion and body_ready >= 1
        )
    return bool(
        first_ready
        and has_characters
        and outline_ready >= outline_target
        and body_ready >= body_target
    )


def _memory_project_from_path(path: str) -> str | None:
    parts = (path or "").strip("/").split("/")
    # /memories/projects/{projectId}/...
    if len(parts) >= 3 and parts[0] == "memories" and parts[1] == "projects":
        return parts[2]
    return None


@router.get("/memory/tree", response_model=list[MemoryMetaOut])
def memory_tree(
    session: Session = Depends(get_session),
    store_id: str | None = Query(default=None),
    project_id: str | None = Query(default=None),
) -> list[MemoryFile]:
    rows = sorted(scoped_memory_files(session, store_id, project_id), key=lambda row: row.path)
    if store_id:
        owner, aliases = _private_store_ids(store_id)
        if owner and len(aliases) > 1:
            result = []
            for row in rows:
                parts = row.path.split("/")
                index = 3 if parts[2] == "bots" else 5
                parts[index] = owner
                result.append(MemoryMetaOut.model_validate(row).model_copy(update={"display_path": "/".join(parts)}))
            return result
    return rows


@router.get("/memory/file", response_model=MemoryMetaOut)
def memory_file(
    path: str,
    session: Session = Depends(get_session),
    project_id: str | None = Query(default=None),
    x_user_role: str = Header(default="admin", alias="X-User-Role"),
) -> MemoryFile:
    require_memory_access(x_user_role, path, "read", project_id=project_id)
    if is_context_snapshot(path):
        raise HTTPException(404, "memory file not found")
    row = session.get(MemoryFile, path)
    if not row:
        raise HTTPException(404, "memory file not found")
    return row


@router.post("/memory/touch", response_model=MemoryMetaOut)
def touch_memory(
    path: str,
    session: Session = Depends(get_session),
    x_user_role: str = Header(default="admin", alias="X-User-Role"),
) -> MemoryFile:
    if is_context_snapshot(path):
        raise HTTPException(404, "memory file not found")
    require_memory_access(x_user_role, path, "read")
    row = touch_memory_impl(session, path)
    if not row:
        raise HTTPException(404, "memory file not found")
    return row


@router.put("/memory/file", response_model=MemoryMetaOut)
def put_memory(
    body: MemoryPutIn,
    session: Session = Depends(get_session),
    x_user_role: str = Header(default="admin", alias="X-User-Role"),
) -> MemoryFile:
    if is_context_snapshot(body.path):
        raise HTTPException(404, "memory file not found")
    if not body.path.startswith("/memories"):
        raise HTTPException(400, "path must be under /memories")
    require_memory_access(x_user_role, body.path, "write", project_id=body.project_id)
    proj = _memory_project_from_path(body.path)
    if body.project_id and proj and proj != body.project_id:
        raise HTTPException(403, "跨项目记忆写入被拒绝")
    check_cas = bool(body.check_cas) or body.expected_hash is not None
    try:
        result = cas_write_memory(
            session,
            path=body.path,
            content=body.content,
            project_id=body.project_id or proj,
            expected_hash=body.expected_hash,
            check_cas=check_cas,
            actor=body.actor or "user",
            source_run_id=body.source_run_id,
            source_conversation_id=body.source_conversation_id,
            is_hypothesis=body.is_hypothesis or ("hypothesis:" in body.path),
            change_summary=body.change_summary,
        )
    except MemoryFrozenError as exc:
        raise HTTPException(400, str(exc)) from exc
    except MemoryConflictError as exc:
        raise HTTPException(status_code=409, detail=exc.as_detail()) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return result.row


@router.delete("/memory/file")
def delete_memory(
    path: str,
    session: Session = Depends(get_session),
    x_user_role: str = Header(default="admin", alias="X-User-Role"),
    expected_hash: str | None = Query(default=None),
) -> dict[str, str]:
    require_memory_access(x_user_role, path, "write")
    if is_context_snapshot(path):
        raise HTTPException(404, "memory file not found")
    row = session.get(MemoryFile, path)
    if not row:
        raise HTTPException(404, "memory file not found")
    if row.frozen:
        raise HTTPException(400, "file is frozen")
    if expected_hash is not None and expected_hash != (row.hash or ""):
        raise HTTPException(
            status_code=409,
            detail=MemoryConflictError(path, row).as_detail(),
        )
    # 删除前快照
    session.add(
        MemoryVersion(
            path=row.path,
            store_id=row.store_id,
            content=row.content or "",
            hash=row.hash,
            precondition_hash=row.hash,
            note="删除前快照",
            actor="user",
            change_summary="delete",
        )
    )
    session.delete(row)
    session.commit()
    return {"status": "deleted"}


@router.post("/memory/search")
def search_memory(
    q: str = "",
    store_id: str | None = Query(default=None),
    project_id: str | None = Query(default=None),
    limit: int = Query(default=40, ge=1, le=200),
    session: Session = Depends(get_session),
) -> list[MemoryMetaOut]:
    return hybrid_search_memory(
        session, q, store_id=store_id, project_id=project_id, limit=limit
    )


@router.post("/memory/freeze", response_model=MemoryMetaOut)
def freeze_memory(
    path: str,
    session: Session = Depends(get_session),
) -> MemoryFile:
    if is_context_snapshot(path):
        raise HTTPException(404, "memory file not found")
    row = session.get(MemoryFile, path)
    if not row:
        raise HTTPException(404, "memory file not found")
    row.frozen = True
    row.updated_at = utcnow()
    if not row.store_id:
        row.store_id = resolve_store_id(path, project_id=row.project_id)
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@router.get("/memory/versions", response_model=list[MemoryVersionOut])
def memory_versions(
    path: str,
    session: Session = Depends(get_session),
) -> list[MemoryVersion]:
    if is_context_snapshot(path):
        raise HTTPException(404, "memory file not found")
    return list(
        session.exec(
            select(MemoryVersion)
            .where(MemoryVersion.path == path)
            .order_by(MemoryVersion.created_at.desc())
        )
    )


@router.post("/memory/versions", response_model=MemoryVersionOut)
def snapshot_memory(
    body: CreateMemoryVersionIn,
    session: Session = Depends(get_session),
) -> MemoryVersion:
    if is_context_snapshot(body.path):
        raise HTTPException(404, "memory file not found")
    row = session.get(MemoryFile, body.path)
    if not row:
        raise HTTPException(404, "memory file not found")
    ver = MemoryVersion(
        path=body.path,
        store_id=row.store_id or resolve_store_id(body.path, project_id=row.project_id),
        content=row.content,
        hash=row.hash,
        precondition_hash=row.hash,
        note=body.note,
        actor=row.actor or "user",
        source_run_id=row.source_run_id,
        source_conversation_id=row.source_conversation_id,
    )
    session.add(ver)
    session.commit()
    session.refresh(ver)
    return ver


@router.post("/memory/rollback", response_model=MemoryMetaOut)
def rollback_memory(
    body: RollbackMemoryIn,
    session: Session = Depends(get_session),
) -> MemoryFile:
    ver = session.get(MemoryVersion, body.version_id)
    if not ver:
        raise HTTPException(404, "version not found")
    if is_context_snapshot(ver.path):
        raise HTTPException(404, "memory file not found")
    row = session.get(MemoryFile, ver.path)
    try:
        result = cas_write_memory(
            session,
            path=ver.path,
            content=ver.content,
            project_id=row.project_id if row else None,
            expected_hash=row.hash if row else None,
            check_cas=False,
            actor="user",
            change_summary=f"rollback to {ver.id}",
            note="回滚前快照",
        )
    except MemoryFrozenError as exc:
        raise HTTPException(400, str(exc)) from exc
    return result.row


@router.get("/usage", response_model=list[UsageEventOut])
def list_usage(
    project_id: str | None = None,
    session: Session = Depends(get_session),
) -> list[UsageEventOut]:
    rows = list(session.exec(select(UsageEvent).order_by(UsageEvent.created_at.desc())))
    if project_id:
        rows = [u for u in rows if u.project_id == project_id]
    from ..usage_attribution import DIGEST_EVENT_PREFIX, usage_actor
    runs = {r.id: r for r in session.exec(select(AgentRun))}
    pricing_map = build_pricing_map(session)
    out: list[UsageEventOut] = []
    for u in rows:
        # 只读计算：cost_est 列是 NOT NULL，未知单价模型的 None 必须留在响应层，
        # 不能写回 ORM 对象（否则 autoflush 会以 NULL 更新 cost_est 触发 IntegrityError）。
        cost_est = cost_for_model(
            session,
            pricing_map,
            u.model,
            u.prompt_tokens,
            u.completion_tokens,
            u.cache_hit_tokens or 0,
            u.cache_miss_tokens or 0,
        )
        out.append(
            UsageEventOut.model_validate(u).model_copy(update={
                "phase": "run.digest" if u.id.startswith(DIGEST_EVENT_PREFIX) else None,
                "cost_est": cost_est, "agent_id": usage_actor(session, u, runs)[0],
                "bot_id": usage_actor(session, u, runs)[1],
            })
        )
    return out


_USAGE_BUDGET_KEY = "usage_budget_monthly"
_FEATURE_TOGGLES_KEY = "feature_toggles"

DEFAULT_FEATURE_TOGGLES: dict[str, bool] = {
    "qcDeAi": True,
    "logicScan": True,
    "revise20": True,
    "coolDensity": True,
    "pacePaywall": True,
    "storyGraphAutoUpdate": True,
    "foreshadowAutoUpdate": True,
}


@router.get("/settings/app")
def get_app_settings(session: Session = Depends(get_session)) -> dict:
    """应用级设置（单用户本地）：当前含月度用量上限。"""
    row = session.get(AppSetting, _USAGE_BUDGET_KEY)
    toggles_row = session.get(AppSetting, _FEATURE_TOGGLES_KEY)
    toggles = dict(DEFAULT_FEATURE_TOGGLES)
    if toggles_row and isinstance((toggles_row.value_json or {}).get("value"), dict):
        for key, value in (toggles_row.value_json or {}).get("value", {}).items():
            if isinstance(value, bool):
                toggles[key] = value
    return {
        "usageBudgetMonthly": (row.value_json or {}).get("value") if row else None,
        "featureToggles": toggles,
    }


@router.patch("/settings/app")
def patch_app_settings(
    body: AppSettingsPatchIn,
    session: Session = Depends(get_session),
) -> dict:
    data = body.model_dump(exclude_unset=True)
    if "usage_budget_monthly" not in data and "feature_toggles" not in data:
        return get_app_settings(session)
    if "usage_budget_monthly" in data:
        value = data["usage_budget_monthly"]
        row = session.get(AppSetting, _USAGE_BUDGET_KEY)
        if row is None:
            row = AppSetting(key=_USAGE_BUDGET_KEY, value_json={})
            session.add(row)
        row.value_json = {"value": value}
        row.updated_at = utcnow()
        session.add(row)
    if "feature_toggles" in data:
        incoming = data.get("feature_toggles") or {}
        merged = dict(DEFAULT_FEATURE_TOGGLES)
        if isinstance(incoming, dict):
            for key, value in incoming.items():
                if isinstance(value, bool):
                    merged[key] = value
        toggles_row = session.get(AppSetting, _FEATURE_TOGGLES_KEY)
        if toggles_row is None:
            toggles_row = AppSetting(key=_FEATURE_TOGGLES_KEY, value_json={})
            session.add(toggles_row)
        toggles_row.value_json = {"value": merged}
        toggles_row.updated_at = utcnow()
        session.add(toggles_row)
    session.commit()
    return get_app_settings(session)


@router.get("/settings/llm-traffic")
def get_llm_traffic(session: Session = Depends(get_session)) -> dict[str, Any]:
    """LLM 流量治理状态：可调 cap + 当前有效并发 / 节流只读。"""
    from .. import llm_governor

    return llm_governor.status(session).to_dict()


@router.patch("/settings/llm-traffic")
def patch_llm_traffic(
    body: LlmTrafficPatchIn,
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    from .. import llm_governor

    data = body.model_dump(exclude_unset=True)
    if data:
        llm_governor.save_config(session, data)
    return llm_governor.status(session).to_dict()


@router.get("/internal/llm-governor")
def get_llm_governor_worker_view() -> dict[str, Any]:
    """Agent-worker 轮询：有效并发与节流窗。"""
    from .. import llm_governor

    return llm_governor.worker_view()


@router.post("/internal/llm-governor/report")
def post_llm_governor_report(body: LlmGovernorReportIn) -> dict[str, Any]:
    """Worker 上报 success/throttle，驱动自适应掉队。"""
    from .. import llm_governor

    event = (body.event or "").strip().lower()
    if event == "success":
        llm_governor.report_success()
    elif event in {"throttle", "rate_limited", "429", "529"}:
        llm_governor.report_throttle(
            retry_after_s=body.retry_after_s,
            provider_id=body.provider_id,
        )
    else:
        raise HTTPException(400, f"unknown event: {body.event}")
    return llm_governor.worker_view()


def _usage_by_bot_rows(session: Session, by_bot: dict[str, int]) -> list[dict]:
    from ..usage_attribution import usage_roster

    names = usage_roster(session)
    return sorted(
        ({"botId": bot_id, "name": names.get(bot_id) or bot_id, "tokens": by_bot.get(bot_id, 0)}
         for bot_id in names.keys() | by_bot.keys()),
        key=lambda row: (-row["tokens"], row["botId"]),
    )


@router.get("/usage/summary")
def usage_summary(session: Session = Depends(get_session)) -> dict:
    """本月用量汇总 + 真实预算（设置页月度上限）与剩余。"""
    from collections import defaultdict
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    rows = [
        u
        for u in session.exec(select(UsageEvent)).all()
        if u.created_at is not None and u.created_at >= month_start
    ]
    from ..usage_attribution import usage_actor
    from ..agent_colleagues import load_catalog_by_id
    runs = {r.id: r for r in session.exec(select(AgentRun))}
    pricing_map = build_pricing_map(session)
    by_model: dict[str, int] = defaultdict(int)
    by_bot: dict[str, int] = defaultdict(int)
    by_agent: dict[str, int] = defaultdict(int, {aid: 0 for aid in load_catalog_by_id()})
    used = 0
    cost_total = 0.0
    for u in rows:
        n = int(u.prompt_tokens or 0) + int(u.completion_tokens or 0)
        used += n
        by_model[u.model] += n
        est = cost_for_model(
            session,
            pricing_map,
            u.model,
            u.prompt_tokens,
            u.completion_tokens,
            u.cache_hit_tokens or 0,
            u.cache_miss_tokens or 0,
        )
        if est is not None:
            cost_total += est
        agent_id, bot_id = usage_actor(session, u, runs)
        by_bot[bot_id] += n
        if agent_id:
            by_agent[agent_id] += n
    # 例程成本：按 ScheduledTask.last_cost_tokens / run_count
    by_routine: list[dict] = []
    try:
        from ..models import ScheduledTask

        for t in session.exec(select(ScheduledTask).where(ScheduledTask.bot_id != None)):  # noqa: E711
            by_routine.append(
                {
                    "id": t.id,
                    "name": t.name,
                    "botId": t.bot_id,
                    "runCount": int(getattr(t, "run_count", 0) or 0),
                    "lastCostTokens": int(getattr(t, "last_cost_tokens", 0) or 0),
                    "enabled": t.enabled,
                }
            )
    except Exception:  # noqa: BLE001
        pass
    setting = session.get(AppSetting, _USAGE_BUDGET_KEY)
    budget = (setting.value_json or {}).get("value") if setting else None
    budget_n = int(budget) if isinstance(budget, int) and budget >= 0 else None
    return {
        "used": used,
        "costEst": round(cost_total, 6),
        "budget": budget_n,
        "remaining": (budget_n - used) if budget_n is not None else None,
        "over": budget_n is not None and used > budget_n,
        "byModel": sorted(
            ({"model": m, "tokens": n} for m, n in by_model.items()),
            key=lambda r: -r["tokens"],
        ),
        "byBot": _usage_by_bot_rows(session, by_bot),
        "byAgent": sorted(
            ({"agentId": a, "tokens": n} for a, n in by_agent.items()),
            key=lambda r: -r["tokens"],
        ),
        "byRoutine": sorted(by_routine, key=lambda r: -int(r.get("lastCostTokens") or 0)),
    }


_FLOW_DONE_STAGE = {
    "manju": "S11_DONE",
    "duanju": "S7_SUBMIT",
    "short_novel": "S9_DONE",
    "male_long": "S10_DONE",
    "female_long": "S10_DONE",
    "ip_adapt": "S8_DONE",
}


@router.get("/dashboard/summary")
def dashboard_summary(
    days: int = Query(default=14, ge=1, le=90, description="用量趋势窗口（天）"),
    session: Session = Depends(get_session),
) -> dict:
    """选题 / 交稿数据看板：按格式、状态、字数、采纳率、用量汇总。"""
    projects = list(session.exec(select(Project)))
    project_ids = {p.id for p in projects}
    arts = [
        a for a in session.exec(select(Artifact)) if a.project_id in project_ids
    ]
    usage_rows = [
        u for u in session.exec(select(UsageEvent))
        if not u.project_id or u.project_id in project_ids
    ]

    by_format: dict[str, dict] = {}
    by_status: dict[str, int] = {}
    total_manuscripts = 0
    adopted_manuscripts = 0
    total_words = 0
    flow_done = 0
    package_done = 0

    for p in projects:
        fmt = p.format or "manju"
        p_arts = [a for a in arts if a.project_id == p.id]
        manuscripts = [a for a in p_arts if a.type == "manuscript"]
        adopted = sum(1 for a in manuscripts if a.status == "adopted")
        words = sum(_word_count(a) for a in manuscripts)
        is_flow_done = p.stage == _FLOW_DONE_STAGE.get(fmt, "S11_DONE")
        is_package_done = _project_package_done(fmt, p, p_arts)

        total_manuscripts += len(manuscripts)
        adopted_manuscripts += adopted
        total_words += words
        flow_done += int(is_flow_done)
        package_done += int(is_package_done)

        row = by_format.setdefault(
            fmt,
            {
                "format": fmt,
                "label": _FORMAT_LABELS.get(fmt, fmt),
                "projects": 0,
                "flowDone": 0,
                "packageDone": 0,
                "wordCount": 0,
                "manuscripts": 0,
                "adopted": 0,
            },
        )
        row["projects"] += 1
        row["flowDone"] += int(is_flow_done)
        row["packageDone"] += int(is_package_done)
        row["wordCount"] += words
        row["manuscripts"] += len(manuscripts)
        row["adopted"] += adopted

        status = p.status or "active"
        by_status[status] = by_status.get(status, 0) + 1

    from collections import defaultdict
    from datetime import datetime, timedelta, timezone

    tokens_total = sum(
        int(u.prompt_tokens or 0) + int(u.completion_tokens or 0) for u in usage_rows
    )
    trend_map: dict[str, int] = defaultdict(int)
    now = datetime.now(timezone.utc).date()
    for u in usage_rows:
        day = (u.created_at.date() if u.created_at else now).isoformat()
        trend_map[day] += int(u.prompt_tokens or 0) + int(u.completion_tokens or 0)
    trend_days = [(now - timedelta(days=i)).isoformat() for i in range(days - 1, -1, -1)]
    usage_trend = [
        {"day": d, "tokens": trend_map.get(d, 0)} for d in trend_days
    ]

    adoption_rate = round(adopted_manuscripts / total_manuscripts, 4) if total_manuscripts else 0
    return {
        "totals": {
            "projects": len(projects),
            "active": by_status.get("active", 0),
            "flowDone": flow_done,
            "packageDone": package_done,
            "wordCount": total_words,
            "manuscripts": total_manuscripts,
            "adopted": adopted_manuscripts,
            "adoptionRate": adoption_rate,
            "tokenUsed": tokens_total,
        },
        "byFormat": sorted(by_format.values(), key=lambda r: -r["projects"]),
        "byStatus": [{"status": k, "count": v} for k, v in sorted(by_status.items())],
        "usageTrend": usage_trend,
    }


@router.post("/projects/{project_id}/runs/{run_id}/proposal-checklist", response_model=ArtifactOut)
def save_colleague_checklist(project_id: str, run_id: str, body: dict, session: Session = Depends(get_session)):
    from uuid import NAMESPACE_URL, uuid5
    from ..models import ArtifactVersion
    from .agents_catalog import _load_agent_catalog

    # Claim the run row before looking up its deterministic report. This also
    # serializes retries on SQLite, where SELECT FOR UPDATE has no effect.
    claimed = session.execute(update(AgentRun).where(
        AgentRun.id == run_id, AgentRun.project_id == project_id,
        AgentRun.agent_id == "colleague.proactive"
    ).values(id=run_id)).rowcount
    project = session.get(Project, project_id)
    if not claimed or not project:
        raise HTTPException(404, "colleague run not found in project")
    items, title = body.get("items"), body.get("title")
    if not isinstance(title, str) or not title.strip() or not isinstance(items, list) or not 1 <= len(items) <= 5:
        raise HTTPException(422, "title and 1–5 items required")
    catalog = {agent["id"]: agent["formats"] for agent in _load_agent_catalog()}
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            raise HTTPException(422, f"items.{index}: expected proposal")
        agent = item.get("agentId")
        formats = catalog.get(agent, []) if isinstance(agent, str) else []
        if ("*" not in formats and project.format not in formats) or not isinstance(item.get("message"), str) or not item["message"].strip() or item.get("needsApproval") is not True or item.get("done", False) is not False or item.get("priority") not in ("P0","P1","P2"):
            raise HTTPException(422, f"items.{index}: require executable agentId for {project.format}, message, needsApproval=true, priority=P0|P1|P2 and pending done=false")
    report_id = str(uuid5(NAMESPACE_URL, f"colleague-report/{project_id}/{run_id}"))
    existing = session.get(Artifact, report_id)
    if existing:
        if existing.body_json.get("items") != items or existing.title != title:
            raise HTTPException(409, "this run already has a different proposal checklist")
        return existing
    proposals = []
    for index, item in enumerate(items):
        action = dict(type="agent.run", agentId=item["agentId"], needsApproval=True,
                      sourceRunId=run_id, sourceReportId=report_id, actionId=f"proposal-{index}")
        proposals.append(TaskProposal(type="colleague.proactive", project_id=project_id,
            message=item["message"], priority={"P0":3,"P1":2,"P2":1}[item["priority"]], actions=[action]))
    report = Artifact(id=report_id, project_id=project_id, created_by_run_id=run_id,
        type="qc_report", title=title, body_markdown="\n".join(f"- [ ] {p.message}" for p in proposals),
        body_json={"items":items, "proposalIds":[p.id for p in proposals]})
    session.add_all([*proposals, report, ArtifactVersion(artifact_id=report.id, version=1,
        title=title, status=report.status, body_markdown=report.body_markdown, body_json=report.body_json,
        note="初始版本", actor=f"agent:{run_id}")])
    session.commit()
    session.refresh(report)
    return report


@router.get("/task-proposals", response_model=list[TaskProposalOut])
def list_proposals(session: Session = Depends(get_session)) -> list[TaskProposal]:
    return list(
        session.exec(
            select(TaskProposal).order_by(TaskProposal.priority.desc(), TaskProposal.created_at.desc())
        )
    )


@router.post("/colleague/scan")
def colleague_scan_now(session: Session = Depends(get_session)) -> dict:
    """手动触发主动同事缺口扫描（写入 TaskProposal，不自动写稿）。"""
    import sys
    from pathlib import Path

    sched = Path(__file__).resolve().parents[3] / "scheduler"
    if str(sched) not in sys.path:
        sys.path.insert(0, str(sched))
    from gap_scan import run_colleague_scan  # type: ignore

    n = run_colleague_scan(session, limit=12)
    session.commit()
    return {"ok": True, "proposalsCreated": n}


@router.post("/task-proposals/{proposal_id}/approve", response_model=TaskProposalOut)
def approve_proposal(proposal_id: str, session: Session = Depends(get_session)) -> TaskProposalOut:
    from ..models import AgentRun, Job
    from ..queue import enqueue_job, publish_job_event

    claimed = session.execute(update(TaskProposal).where(
        TaskProposal.id == proposal_id, TaskProposal.status == "pending"
    ).values(status="approved", read=True)).rowcount
    row = session.get(TaskProposal, proposal_id, populate_existing=True)
    if not row:
        raise HTTPException(404, "proposal not found")
    project = session.get(Project, row.project_id) if row.project_id else None
    if not project:
        raise HTTPException(409, "proposal project unavailable")
    if not claimed:
        existing = session.exec(select(Job).where(
            Job.project_id == row.project_id, Job.payload["fromProposal"].as_string() == row.id
        ).order_by(Job.created_at.desc())).first()
        run = session.get(AgentRun, existing.result_ref) if existing and existing.result_ref else None
        if (row.status != "approved" or not run or existing.user_id != project.user_id
                or existing.payload.get("runId") != run.id or run.project_id != project.id
                or (run.input_json or {}).get("fromProposal") != row.id):
            raise HTTPException(409, "proposal has no reusable approval receipt")
        out = TaskProposalOut.model_validate(row)
        out.run_id, out.job_id = existing.result_ref, existing.id
        return out
    queued = []
    last_run_id: str | None = None
    last_job_id: str | None = None
    # approve 才入队写操作：创建完整 AgentRun + Job.result_ref
    for action in row.actions or []:
        if action.get("type") == "agent.run" and action.get("agentId"):
            agent_id = str(action["agentId"])
            input_json = {
                "task": row.message,
                **(action.get("inputJson") or {}),
                "fromProposal": row.id,
            }
            run = AgentRun(
                project_id=row.project_id,
                agent_id=agent_id,
                status="queued",
                input_json=input_json,
                model=resolve_default_model(),
            )
            job = Job(
                type="agent.run",
                payload={
                    "runId": run.id,
                    "agentId": agent_id,
                    "input": input_json,
                    "fromProposal": row.id,
                },
                project_id=row.project_id,
                user_id=project.user_id,
                status="queued",
                result_ref=run.id,
            )
            session.add(run)
            session.add(job)
            queued.append((job, run))
            last_run_id = run.id
            last_job_id = job.id
    session.commit()
    for job, run in queued:
        enqueue_job(job.id, {"type": job.type, "payload": job.payload, "runId": run.id})
        publish_job_event(job.id, {"type": "status", "status": "queued", "jobId": job.id, "runId": run.id})
    session.refresh(row)
    out = TaskProposalOut.model_validate(row)
    out.run_id = last_run_id
    out.job_id = last_job_id
    return out


@router.post("/task-proposals/{proposal_id}/dismiss", response_model=TaskProposalOut)
def dismiss_proposal(proposal_id: str, session: Session = Depends(get_session)) -> TaskProposal:
    row = session.get(TaskProposal, proposal_id)
    if not row:
        raise HTTPException(404, "proposal not found")
    changed = session.execute(update(TaskProposal).where(
        TaskProposal.id == row.id, TaskProposal.status.in_(["pending", "dismissed"])
    ).values(status="dismissed", read=True)).rowcount
    if not changed:
        raise HTTPException(409, "approved proposal cannot be dismissed")
    session.commit()
    session.refresh(row)
    return row


@router.get("/settings/providers", response_model=list[ProviderOut])
def list_providers(session: Session = Depends(get_session)) -> list[ProviderConfig]:
    rows = list(
        session.exec(
            select(ProviderConfig)
            .order_by(ProviderConfig.is_default.desc())
        )
    )
    for row in rows:
        if row.pricing is None:
            row.pricing = {}
    return rows


@router.post("/settings/providers", response_model=ProviderOut)
def upsert_provider(
    body: ProviderUpsertIn,
    session: Session = Depends(get_session),
) -> ProviderConfig:
    if body.id:
        row = session.get(ProviderConfig, body.id)
        if not row:
            raise HTTPException(404, "provider not found")
    else:
        row = ProviderConfig(name=body.name, base_url=body.base_url)
        session.add(row)
    row.name = body.name
    row.base_url = body.base_url
    if body.api_key:
        row.api_key_enc = encrypt_secret(body.api_key)
        row.api_key_masked = mask_secret(body.api_key)
    row.models = body.models
    models = [str(model).strip() for model in body.models if str(model).strip()]
    selected = str(body.selected_model or "").strip()
    row.selected_model = selected if selected in models else (models[0] if models else None)
    row.enabled = body.enabled
    row.pricing = sanitize_pricing(body.pricing)
    if body.is_default:
        from ..llm_service import _has_real_key

        if not _has_real_key(decrypt_secret(row.api_key_enc or "")):
            raise HTTPException(
                400,
                "该服务商未配置有效 API Key，无法设为默认。请先填写并保存 API Key。",
            )
        row.is_default = True
        for other in list(
            session.exec(
                select(ProviderConfig).where(ProviderConfig.id != row.id)
            )
        ):
            other.is_default = False
            session.add(other)
    else:
        row.is_default = False
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@router.post("/maintenance/recalc-token-usage")
def recalc_token_usage(session: Session = Depends(get_session)) -> dict[str, Any]:
    """按 UsageEvent 明细重建各项目 token_used（修复历史重复计数/缺记）。"""
    projects = list(session.exec(select(Project)).all())
    events = list(session.exec(select(UsageEvent)).all())
    by_project: dict[str, int] = defaultdict(int)
    for u in events:
        if u.project_id:
            by_project[u.project_id] += int(u.prompt_tokens or 0) + int(
                u.completion_tokens or 0
            )
    updated = 0
    for p in projects:
        next_value = by_project.get(p.id, 0)
        if int(p.token_used or 0) != next_value:
            p.token_used = next_value
            p.updated_at = utcnow()
            session.add(p)
            updated += 1
    session.commit()
    return {"updatedProjects": updated, "total": len(projects), "events": len(events)}


@router.patch("/settings/providers/{provider_id}/default", response_model=ProviderOut)
def set_default_provider(
    provider_id: str,
    session: Session = Depends(get_session),
) -> ProviderConfig:
    row = session.get(ProviderConfig, provider_id)
    if not row:
        raise HTTPException(404, "provider not found")
    # 运行时只认有真 Key 的默认项；无 Key 时设默认会静默落到其它厂商，表现为「设了不生效」。
    from ..llm_service import _has_real_key

    if not _has_real_key(decrypt_secret(row.api_key_enc or "")):
        raise HTTPException(
            400,
            "该服务商未配置有效 API Key，无法设为默认。请先保存 Key，或选择已有 Key 的同名条目。",
        )
    for other in list(
        session.exec(
                select(ProviderConfig).where(ProviderConfig.id != provider_id)
        )
    ):
        other.is_default = False
        session.add(other)
    row.is_default = True
    if not row.selected_model and row.models:
        row.selected_model = row.models[0]
    row.enabled = True
    row.pricing = row.pricing or {}
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@router.delete("/settings/providers/{provider_id}")
def delete_provider(
    provider_id: str,
    session: Session = Depends(get_session),
) -> dict[str, str]:
    row = session.get(ProviderConfig, provider_id)
    if not row:
        raise HTTPException(404, "provider not found")
    session.delete(row)
    session.commit()
    return {"status": "deleted"}


@router.post("/settings/providers/test", response_model=ProviderTestOut)
async def test_provider(
    body: ProviderTestIn,
    session: Session = Depends(get_session),
) -> ProviderTestOut:
    from ..llm_service import chat_completion

    base_url = body.base_url
    api_key = body.api_key
    model = body.model
    if body.provider_id:
        row = session.get(ProviderConfig, body.provider_id)
        if not row:
            raise HTTPException(404, "provider not found")
        base_url = base_url or row.base_url
        api_key = api_key or decrypt_secret(row.api_key_enc or "") or ""
        model = model or row.selected_model
    if not base_url:
        raise HTTPException(422, "baseUrl（或 providerId）必填")

    try:
        result = await chat_completion(
            [{"role": "user", "content": "ping"}],
            base_url=base_url,
            api_key=api_key or "",
            model=model,
            max_tokens=4,
            temperature=0,
        )
        record_model_usage(result, agent_id="system.provider_test", session=session)
        return ProviderTestOut(ok=True, model=result.model)
    except Exception as exc:  # noqa: BLE001
        return ProviderTestOut(ok=False, error=str(exc))


@router.get("/scheduled-tasks", response_model=list[ScheduledTaskOut])
def list_scheduled(session: Session = Depends(get_session)) -> list[ScheduledTask]:
    return list(session.exec(select(ScheduledTask)))


@router.post("/scheduled-tasks", response_model=ScheduledTaskOut)
def create_scheduled(
    body: CreateScheduledTaskIn,
    session: Session = Depends(get_session),
) -> ScheduledTask:
    try:
        schedule = validate_schedule(body.cron_or_interval)
    except ValueError as exc:
        raise HTTPException(422, detail={"code": "invalid_schedule", "message": str(exc)}) from exc
    from ..knowledge_colleague import colleague, owned_project
    from ..settings import get_settings
    tpl = dict(body.payload_template)
    tpl.pop("knowledgeBotId", None)
    bot_id = body.bot_id or tpl.get("bot_id")
    if bot_id:
        project_id = tpl.get("project_id") or tpl.get("projectId") or body.event_filter.get("project_id")
        owner = get_settings().demo_user_id
        if project_id:
            owned_project(session, project_id, owner)
        actor = colleague(session, bot_id, owner, project_id)
        if tpl.get("bot_id") not in (None, actor.id) or body.event_filter.get("project_id") not in (None, project_id):
            raise HTTPException(422, "例程来源与同事或项目不一致")
        tpl.update(type="bot.routine", bot_id=actor.id, project_id=project_id)
        if (actor.execution or {}).get("enabled"):
            tpl["knowledgeBotId"] = actor.id
    row = ScheduledTask(
        bot_id=bot_id, prompt=body.prompt, trigger_type=body.trigger_type, event_filter=body.event_filter,
        quiet_policy=body.quiet_policy, active_window=body.active_window,
        id=body.id or f"task-{new_id()}",
        name=body.name,
        cron_or_interval=schedule,
        next_run_at=initial_run_at(schedule, utcnow()),
        enabled=body.enabled,
        owner_scope=body.owner_scope,
        description=body.description,
        payload_template=tpl,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@router.delete("/scheduled-tasks/{task_id}")
def delete_scheduled(task_id: str, session: Session = Depends(get_session)) -> dict[str, str]:
    row = session.get(ScheduledTask, task_id)
    if not row:
        raise HTTPException(404, "scheduled task not found")
    session.delete(row)
    session.commit()
    return {"status": "deleted"}


@router.patch("/scheduled-tasks/{task_id}", response_model=ScheduledTaskOut)
def patch_scheduled(
    task_id: str,
    session: Session = Depends(get_session),
    enabled: bool | None = Query(None),
    body: PatchScheduledTaskIn | None = Body(None),
) -> ScheduledTask:
    row = session.get(ScheduledTask, task_id)
    if not row:
        raise HTTPException(404, "task not found")
    if body and body.cron_or_interval is not None:
        try:
            row.cron_or_interval = validate_schedule(body.cron_or_interval)
            row.next_run_at = initial_run_at(row.cron_or_interval, utcnow())
        except ValueError as exc:
            raise HTTPException(422, detail={"code": "invalid_schedule", "message": str(exc)}) from exc
    elif (body and body.enabled) or enabled:
        try:
            validate_schedule(row.cron_or_interval)
            if not row.enabled or row.next_run_at is None:
                row.next_run_at = initial_run_at(row.cron_or_interval, utcnow())
        except ValueError as exc:
            raise HTTPException(422, detail={"code": "invalid_schedule", "message": str(exc)}) from exc
    if body:
        if body.enabled is not None:
            row.enabled = body.enabled
        if body.prompt is not None:
            row.prompt = body.prompt
    elif enabled is not None:
        row.enabled = enabled
    else:
        raise HTTPException(400, "enabled query or JSON body required")
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@router.get("/prompts", response_model=list[PromptTemplateOut])
def list_prompts(session: Session = Depends(get_session)) -> list[PromptTemplateRow]:
    rows = list(session.exec(select(PromptTemplateRow)))
    # 旧库可能只种了 1 条：按需从 catalog 补齐
    if len(rows) < 10:
        from ..seed import sync_prompts_from_catalog

        sync_prompts_from_catalog(session)
        rows = list(session.exec(select(PromptTemplateRow)))
    return rows


@router.get("/prompts/packs")
def list_prompt_packs() -> dict:
    from ..seed import _load_prompt_catalog

    catalog = _load_prompt_catalog()
    return {
        "packs": catalog.get("packs") or [],
        "skillLinks": catalog.get("skillLinks") or {},
        "count": len(catalog.get("packs") or []),
    }


@router.post("/prompts/validate", response_model=list[GateCheckOut])
def validate_prompt(body: PromptValidateIn) -> list[dict[str, str]]:
    return check_prompt_lock(
        body.editable_instruction,
        body.required_phrases,
        body.locked_hash,
        body.locked_system,
    )
