"""Thread 订阅与直通：已订阅走 Fast Path，未订阅走总编 Slow Path。"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Literal

from sqlalchemy import update
from sqlmodel import Session, select

from .agent_colleagues import FORMAT_LABEL
from .agent_inbox import steer_mailbox, submit_event
from .run_steps import next_step_seq
from .models import AgentEvent, AgentRun, Conversation, Message, Project, RunStep, ThreadSubscription, new_id, utcnow

RouteAction = Literal["steer", "observe_only", "wake_chief", "continue_run", "drop"]

# Always-on / PA 元操作：即使有活跃 Worker 订阅，也必须回总编执行（OpenClaw personal-agent 语义）
# 不含「继续/加一点」这类应直通 Worker 的润色指令。
_META_CONTROL_RE = re.compile(
    r"(?:"
    r"schedule_task|create_fleet|create_project|get_project|"
    r"agent_ps|agent_pause|agent_resume|agent_inspect|stop_agent|steer_agent|"
    r"start_async_task|cancel_async_task|approve_proposal|crawl_hotspots|"
    r"定时任务|新建项目|创建\s*(?:fleet|舰队)|停止\s*(?:agent|运行|实例)|"
    r"暂停\s*(?:agent|运行|实例)|恢复\s*(?:agent|运行|实例)|巡检"
    r")",
    re.IGNORECASE,
)

_PROJECT_FORMATS = {label: key for key, label in FORMAT_LABEL.items() if key != "*"}
_PROJECT_TYPE = "(?:" + "|".join(map(re.escape, _PROJECT_FORMATS)) + ")?"
_PROJECT_NOUN = rf"(?P<format>{_PROJECT_TYPE})\s*项目"
_PROJECT_ASK = r"(?:(?:请问|请|麻烦)[，,]?\s*)?(?:帮我\s*)?"
_PROJECT_WHEN = r"(?:(?:现在|当前|目前)\s*)?"
_PROJECT_OWNER = r"(?:我(?:们)?(?:的)?\s*)?"
_PROJECT_SCOPE = rf"(?:{_PROJECT_WHEN}{_PROJECT_OWNER}|{_PROJECT_OWNER}{_PROJECT_WHEN})"
_PROJECT_AMOUNT = r"(?:多少|几)\s*(?:个|项)?\s*"
_PROJECT_COUNT = (
    re.compile(rf"{_PROJECT_ASK}{_PROJECT_SCOPE}(?:一共|总共)?\s*(?:还有|有)?\s*{_PROJECT_AMOUNT}{_PROJECT_NOUN}(?:[呢呀啊])?"),
    re.compile(rf"{_PROJECT_ASK}(?:查询|统计|查一下)?\s*{_PROJECT_SCOPE}{_PROJECT_NOUN}"
               rf"\s*(?:(?:总数|数量)(?:是多少|有多少)?|(?:一共|总共)?\s*有\s*{_PROJECT_AMOUNT})(?:[呢呀啊])?"),
)
_PROJECT_LIST = (
    re.compile(rf"{_PROJECT_ASK}{_PROJECT_SCOPE}(?:有)?哪些\s*{_PROJECT_NOUN}(?:[呢呀啊])?"),
    re.compile(rf"{_PROJECT_ASK}(?:列出|列一下|列下|查看|显示|看看|看一下)\s*"
               rf"{_PROJECT_SCOPE}(?:所有|全部)?\s*{_PROJECT_NOUN}(?:列表|清单)?"),
    re.compile(rf"{_PROJECT_ASK}{_PROJECT_SCOPE}{_PROJECT_NOUN}(?:列表|清单)"),
)


def project_list_query(message: str) -> dict[str, Any] | None:
    """Recognize a standalone project query on the original user message."""
    text = message.strip().rstrip("?？。!！").strip()
    if "\n" in text or "\r" in text:
        return None
    for count_only, patterns in ((True, _PROJECT_COUNT), (False, _PROJECT_LIST)):
        for pattern in patterns:
            match = pattern.fullmatch(text)
            if match:
                project_format = _PROJECT_FORMATS.get(match["format"])
                return {"count_only": count_only, **({"format": project_format} if project_format else {})}
    if re.fullmatch(r"(?:how many (?:projects (?:are there|do (?:i|we) have)|projects)|(?:my )?project count)", text, re.I):
        return {"count_only": True}
    if re.fullmatch(r"(?:/?list_projects|(?:please )?(?:list|show(?: me)?) (?:my |all )?projects|project list)", text, re.I):
        return {"count_only": False}
    return None


def is_meta_control_message(message: str) -> bool:
    return bool(_META_CONTROL_RE.search(message or ""))


def project_thread_key(project_id: str) -> str:
    return f"project:{project_id}"


def artifact_thread_key(artifact_id: str) -> str:
    return f"artifact:{artifact_id}"


def feishu_thread_key(thread_id: str) -> str:
    return f"feishu:{thread_id}"


def upsert_subscription(
    session: Session,
    *,
    thread_key: str,
    conversation_id: str,
    run_id: str | None = None,
    agent_id: str | None = None,
    project_id: str | None = None,
    mode: str = "wake",
    commit: bool = True,
) -> ThreadSubscription:
    row = session.exec(
        select(ThreadSubscription).where(
            ThreadSubscription.thread_key == thread_key,
            ThreadSubscription.conversation_id == conversation_id,
            ThreadSubscription.status == "active",
            ThreadSubscription.run_id == run_id,
        )
    ).first()
    if row:
        row.agent_id = agent_id or row.agent_id
        row.project_id = project_id or row.project_id
        row.mode = mode or row.mode
        row.updated_at = utcnow()
    else:
        row = ThreadSubscription(
            id=new_id(),
            thread_key=thread_key,
            conversation_id=conversation_id,
            run_id=run_id,
            agent_id=agent_id,
            project_id=project_id,
            status="active",
            mode=mode,
        )
    session.add(row)
    if commit:
        session.commit()
        session.refresh(row)
    return row


def release_subscription(session: Session, sub_id: str) -> ThreadSubscription | None:
    row = session.get(ThreadSubscription, sub_id)
    if not row:
        return None
    row.status = "released"
    row.updated_at = utcnow()
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def set_subscription_mode(session: Session, sub_id: str, mode: str) -> ThreadSubscription | None:
    row = session.get(ThreadSubscription, sub_id)
    if not row:
        return None
    if mode not in {"wake", "observe"}:
        return row
    row.mode = mode
    row.updated_at = utcnow()
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def list_active(
    session: Session,
    *,
    conversation_id: str | None = None,
    project_id: str | None = None,
    thread_key: str | None = None,
) -> list[ThreadSubscription]:
    stmt = select(ThreadSubscription).where(ThreadSubscription.status == "active")
    if conversation_id:
        stmt = stmt.where(ThreadSubscription.conversation_id == conversation_id)
    if project_id:
        stmt = stmt.where(ThreadSubscription.project_id == project_id)
    if thread_key:
        stmt = stmt.where(ThreadSubscription.thread_key == thread_key)
    return list(session.exec(stmt.order_by(ThreadSubscription.created_at.desc())))


def _run_active(session: Session, run_id: str | None) -> AgentRun | None:
    if not run_id:
        return None
    run = session.get(AgentRun, run_id)
    if not run:
        return None
    if run.status in {"queued", "running"}:
        return run
    return None


def find_matching_subs(
    session: Session,
    *,
    conversation_id: str,
    project_id: str | None = None,
    thread_key: str | None = None,
) -> list[ThreadSubscription]:
    keys: list[str] = []
    if thread_key:
        keys.append(thread_key)
    if project_id:
        keys.append(project_thread_key(project_id))
    if not keys:
        return list_active(session, conversation_id=conversation_id)
    out: list[ThreadSubscription] = []
    seen: set[str] = set()
    for key in keys:
        for sub in list_active(session, conversation_id=conversation_id, thread_key=key):
            if sub.id in seen:
                continue
            seen.add(sub.id)
            out.append(sub)
    return out


def route_user_message(
    session: Session,
    *,
    conversation_id: str,
    message: str,
    project_id: str | None = None,
    thread_key: str | None = None,
    force_continue: bool = False,
    mention_agent: str | None = None,
    dedupe_key: str | None = None,
) -> dict[str, Any]:
    """用户消息路由。

    返回 {action, sub?, run_id?, note?}。
    action: steer | continue_run | wake_chief
    """
    subs = find_matching_subs(
        session,
        conversation_id=conversation_id,
        project_id=project_id,
        thread_key=thread_key,
    )
    # 元操作（建项/调度/舰队/实例生命周期）不得被活跃 Worker 订阅劫持
    if not mention_agent and not force_continue:
        if is_meta_control_message(message):
            return {"action": "wake_chief", "note": "元操作交总编（不直通 Worker）", "meta": True}
        if subs and project_list_query(message) is not None:
            from .bot_registry import CHIEF_BOT_ID

            conv = session.get(Conversation, conversation_id)
            if conv and conv.kind == "dm" and conv.bot_id in (None, CHIEF_BOT_ID):
                return {"action": "wake_chief", "note": "项目查询交总编（不直通 Worker）"}
    # 优先匹配仍在跑的 run
    for sub in subs:
        run = _run_active(session, sub.run_id)
        if run and run.id:
            submit_event(
                session,
                conversation_id=steer_mailbox(run.id),
                source="steer",
                dedupe_key=dedupe_key,
                commit=False,
                payload={
                    "message": message,
                    "from_conversation": conversation_id,
                    "thread_key": sub.thread_key,
                },
            )
            # 总编侧只观察，不唤醒（写入 observe 事件供工作台可见，status=done 直接落）
            observe = submit_event(
                session,
                conversation_id=conversation_id,
                source="steer_ack",
                dedupe_key=f"steer_ack:{run.id}:{dedupe_key or utcnow().isoformat()}",
                initial_status="done",
                commit=False,
                payload={
                    "note": f"已直通 {sub.agent_id or run.agent_id}（run={run.id}）",
                    "run_id": run.id,
                    "agent_id": sub.agent_id or run.agent_id,
                    "thread_key": sub.thread_key,
                    "project_id": project_id or sub.project_id,
                },
            )
            observe.status = "done"
            observe.processed_at = utcnow()
            session.add(observe)
            session.commit()
            return {
                "action": "steer",
                "sub": sub,
                "run_id": run.id,
                "agent_id": sub.agent_id or run.agent_id,
                "note": "已直通运行中的 Worker",
            }

    # 明确「继续改这一版」：续跑
    if force_continue or mention_agent:
        history = select(ThreadSubscription).where(
            ThreadSubscription.conversation_id == conversation_id,
            ThreadSubscription.status == "completed",
        )
        keys = [key for key in (thread_key, project_thread_key(project_id) if project_id else None) if key]
        if keys:
            history = history.where(ThreadSubscription.thread_key.in_(keys))
        for sub in [*subs, *session.exec(history.order_by(ThreadSubscription.updated_at.desc()))]:
            if not sub.run_id:
                continue
            parent = session.get(AgentRun, sub.run_id)
            if not parent or parent.status not in {"succeeded", "failed", "cancelled", "dead"}:
                continue
            if mention_agent and sub.agent_id and mention_agent not in {sub.agent_id, (sub.agent_id or "").split(".")[-1]}:
                continue
            return {
                "action": "continue_run",
                "sub": sub,
                "run_id": parent.id,
                "agent_id": sub.agent_id or parent.agent_id,
                "project_id": project_id or sub.project_id or parent.project_id,
                "parent_run_id": parent.id,
                "note": "续跑上一版",
            }

    return {"action": "wake_chief", "note": "未命中活跃订阅"}


def route_job_done(
    session: Session,
    *,
    conversation_id: str,
    run: AgentRun,
    status: str,
) -> dict[str, Any]:
    """job_done 路由：失败 / 门禁未过 / mode=wake → 唤醒；成功且 observe → 只写摘要。"""
    subs = list(
        session.exec(
            select(ThreadSubscription).where(
                ThreadSubscription.conversation_id == conversation_id,
                ThreadSubscription.run_id == run.id,
                ThreadSubscription.status == "active",
            )
        )
    )
    mode = subs[0].mode if subs else "wake"
    gates = list(run.gate_results or [])
    gate_failed = any(
        (g.get("ok") is False) or (g.get("passed") is False) for g in gates if isinstance(g, dict)
    )
    should_wake = status != "succeeded" or gate_failed or mode == "wake"
    if should_wake:
        return {"action": "wake_chief", "mode": mode, "gate_failed": gate_failed}
    return {"action": "observe_only", "mode": mode, "gate_failed": gate_failed}

def deliver_completion(
    session: Session, run: AgentRun, status: str, *,
    legacy_sub_id: str | None = None, observed_sub_update: datetime | None = None,
    passive: bool = False, claim_worker_notification: bool = False,
) -> bool:
    """Serialize delivery and subscription closure in the same transaction."""
    if not run.conversation_id or status not in {"succeeded", "failed", "cancelled", "dead"}:
        return False
    guard = update(AgentRun).where(
        AgentRun.id == run.id, AgentRun.status == status, AgentRun.finished_at == run.finished_at,
        AgentRun.conversation_id == run.conversation_id, AgentRun.lease_version == run.lease_version,
    ).values(status=status).execution_options(synchronize_session=False)
    if not session.execute(guard).rowcount:
        return False
    active = select(ThreadSubscription).where(
        ThreadSubscription.run_id == run.id, ThreadSubscription.conversation_id == run.conversation_id,
        ThreadSubscription.status == "active",
    )
    subs = session.exec(active.with_for_update().execution_options(populate_existing=True)).all()
    if legacy_sub_id and not any(
        sub.id == legacy_sub_id and (observed_sub_update is None or sub.updated_at == observed_sub_update)
        for sub in subs
    ):
        return False
    key = f"job_done:{run.id}:{status}"
    receipt = f"{key}:lease:{run.lease_version}"
    existing = session.get(RunStep, receipt)
    if existing is not None and not subs and not claim_worker_notification:
        return False
    if claim_worker_notification:
        claim_id = f"{receipt}:worker-notification"
        claimed = session.get(RunStep, claim_id) is None
        if claimed:
            session.add(RunStep(
                id=claim_id, conversation_id=run.conversation_id, run_id=run.id, seq=next_step_seq(session, run.conversation_id),
                actor="system", kind="notification_claim", payload={"completionReceipt": receipt},
            ))
    if existing is not None:
        if subs:
            session.add(RunStep(
                conversation_id=run.conversation_id, run_id=run.id, seq=next_step_seq(session, run.conversation_id),
                actor="system", kind="subscription_closed",
                payload={"completionReceipt": receipt, "closedSubscriptionIds": [sub.id for sub in subs]},
            ))
            for sub in subs:
                sub.status = "completed"
                sub.updated_at = utcnow()
                session.add(sub)
        return claimed if claim_worker_notification else False
    route = route_job_done(session, conversation_id=run.conversation_id, run=run, status=status)
    project = session.get(Project, run.project_id) if run.project_id else None
    payload = dict(run_id=run.id, agent_id=run.agent_id, status=status,
                   artifact_count=len(run.output_artifact_ids or []), artifact_ids=run.output_artifact_ids,
                   project_id=run.project_id, project_title=project.title if project else None)
    summary = f"{run.agent_id}（产物 {payload['artifact_count']} 个）"
    previous_generation = session.exec(select(RunStep.id).where(
        RunStep.run_id == run.id, RunStep.kind == "agent_status",
        RunStep.id != receipt, RunStep.id.startswith(f"{key}:lease:")
    ).limit(1)).first()
    if previous_generation:
        key = receipt
    prior = session.exec(select(AgentEvent.id).where(
        AgentEvent.conversation_id == run.conversation_id, AgentEvent.dedupe_key == key).limit(1)).first()
    prior_observation = session.exec(select(Message.id).where(
        Message.conversation_id == run.conversation_id,
        Message.actions[0]["payloads"][0]["run_id"].as_string() == run.id,
        Message.actions[0]["payloads"][0]["status"].as_string() == status,
        Message.actions[0]["sources"][0].as_string() == "job_done").limit(1)).first()
    session.add(RunStep(
        id=receipt, conversation_id=run.conversation_id, run_id=run.id,
        seq=next_step_seq(session, run.conversation_id), actor=f"agent:{run.agent_id}", kind="agent_status",
        payload={
            "status": status, "summary": summary,
            "passiveRepair": passive,
            "missingCompletion": bool(passive and not prior and not prior_observation),
            "intendedRoute": route["action"],
            "closedSubscriptionIds": [sub.id for sub in subs],
            "artifactCount": payload["artifact_count"],
            "artifactIds": run.output_artifact_ids, "projectId": run.project_id,
        },
    ))
    if not passive and not prior and (previous_generation or not prior_observation):
        if route["action"] == "wake_chief":
            submit_event(session, conversation_id=run.conversation_id, source="job_done",
                         dedupe_key=key, payload=payload, priority=10, commit=False)
        else:
            session.add(Message(conversation_id=run.conversation_id, role="system",
                                content=f"[子任务完成·观察] {summary} → {status}",
                                actions=[dict(type="inbox_event", eventIds=[], sources=["job_done"], payloads=[payload])]))
    for sub in subs:
        sub.status = "completed"
        sub.updated_at = utcnow()
        session.add(sub)
    return claimed if claim_worker_notification else True
