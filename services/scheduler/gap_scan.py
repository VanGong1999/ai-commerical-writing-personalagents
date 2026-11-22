"""主动同事：按 Stage 图 + artifacts 扫描缺口，生成 TaskProposal（不自动写稿）。"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from sqlalchemy import update
from sqlmodel import Session, select

from app.models import AgentRun, Artifact, Job, Project, TaskProposal

logger = logging.getLogger(__name__)
_OUTSTANDING_RUN_STATUSES = ("pending_deps", "queued", "running", "paused")


def _stage_graphs_path() -> Path:
    here = Path(__file__).resolve()
    candidates = [
        here.parents[2] / "packages/agent-runtime/stage-graphs.json",  # monorepo
        Path("/packages/agent-runtime/stage-graphs.json"),  # compose 挂载
        Path("/app/../packages/agent-runtime/stage-graphs.json"),
    ]
    for c in candidates:
        try:
            if c.is_file():
                return c
        except OSError:
            continue
    return candidates[0]


def _load_graphs() -> dict[str, list[dict[str, Any]]]:
    path = _stage_graphs_path()
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


ARTIFACT_HINTS = {
    # manju（现行 Stage 图）
    "S1_HOOK_BATCH": ("core_hook", "topic.core_hook_batch", "还没有核心梗候选"),
    "S2_HOOK_SELECT": ("core_hook", "topic.core_hook_critic", "核心梗尚未采纳"),
    "S3_BIO": ("character", "char.bio_manju", "缺人物小传"),
    "S3_BIO_ACK": ("character", "char.bio_manju", "人物小传待确认"),
    "S4_EP10_OUTLINE": ("episode_outline", "struct.episode_outline", "缺前十集大纲"),
    "S4_OUTLINE_ACK": ("episode_outline", "struct.episode_outline", "前十集大纲待确认"),
    "S5_EP_BODY_BATCH": ("manuscript", "prose.episode_body", "缺分集正文"),
    "S7_DE_AI": ("manuscript", "qc.de_ai", "建议跑去 AI 味"),
    "S8_QC": ("qc_report", "qc.human_checklist", "待人工质检确认"),
    # 旧别名（迁移期仍可能出现在 project.stage）
    "S3_EP10_OUTLINE": ("episode_outline", "struct.episode_outline", "缺前十集大纲"),
    "S4_BIO": ("character", "char.bio_manju", "缺人物小传"),
    # duanju
    "S1_TOPIC": ("core_hook", "topic.want_how", "缺选题三问/故事壳"),
    "S2_BIO": ("character", "char.mini_bio", "缺短剧人设"),
    "S3_BEAT20": ("beat_sheet", "struct.beat20", "缺二十节拍"),
    "S4_EP10_DRAFT": ("episode_outline", "struct.ep_outline_duanju", "缺十集大纲"),
    "S4_EP10": ("episode_outline", "struct.ep_outline_duanju", "十集大纲待确认"),
    "S5_SCENE": ("manuscript", "scene.opening7", "缺场级正文/开场"),
    "S6_REVISE20": ("qc_report", "qc.revise20", "建议跑修改20"),
    "S7_SUBMIT": ("qc_report", "qc.redline", "待红线与交付"),
    # short / ip / long
    "S2_SWAP": ("swap_plan", "swap.master", "缺换元方案"),
    "S1_IP_EVAL": ("analysis_report", "ip.select_score", "缺 IP 选书评分"),
    "S4_VOLUME": ("volume_outline", "male.upgrade_loop", "缺卷纲/升级循环"),
    "S3_VOLUME": ("volume_outline", "female.pace", "缺女频卷纲节奏"),
    "S9_RISK": ("qc_report", "male.risk", "待男频雷区体检"),
    "S8_TABOO": ("qc_report", "female.risk", "待女频雷区体检"),
}


def _risk_priority(agent_id: str) -> int:
    """确定性风险分级：写正文=高优先级（需确认），规划/人设=中，扫榜/提醒=低。"""
    if not agent_id:
        return 0
    if agent_id.startswith(("prose.", "qc.de_ai", "qc.bible_guard", "orch.batch")):
        return 2
    if agent_id.startswith(("struct.", "char.", "topic.", "swap.", "scene.", "male.", "female.", "ip.")):
        return 1
    return 0


def scan_project_gaps(session: Session, project: Project) -> list[TaskProposal]:
    graphs = _load_graphs()
    stages = graphs.get(project.format) or []
    by_id = {s["id"]: s for s in stages}
    current = project.stage or (stages[0]["id"] if stages else "")
    arts = list(session.exec(select(Artifact).where(Artifact.project_id == project.id)))
    types = {a.type for a in arts}
    adopted_hooks = any(a.type == "core_hook" and a.status in {"adopted", "draft"} for a in arts)

    proposals: list[TaskProposal] = []
    node = by_id.get(current)
    hint = ARTIFACT_HINTS.get(current)
    if hint:
        need_type, agent_id, msg = hint
        missing = need_type not in types
        if current == "S2_HOOK_SELECT" and not adopted_hooks:
            missing = True
        if missing:
            proposals.append(
                TaskProposal(
                    type="colleague.proactive",
                    message=f"《{project.title}》当前 {current}：{msg}。建议调用 {agent_id}。",
                    project_id=project.id,
                    actions=[
                        {
                            "actionId": f"run-{agent_id}",
                            "type": "agent.run",
                            "agentId": agent_id,
                            "label": f"运行 {agent_id}",
                            "needsApproval": _risk_priority(agent_id) >= 2,
                        }
                    ],
                    status="pending",
                    priority=_risk_priority(agent_id),
                )
            )

    # 前进建议：若当前节点 Agent 已可跑完，提示下一步
    if node and node.get("next") and not proposals:
        nxt = node["next"][0]
        nxt_agents = (by_id.get(nxt) or {}).get("agentIds") or []
        agent_id = nxt_agents[0] if nxt_agents else "qc.de_ai"
        proposals.append(
            TaskProposal(
                type="colleague.proactive",
                message=f"《{project.title}》可从 {current} 前进到 {nxt}。",
                project_id=project.id,
                actions=[
                    {
                        "actionId": f"advance-{nxt}",
                        "type": "agent.run",
                        "agentId": agent_id,
                        "label": f"准备 {nxt}",
                        "needsApproval": _risk_priority(agent_id) >= 2,
                    }
                ],
                status="pending",
                priority=_risk_priority(agent_id),
            )
        )

    # 截止日与目标字数提醒（复用 AI 同事提案，不自动写稿）
    _append_meta_reminders(session, project, proposals)

    return proposals


def _append_meta_reminders(
    session: Session,
    project: Project,
    proposals: list[TaskProposal],
) -> None:
    cover = project.cover_meta or {}
    deadline = cover.get("deadline")
    if deadline:
        try:
            from datetime import datetime, timezone

            due = datetime.fromisoformat(str(deadline))
            if due.tzinfo is None:
                due = due.replace(tzinfo=timezone.utc)
            if due < datetime.now(timezone.utc):
                proposals.append(
                    TaskProposal(
                        type="colleague.proactive",
                        message=f"《{project.title}》已超过截止日 {str(deadline)[:10]}，建议归档或调整截止时间。",
                        project_id=project.id,
                        status="pending",
                    )
                )
        except ValueError:
            pass

    target = int(cover.get("targetWords") or 0)
    if target > 0:
        manuscripts = list(
            session.exec(
                select(Artifact).where(
                    Artifact.project_id == project.id,
                    Artifact.type == "manuscript",
                )
            ).all()
        )
        words = 0
        for a in manuscripts:
            bj = a.body_json or {}
            words += int(bj.get("wordCount") or 0) or len((a.body_markdown or "").replace("\n", ""))
        if words < target:
            proposals.append(
                TaskProposal(
                    type="colleague.proactive",
                    message=f"《{project.title}》目标 {target} 字，当前已写 {words} 字，还差 {target - words} 字。",
                    project_id=project.id,
                    status="pending",
                )
            )


def _scan_dispatch_input(message: str, action: dict[str, Any], *, automatic: bool) -> dict[str, Any]:
    run_input: dict[str, Any] = {"task": message}
    if automatic:
        run_input["auto"] = True
    run_input.update(action.get("inputJson") or {})
    return run_input


def _dispatch_input_matches(
    dispatched: Any, message: str, action: dict[str, Any], *, automatic: bool,
) -> bool:
    if not isinstance(dispatched, dict):
        return False
    work_input = {key: value for key, value in dispatched.items() if key != "fromProposal"}
    return work_input == _scan_dispatch_input(message, action, automatic=automatic)


def _same_scan_action(action: dict[str, Any], earlier: dict[str, Any]) -> bool:
    provenance = ("type", "actionId", "agentId", "sourceRunId", "sourceReportId")
    return (
        all(action.get(key) == earlier.get(key) for key in provenance)
        and (action.get("inputJson") or {}) == (earlier.get("inputJson") or {})
    )


def _has_outstanding_scan_work(
    session: Session, project: Project, prop: TaskProposal, *, auto_user_id: str,
) -> bool:
    if not prop.actions:
        return False
    action = prop.actions[0]
    proposal_scope = (
        TaskProposal.project_id == project.id,
        TaskProposal.type == prop.type,
        TaskProposal.message == prop.message,
    )
    pending = session.exec(select(TaskProposal).where(
        *proposal_scope, TaskProposal.status == "pending",
    ))
    for previous in pending:
        if any(_same_scan_action(action, earlier) for earlier in previous.actions or []):
            return True

    receipts = session.exec(
        select(Job, TaskProposal).select_from(Job)
        .join(AgentRun, AgentRun.id == Job.result_ref)
        .join(TaskProposal, TaskProposal.id == Job.payload["fromProposal"].as_string())
        .where(
            *proposal_scope,
            TaskProposal.status.in_(("approved", "auto_approved")),
            Job.type == "agent.run",
            Job.project_id == project.id,
            AgentRun.project_id == project.id,
            AgentRun.agent_id == action["agentId"],
            AgentRun.status.in_(_OUTSTANDING_RUN_STATUSES),
        )
    )
    for job, previous in receipts:
        if not any(_same_scan_action(action, earlier) for earlier in previous.actions or []):
            continue
        payload = job.payload
        automatic = previous.status == "auto_approved"
        owner = auto_user_id if automatic else project.user_id
        # A steer can revise the Run input. The Job records this dispatch's original request.
        if (job.user_id == owner and payload.get("runId") == job.result_ref
                and payload.get("agentId") == action["agentId"]
                and _dispatch_input_matches(payload.get("input"), prop.message, action, automatic=automatic)):
            return True
    return False


def _auto_run_low_risk(
    session: Session, proposals: list[TaskProposal], *, auto_user_id: str,
) -> tuple[list[tuple[str, dict[str, Any]]], list[str]]:
    """Prepare low-risk dispatches for publication after commit."""
    from app.llm_service import resolve_default_model

    model = resolve_default_model()
    queued = []
    notices = []
    for prop in proposals:
        if int(prop.priority or 0) >= 2:
            continue
        ran = False
        for action in prop.actions or []:
            if action.get("type") != "agent.run" or not action.get("agentId"):
                continue
            if action.get("needsApproval"):
                continue
            agent_id = str(action["agentId"])
            input_json = {
                "fromProposal": prop.id,
                **_scan_dispatch_input(prop.message, action, automatic=True),
            }
            run = AgentRun(
                project_id=prop.project_id,
                agent_id=agent_id,
                status="queued",
                input_json=input_json,
                model=model,
            )
            job = Job(
                type="agent.run",
                payload={
                    "runId": run.id,
                    "agentId": agent_id,
                    "input": input_json,
                    "fromProposal": prop.id,
                },
                project_id=prop.project_id,
                user_id=auto_user_id,
                status="queued",
                result_ref=run.id,
            )
            session.add(run)
            session.add(job)
            queued.append((job.id, {"type": job.type, "payload": job.payload, "runId": run.id}))
            ran = True
        if ran:
            prop.status = "auto_approved"
            session.add(prop)
            notices.append(f"🤖 已自动执行低风险提案：{prop.message}")
        elif int(prop.priority or 0) == 0 and not (prop.actions or []):
            prop.status = "notified"
            session.add(prop)
            notices.append(f"💡 {prop.message}")
    return queued, notices


def _publish_scan_dispatches(
    session: Session, queued: list[tuple[str, dict[str, Any]]], notices: list[str],
) -> None:
    from app.feishu_notify import announce_text
    from app.queue import enqueue_job, publish_job_event

    for job_id, envelope in queued:
        try:
            enqueue_job(job_id, envelope)
            publish_job_event(job_id, {
                "type": "status", "status": "queued", "jobId": job_id, "runId": envelope["runId"],
            })
        except Exception:  # noqa: BLE001
            logger.exception("Could not publish committed scan job %s", job_id)
    for notice in notices:
        try:
            announce_text(session, notice)
        except Exception:  # noqa: BLE001
            logger.exception("Could not announce a committed scan proposal")


def _speculative_cap_ok(session: Session, *, daily_cap: int) -> bool:
    """今天已启动的 speculative run 是否未超限。"""
    from datetime import timedelta

    from app.models import AgentRun, utcnow

    since = utcnow() - timedelta(hours=24)
    rows = list(session.exec(select(AgentRun).order_by(AgentRun.created_at.desc()).limit(80)))
    count = 0
    for r in rows:
        created = r.created_at
        if created is None:
            continue
        if created.tzinfo is None:
            from datetime import timezone as _tz

            created = created.replace(tzinfo=_tz.utc)
        if created < since:
            continue
        if (r.input_json or {}).get("speculative"):
            count += 1
    return count < max(0, daily_cap)


def _maybe_speculate(session: Session, proposals: list[TaskProposal]) -> int:
    """对高置信、低风险缺口后台预起草；质检通过才把产物挂到提案。"""
    try:
        from app.settings import get_settings

        settings = get_settings()
        if not getattr(settings, "speculative_enabled", False):
            return 0
        daily_cap = int(getattr(settings, "speculative_daily_cap", 2) or 2)
    except Exception:  # noqa: BLE001
        return 0

    if not _speculative_cap_ok(session, daily_cap=daily_cap):
        return 0

    from app.models import AgentRun
    from app.routers.assistant import _trigger_agent
    from app.routers.jobs import _ensure_budget

    started = 0
    for prop in proposals:
        if int(prop.priority or 0) >= 2:
            continue  # 写正文等高风险不投机
        acts = list(prop.actions or [])
        run_act = next((a for a in acts if a.get("type") == "agent.run"), None)
        if not run_act:
            continue
        agent_id = str(run_act.get("agentId") or "")
        # 只对只读起草类：topic / char / struct（非 prose）
        if not agent_id.startswith(("topic.", "char.", "struct.", "swap.")):
            continue
        if not prop.project_id:
            continue
        project = session.get(Project, prop.project_id)
        if not project:
            continue
        try:
            _ensure_budget(session, project.id)
        except Exception:  # noqa: BLE001
            continue
        if not _speculative_cap_ok(session, daily_cap=daily_cap):
            break
        info = _trigger_agent(
            session,
            project,
            agent_id,
            f"投机·{agent_id}",
            f"请根据项目当前阶段起草，产物保持 draft。缺口：{prop.message}",
            speculative=True,
        )
        # 把 speculative run 挂到提案；真正采纳等 run 完成 + 质检
        acts.append(
            {
                "actionId": f"spec-{info.get('run_id')}",
                "type": "speculative.run",
                "agentId": agent_id,
                "runId": info.get("run_id"),
                "speculative": True,
                "label": "后台预起草中",
            }
        )
        prop.actions = acts
        session.add(prop)
        started += 1
    if started:
        session.commit()
    return started


def attach_speculative_artifacts(session: Session) -> int:
    """投机 run 成功后：若有产物则挂到对应提案；失败则标记丢弃。"""
    from app.models import AgentRun

    props = list(session.exec(select(TaskProposal).where(TaskProposal.status == "pending")))
    n = 0
    for prop in props:
        acts = list(prop.actions or [])
        changed = False
        for act in acts:
            if not act.get("speculative") or act.get("type") != "speculative.run":
                continue
            if act.get("artifactId") or act.get("discarded"):
                continue
            run_id = act.get("runId")
            if not run_id:
                continue
            run = session.get(AgentRun, run_id)
            if not run:
                continue
            if run.status in {"queued", "running"}:
                continue
            if run.status == "succeeded" and (run.output_artifact_ids or []):
                # 简单质检：有产物即通过
                aid = run.output_artifact_ids[0]
                act["artifactId"] = aid
                act["label"] = "预起草完成，可采纳"
                act["type"] = "adopt_artifact"
                # 同步一条可批准的 adopt action
                acts.append(
                    {
                        "actionId": f"adopt-{aid}",
                        "type": "adopt_artifact",
                        "artifactId": aid,
                        "agentId": act.get("agentId"),
                        "speculative": True,
                        "label": "采纳预起草产物",
                        "needsApproval": True,
                    }
                )
                changed = True
                n += 1
            else:
                act["discarded"] = True
                act["label"] = "预起草丢弃"
                changed = True
        if changed:
            prop.actions = acts
            session.add(prop)
    if n:
        session.commit()
    return n


def run_colleague_scan(session: Session, *, limit: int = 8) -> int:
    from app.settings import get_settings

    projects = list(session.exec(select(Project).where(Project.status == "active")))[:limit]
    # Serialize all scan entry points on existing project rows, including on SQLite.
    # Preserve scan order after acquiring overlapping locks in a consistent order.
    locked_projects = set()
    for project in sorted(projects, key=lambda row: row.id):
        locked = session.execute(update(Project).where(
            Project.id == project.id, Project.status == "active",
        ).values(stage=Project.stage).execution_options(synchronize_session=False))
        if locked.rowcount == 1:
            session.refresh(project)
            locked_projects.add(project.id)

    auto_user_id = get_settings().demo_user_id
    created: list[TaskProposal] = []
    for p in projects:
        if p.id not in locked_projects:
            continue
        for prop in scan_project_gaps(session, p):
            if _has_outstanding_scan_work(session, p, prop, auto_user_id=auto_user_id):
                continue
            session.add(prop)
            created.append(prop)
    if created:
        queued, notices = _auto_run_low_risk(session, created, auto_user_id=auto_user_id)
        session.commit()
        _publish_scan_dispatches(session, queued, notices)
        _maybe_speculate(session, created)
    try:
        attach_speculative_artifacts(session)
    except Exception:  # noqa: BLE001
        pass
    return len(created)
