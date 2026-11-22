from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any

from sqlalchemy.dialects.sqlite import insert
from sqlmodel import Session, select

from app.crypto import decrypt_secret
from app.llm_service import chat_completion
from app.models import AgentRun, Artifact, Job, KnowledgeDoc, MemoryVersion, RunDigest, TaskProposal, UsageEvent, new_id
from app.personal_agent_output import IncompleteAgentOutput, actual_usage, validate_agent_output
from app.usage_attribution import DIGEST_EVENT_PREFIX, record_model_usage
from app.queue import publish_job_event
from app.run_digest import compose_run_digest

logger = logging.getLogger("job-worker.handlers")

class JobCancelledError(RuntimeError):
    """Cooperative cancellation between bounded background execution steps."""


REPORT_TYPES = [
    ("dissect_params", "拆书参数报告"),
    ("unit_story", "单元故事拆解"),
    ("seven_steps", "七步法报告"),
    ("core_hook_extract", "核心梗提取"),
    ("emotion_curve", "情绪曲线报告"),
    ("cool_point_map", "爽点/虐点分布"),
    ("hook_map", "期待感/钩子报告"),
    ("style_extract", "文风要素报告"),
    ("gap_report", "对标差距报告"),
    ("redline_report", "风险红线报告"),
]


def _repo_package_roots() -> list[Path]:
    """本地 monorepo 与 compose 挂载（/packages）双路径。"""
    from pathlib import Path

    here = Path(__file__).resolve()
    roots = [
        here.parents[2],  # repo root when services/job-worker/...
        Path("/packages").parent,  # / when /packages mounted
        Path("/"),
    ]
    out: list[Path] = []
    for r in roots:
        if r not in out:
            out.append(r)
    return out


def _load_agent_skill_body(agent_id: str) -> str:
    """从 agent-catalog / skills 目录加载 SKILL 正文，供 Python fallback 对齐 Agent 规格。"""
    from pathlib import Path

    skill_rel = None
    catalog_candidates = [
        root / "packages/agent-runtime/agent-catalog.json"
        if (root / "packages").exists()
        else root / "agent-runtime/agent-catalog.json"
        for root in _repo_package_roots()
    ]
    catalog_candidates.extend(
        [
            Path("/packages/agent-runtime/agent-catalog.json"),
            Path(__file__).resolve().parents[2]
            / "packages/agent-runtime/agent-catalog.json",
        ]
    )
    for catalog in catalog_candidates:
        try:
            if not catalog.is_file():
                continue
            data = json.loads(catalog.read_text(encoding="utf-8"))
            for a in data.get("agents") or []:
                if a.get("id") == agent_id:
                    skill_rel = a.get("skillPath")
                    break
            if skill_rel:
                break
        except Exception:  # noqa: BLE001
            continue

    candidates: list[Path] = []
    if skill_rel:
        # catalog skillPath 形如 manju/core-hook 或 skills/manju/core-hook 或 kb/report-pipeline
        rel = str(skill_rel).removeprefix("skills/")
        for root in _repo_package_roots():
            candidates.append(root / "packages/agent-runtime/skills" / rel / "SKILL.md")
            candidates.append(root / "agent-runtime/skills" / rel / "SKILL.md")
            candidates.append(root / "packages/agent-runtime" / str(skill_rel) / "SKILL.md")
        candidates.append(Path("/packages/agent-runtime/skills") / rel / "SKILL.md")
        candidates.append(Path("/packages/agent-runtime") / str(skill_rel) / "SKILL.md")
    for p in candidates:
        try:
            if p.is_file():
                text = p.read_text(encoding="utf-8")
                if text.startswith("---"):
                    parts = text.split("---", 2)
                    return (parts[2] if len(parts) >= 3 else text).strip()[:14000]
                return text[:14000]
        except OSError:
            continue
    return (
        f"你是写作 Agent `{agent_id}`。按九格方法论完成任务，输出可直接采用的中文结果。"
        "遵守 ChunkPolicy：禁止一次输出全书。"
    )


def _parse_json_array(text: str) -> list[dict[str, Any]]:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    try:
        data = json.loads(text)
        if isinstance(data, list):
            return [x for x in data if isinstance(x, dict)]
        if isinstance(data, dict) and "items" in data:
            return list(data["items"])
    except json.JSONDecodeError:
        pass
    match = re.search(r"\[[\s\S]*\]", text)
    if match:
        try:
            data = json.loads(match.group(0))
            if isinstance(data, list):
                return [x for x in data if isinstance(x, dict)]
        except json.JSONDecodeError:
            return []
    return []


def _parse_json_object(text: str) -> dict[str, Any]:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        try:
            data = json.loads(match.group(0))
            if isinstance(data, dict):
                return data
        except json.JSONDecodeError:
            return {"raw": text}
    return {"raw": text}


async def handle_kb_ingest(session: Session, job: Job) -> None:
    from kb_pipeline import ingest_document

    doc_id = (job.payload or {}).get("docId")
    doc = session.get(KnowledgeDoc, doc_id) if doc_id else None
    if not doc:
        raise RuntimeError("kb doc not found")
    publish_job_event(job.id, {"type": "token", "text": f"解析文档《{doc.title}》…\n"})
    try:
        await ingest_document(session, doc, job)
    except Exception:
        session.rollback()
        doc.status = "failed"
        session.add(doc)
        session.commit()
        raise
    publish_job_event(job.id, {"type": "token", "text": "入库完成。\n"})


async def handle_kb_analyze(session: Session, job: Job) -> None:
    from kb_pipeline import analyze_document

    doc_id = (job.payload or {}).get("docId")
    doc = session.get(KnowledgeDoc, doc_id) if doc_id else None
    if not doc:
        raise RuntimeError("kb doc not found")
    doc.status = "analyzing"
    session.add(doc)
    session.commit()
    publish_job_event(job.id, {"type": "token", "text": f"开始拆书分析《{doc.title}》…\n"})
    try:
        await analyze_document(session, doc, job)
    except JobCancelledError:
        session.rollback()
        doc.status = "ready"
        session.add(doc)
        session.commit()
        raise
    except Exception as exc:  # noqa: BLE001
        # 分析中途失败也必须把文档状态重置，避免永远卡在 analyzing。
        session.rollback()
        doc.status = "failed"
        session.add(doc)
        session.commit()
        publish_job_event(job.id, {"type": "token", "text": f"分析失败：{exc}\n"})
        raise
    doc.status = "ready"
    session.add(doc)
    session.commit()
    publish_job_event(job.id, {"type": "token", "text": "分析报告已生成。\n"})


async def handle_kb_reindex_all(session: Session, job: Job) -> None:
    """全量重建上传文档的持久化全文检索索引（kb_fts + kb_doc_vector）。"""
    from kb_pipeline import _extract_text_from_storage
    from kb_retrieval import index_document

    docs = list(session.exec(select(KnowledgeDoc)).all())
    ok = 0
    for d in docs:
        try:
            text = _extract_text_from_storage(d)
            index_document(d.id, d.title, text)
            ok += 1
        except Exception as exc:  # noqa: BLE001
            publish_job_event(job.id, {"type": "token", "text": f"索引失败《{d.title}》：{exc}\n"})
    job.result_ref = json.dumps({"reindexed": ok, "total": len(docs)}, ensure_ascii=False)
    session.add(job)
    session.commit()
    publish_job_event(job.id, {"type": "token", "text": f"全文索引重建完成：{ok}/{len(docs)}\n"})


async def handle_knowledge_reindex(session: Session, job: Job) -> None:
    from knowledge_vector import reindex_knowledge

    limit = (job.payload or {}).get("limit")
    publish_job_event(job.id, {"type": "token", "text": "开始灌入蒸馏知识向量…\n"})
    result = await reindex_knowledge(limit=int(limit) if limit else None)
    publish_job_event(
        job.id,
        {
            "type": "token",
            "text": f"完成：backend={result.get('backend')} count={result.get('count')}\n",
        },
    )
    job.result_ref = json.dumps(result, ensure_ascii=False)
    session.add(job)
    session.commit()


async def handle_hotspot_refresh(session: Session, job: Job) -> None:
    """更新公开榜单摘要，或保存显式提交的手动热点。"""
    from app.models import Hotspot

    payload = job.payload or {}
    if "title" not in payload and "summary" not in payload:
        await _run_live_crawler_job(session, job)
        return

    title = payload.get("title")
    if not isinstance(title, str) or not title.strip():
        raise ValueError("手动录入热点需要提供非空标题（title）。")
    summary = payload.get("summary")
    if summary is not None and not isinstance(summary, str):
        raise ValueError("手动热点摘要（summary）必须为文本。")
    genre = payload.get("genre") or "综合"
    if not isinstance(genre, str):
        raise ValueError("手动热点题材（genre）必须为文本。")
    meta = {"kind": "manual"}
    if isinstance(payload.get("sourceId"), str) and payload["sourceId"].strip():
        meta["submittedSourceId"] = payload["sourceId"]
    row = Hotspot(
        title=title,
        genre=genre,
        source="manual",
        summary=summary or "",
        status="ok",
        meta=meta,
    )
    job.result_ref = json.dumps({"status": "done", "source": "manual", "hotspotId": row.id}, ensure_ascii=False)
    session.add(row)
    session.add(job)
    session.commit()
    publish_job_event(job.id, {"type": "token", "text": f"已保存手动热点：{title}\n"})


async def handle_crawler_run(session: Session, job: Job) -> None:
    """按现有爬虫任务入口采集公开榜单。"""
    await _run_live_crawler_job(session, job)


async def _run_live_crawler_job(session: Session, job: Job) -> None:
    from app.crawler.fetchers import FETCHERS
    from app.crawler.service import run_and_persist
    from app.models import CrawlerSource, utcnow

    payload = job.payload or {}
    requested_id = None
    selection_error = None
    results: list[dict[str, Any]] = []
    sources = select(CrawlerSource.id, CrawlerSource.name)
    if "sourceId" in payload:
        value = payload["sourceId"]
        if not isinstance(value, str) or not value or value != value.strip():
            selection_error = "请在 /kb/crawler 核对配置，并填写准确且非空的 sourceId。"
            targets = []
        else:
            requested_id = value
            targets = list(session.exec(sources.where(CrawlerSource.id == requested_id)))
            if not targets:
                selection_error = "未找到指定数据源，请在 /kb/crawler 核对 sourceId。"
                results.append({"id": requested_id, "status": "blocked", "items": 0, "error": selection_error})
    else:
        targets = [
            (source_id, name)
            for source_id, name in session.exec(sources.where(CrawlerSource.enabled == True))  # noqa: E712
            if not source_id.startswith("manual")
        ]

    for source_id, name in targets:
        source = {"id": source_id, "name": name}
        row = session.get(CrawlerSource, source_id, populate_existing=True)
        if row is None:
            reason = "数据源已移除，请在 /kb/crawler 核对配置。"
        elif not row.enabled:
            reason = "数据源已停用，请在 /kb/crawler 启用。"
        elif not row.robots_ack:
            reason = "请在 /kb/crawler 确认该源的 robots 与服务条款。"
        elif row.id.startswith("manual"):
            reason = "手动源请在热点页录入。实时刷新请选择公开榜单数据源。"
        elif row.id not in FETCHERS:
            reason = "该源缺少抓取适配器，请在 /kb/crawler 选择已支持的源。"
        else:
            reason = None
        if reason:
            results.append({**source, "status": "blocked", "items": 0, "error": reason})
            continue

        try:
            raw_cookie = row.cookie or ""
            cookie = decrypt_secret(raw_cookie) or raw_cookie or None
            row, report, result = await run_and_persist(session, row, cookie=cookie)
        except Exception as exc:  # noqa: BLE001
            session.rollback()
            error = "采集或报告保存中断，请检查数据源与数据库状态后重试。"
            logger.warning("crawler attempt interrupted (%s)", type(exc).__name__)
            current = session.get(CrawlerSource, source_id)
            if current and current.status == "running":
                current.status = "failed"
                current.last_error = error
                current.last_item_count = 0
                current.last_run_at = utcnow()
                session.add(current)
                session.commit()
            results.append({**source, "status": "failed", "items": 0, "error": error})
            continue

        entry = {
            **source,
            "status": row.status,
            "items": len(result.items),
            "reportId": report.id if report else None,
            "needsCookie": result.needs_cookie,
        }
        if result.cookie_hint:
            entry["cookieHint"] = result.cookie_hint
        if not result.items:
            entry["error"] = result.error or "榜单没有可用条目，请检查数据源或稍后重试。"
        results.append(entry)

    item_count = sum(entry["items"] for entry in results)
    successful = sum(entry["items"] > 0 for entry in results)
    if item_count:
        status = "done" if successful == len(results) else "partial"
        hint = f"已从 {successful}/{len(results)} 个数据源采集 {item_count} 条公开榜单条目。"
        if status == "partial":
            hint += "其余数据源的状态与处理提示见任务结果。"
    else:
        status = "failed"
        reasons = [
            f"{entry.get('name') or entry['id']}：{entry['error']}"
            + (f"。{entry['cookieHint']}" if entry.get("cookieHint") else "")
            for entry in results
        ]
        hint = selection_error or (
            "未采集到公开榜单条目。" + "；".join(reasons)
            if reasons
            else "没有可采集的公开榜单源，请在 /kb/crawler 启用支持的源并确认 robots。"
        )

    outcome = {"status": status, "sourceId": requested_id, "itemCount": item_count, "results": results, "hint": hint}
    job.result_ref = json.dumps(results if job.type == "crawler.run" else outcome, ensure_ascii=False)
    session.add(job)
    session.commit()
    if not item_count:
        raise RuntimeError(hint)
    publish_job_event(job.id, {"type": "token", "text": f"{hint}\n"})


async def handle_usage_rollup(session: Session, job: Job) -> None:
    """按 UTC 自然日聚合 UsageEvent，结果写入 job.result_ref。"""
    from datetime import datetime, timedelta, timezone

    from app.models import UsageEvent
    from sqlmodel import select

    payload = job.payload or {}
    day = str(payload.get("day") or "")
    if day:
        try:
            day_start = datetime.fromisoformat(day).replace(
                hour=0, minute=0, second=0, microsecond=0, tzinfo=timezone.utc
            )
        except ValueError:
            day_start = datetime.now(timezone.utc).replace(
                hour=0, minute=0, second=0, microsecond=0
            )
    else:
        # 默认汇总「昨天」完整自然日
        today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        day_start = today - timedelta(days=1)
    day_end = day_start + timedelta(days=1)

    rows = list(session.exec(select(UsageEvent)))
    in_day = [
        r
        for r in rows
        if r.created_at
        and day_start
        <= (
            r.created_at.replace(tzinfo=timezone.utc)
            if r.created_at.tzinfo is None
            else r.created_at.astimezone(timezone.utc)
        )
        < day_end
    ]

    by_user: dict[str, dict[str, float | int | str]] = {}
    for r in in_day:
        uid = r.user_id or "unknown"
        bucket = by_user.setdefault(
            uid,
            {
                "userId": uid,
                "events": 0,
                "promptTokens": 0,
                "completionTokens": 0,
                "costEst": 0.0,
            },
        )
        bucket["events"] = int(bucket["events"]) + 1
        bucket["promptTokens"] = int(bucket["promptTokens"]) + int(r.prompt_tokens or 0)
        bucket["completionTokens"] = int(bucket["completionTokens"]) + int(
            r.completion_tokens or 0
        )
        bucket["costEst"] = float(bucket["costEst"]) + float(r.cost_est or 0)

    summary = {
        "day": day_start.date().isoformat(),
        "userCount": len(by_user),
        "eventCount": len(in_day),
        "promptTokens": sum(int(v["promptTokens"]) for v in by_user.values()),
        "completionTokens": sum(int(v["completionTokens"]) for v in by_user.values()),
        "costEst": round(sum(float(v["costEst"]) for v in by_user.values()), 6),
        "byUser": list(by_user.values()),
    }
    job.result_ref = json.dumps(summary, ensure_ascii=False)
    session.add(job)
    session.commit()
    publish_job_event(
        job.id,
        {
            "type": "token",
            "text": (
                f"用量日汇总 {summary['day']}：用户 {summary['userCount']} · "
                f"事件 {summary['eventCount']} · "
                f"tokens {summary['promptTokens']}+{summary['completionTokens']}\n"
            ),
        },
    )


async def handle_prioritize_proposals(session: Session, job: Job) -> None:
    """LLM 重排待处理提案优先级（确定性候选已由 gap_scan 生成，这里只调 priority）。"""
    project_id = job.project_id or (job.payload or {}).get("projectId")
    stmt = select(TaskProposal).where(TaskProposal.status == "pending")
    if project_id:
        stmt = stmt.where(TaskProposal.project_id == project_id)
    proposals = list(session.exec(stmt).all())
    if not proposals:
        return

    lines = "\n".join(f"- {p.id}: [{p.priority}] {p.message}" for p in proposals)
    prompt = (
        "以下是待处理的写作提案。请按「对用户推进书稿的价值」从高到低重排优先级，"
        "返回 JSON 数组，每项含 id 与 priority（0-5 整数，5 最高）。"
        "写正文/去AI味/质检类靠前，扫榜/提醒类靠后。只输出 JSON，不要解释。\n"
        + lines
    )
    try:
        r = await chat_completion(
            [{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=800,
        )
        content = re.sub(r"^```(?:json)?\s*|\s*```$", "", (r.content or "").strip(), flags=re.M)
        ranks = json.loads(content)
    except Exception:  # noqa: BLE001
        return  # LLM 不可用则保留确定性 priority，不阻断

    if not isinstance(ranks, list):
        return
    by_id = {p.id: p for p in proposals}
    for item in ranks:
        if not isinstance(item, dict):
            continue
        pid = item.get("id")
        pri = item.get("priority")
        if pid in by_id and isinstance(pri, int):
            by_id[pid].priority = max(0, min(5, pri))
            session.add(by_id[pid])
    session.commit()
    publish_job_event(
        job.id,
        {"type": "token", "text": f"已重排 {len(by_id)} 条提案优先级。\n"},
    )


async def handle_analytics_review(session: Session, job: Job) -> None:
    """数据复盘闭环：analytics 变化 → 产出 revise 提案（人工 approve 后跑 analytics.review）。"""
    project_id = (job.payload or {}).get("project_id")
    if not project_id:
        return
    existing = session.exec(
        select(TaskProposal).where(
            TaskProposal.type == "revise",
            TaskProposal.project_id == project_id,
            TaskProposal.status == "pending",
        )
    ).first()
    if existing:
        return
    proposal = TaskProposal(
        type="revise",
        message="数据复盘：连载数据有变化，建议复盘改稿。",
        project_id=project_id,
        actions=[
            {
                "type": "agent.run",
                "agentId": "analytics.review",
                "inputJson": {"project_id": project_id},
            }
        ],
        priority=3,
    )
    session.add(proposal)
    session.commit()
    publish_job_event(job.id, {"type": "token", "text": "已生成数据复盘提案。\n"})


def _store_run_digest(session: Session, row: RunDigest, response, *, event_id: str | None,
                      agent_id: str, project_id: str | None, user_id: str) -> bool:
    try:
        if response is not None:
            record_model_usage(response, session=session, event_id=event_id, run_id=row.run_id,
                               agent_id=agent_id, project_id=project_id, user_id=user_id, commit=False)
        inserted = session.execute(insert(RunDigest).values(**row.model_dump())
                                   .on_conflict_do_nothing(index_elements=["id"]))
        session.commit()
        return inserted.rowcount == 1
    except Exception:
        session.rollback()
        raise


async def handle_run_digest(session: Session, job: Job) -> None:
    """run 结束后的决策摘要（narrator）：拼装产物/记忆变更/门禁/遗留 + LLM 叙述（降级确定性）。"""
    run_id = (job.payload or {}).get("run_id")
    if not run_id:
        return
    run = session.get(AgentRun, run_id)
    if not run:
        return
    # 幂等：同一 run 已有 digest 则不再生成（防重试/重复入队产生重复行 + 重复 LLM 调用）
    if session.exec(select(RunDigest).where(RunDigest.run_id == run_id)).first():
        return

    artifacts = list(
        session.exec(select(Artifact).where(Artifact.created_by_run_id == run_id)).all()
    )
    # 去重：同一 path 一个 run 多次写会产生多条「写前快照」，只保留最新一条
    memory_versions = list(
        session.exec(
            select(MemoryVersion)
            .where(MemoryVersion.source_run_id == run_id)
            .order_by(MemoryVersion.created_at.desc())
        ).all()
    )
    seen_paths: set[str] = set()
    memory_changes: list[dict[str, Any]] = []
    for m in memory_versions:
        if m.path in seen_paths:
            continue
        seen_paths.add(m.path)
        memory_changes.append({"path": m.path, "actor": m.actor})
    gates = run.gate_results or []

    digest = compose_run_digest(
        artifacts=[{"type": a.type, "title": a.title, "id": a.id} for a in artifacts],
        memory_changes=memory_changes,
        gates=gates,
        exit_reason=run.status or "",
    )

    narrative = digest["narrative_hint"]
    prompt = (
        "用 1~3 句中文给写作者一段可扫读的 run 决策摘要：写了什么产物、改了哪些设定/伏笔、"
        "门禁结果、有什么遗留。只输出叙述，不要标题，不要列表。\n"
        + json.dumps(digest, ensure_ascii=False)
    )
    job_id, agent_id, project_id, owner = job.id, run.agent_id, run.project_id, job.user_id
    response = None
    event_id = None
    outcome = "fallback"
    try:
        response = await chat_completion(
            [{"role": "user", "content": prompt}], temperature=0.2, max_tokens=300,
        )
    except Exception as exc:
        logger.warning("Digest provider consumption unknown job=%s run=%s error=%s code=%s trace=%s",
                       job_id, run_id, type(exc).__name__, getattr(exc, "provider_code", None),
                       getattr(exc, "trace_id", None))
    if response is not None:
        event_id = f"{DIGEST_EVENT_PREFIX}{job_id}:{new_id()}"
        usage_keys = sorted((response.raw.get("usage") or {}).keys())
        if not {"prompt_tokens", "completion_tokens"}.issubset(usage_keys):
            logger.warning("Incomplete provider usage event=%s raw_usage_fields=%s", event_id, usage_keys)
        logger.info("Digest response event=%s run=%s project=%s owner=%s agent=%s usage=%s raw_usage_fields=%s",
                    event_id, run_id, project_id, owner, agent_id, actual_usage(response), usage_keys)
        choices = response.raw.get("choices") or []
        reason = choices[0].get("finish_reason") if choices else None
        if reason in (None, "stop") and not response.tool_calls:
            try:
                validate_agent_output(response)
            except IncompleteAgentOutput:
                pass
            else:
                narrative = response.content.strip()
                outcome = "narrative"

    row = RunDigest(
        id=f"run.digest:{run_id}", run_id=run_id, narrative=narrative,
        artifacts=digest["artifacts"], memory_changes=digest["memory_changes"],
        gates=digest["gates"], leftover=digest["leftover"],
    )
    try:
        inserted = _store_run_digest(session, row, response, event_id=event_id, agent_id=agent_id,
                                     project_id=project_id, user_id=owner)
    except Exception as exc:
        # SQL exception text may contain private narrative/JSON bound parameters.
        raise RuntimeError(f"Digest persistence failed ({type(exc).__name__}); reconcile "
                           f"job={job_id} run={run_id} event={event_id} before retry") from None
    logger.info("Digest committed job=%s run=%s event=%s inserted=%s outcome=%s",
                job_id, run_id, event_id, inserted, outcome)
    publish_job_event(job.id, {"type": "token", "text": "已生成 run 决策摘要。\n"})


async def handle_eval_run(session: Session, job: Job) -> None:
    """离线评测套件运行。"""
    from app.eval.runner import run_suite
    from app.models import EvalRun

    payload = job.payload or {}
    suite_id = payload.get("suiteId") or payload.get("suite_id")
    eval_run_id = payload.get("evalRunId") or payload.get("eval_run_id")
    if not suite_id and eval_run_id:
        er = session.get(EvalRun, eval_run_id)
        suite_id = er.suite_id if er else None
    if not suite_id:
        raise ValueError("suiteId required for eval.run")
    publish_job_event(job.id, {"type": "token", "text": f"开始评测套件 {suite_id}\n"})
    run = await run_suite(
        session,
        suite_id,
        eval_run_id=eval_run_id,
        variant=payload.get("variant") or {},
        trials_k=payload.get("trialsK"),
        include_llm=bool(payload.get("includeLlm", True)),
        baseline_run_id=payload.get("baselineRunId"),
    )
    job.result_ref = run.id
    publish_job_event(
        job.id,
        {
            "type": "token",
            "text": f"评测完成 gate={run.gate_verdict} passRate={((run.metrics_json or {}).get('passRate'))}\n",
        },
    )


async def handle_eval_score_artifact(session: Session, job: Job) -> None:
    """单篇产物评分（线上抽检）。"""
    from app.eval.online import on_low_score
    from app.eval.score import score_artifact

    payload = job.payload or {}
    artifact_id = payload.get("artifactId") or payload.get("artifact_id")
    if not artifact_id:
        raise ValueError("artifactId required")
    result = await score_artifact(
        session,
        artifact_id,
        rubric_keys=payload.get("rubricKeys"),
        include_llm=bool(payload.get("includeLlm", True)),
        create_run=True,
    )
    job.result_ref = result.get("evalRunId")
    if result["detail"]["assessment"] == "blocked":
        art = session.get(Artifact, artifact_id)
        on_low_score(
            session,
            artifact_id=artifact_id,
            project_id=art.project_id if art else job.project_id,
            score=float(result.get("score") or 0),
            detail={"evalRunId": result.get("evalRunId")},
        )
    publish_job_event(
        job.id,
        {
            "type": "token",
            "text": f"单篇评测 score={result.get('score')} passed={result.get('passed')}\n",
        },
    )


async def handle_eval_patrol(session: Session, job: Job) -> None:
    """巡检：跑所有 enabled 的 patrol 套件。"""
    from app.eval.runner import run_suite
    from app.models import EvalSuite

    suites = list(
        session.exec(
            select(EvalSuite).where(
                EvalSuite.tier == "patrol",
                EvalSuite.enabled == True,  # noqa: E712
            )
        ).all()
    )
    if not suites:
        publish_job_event(job.id, {"type": "token", "text": "无巡检套件，跳过。\n"})
        return
    refs = []
    for suite in suites:
        publish_job_event(job.id, {"type": "token", "text": f"巡检 {suite.name}\n"})
        run = await run_suite(session, suite.id, include_llm=bool((job.payload or {}).get("includeLlm", True)))
        refs.append(run.id)
    job.result_ref = ",".join(refs)
