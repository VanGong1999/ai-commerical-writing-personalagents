"""一键补全后端编排：POST /autopilot/start。

把前端已算好的补全计划（步骤序列）交给 task_daemon.create_task_group 建成任务组，
由既有 daemon 调度；同项目只允许一个进行中的补全组。
"""

from __future__ import annotations

import threading
import re
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field
from sqlmodel import Session, select

from ..db import get_session
from ..models import AgentRun, AsyncTaskGroup, Artifact, Project
from ..schemas import APIModel
from ..seed import DEMO_USER
from .. import task_daemon as daemon

router = APIRouter(prefix="", tags=["autopilot"])

_TERMINAL_GROUP = frozenset({"completed", "partial_failed", "cancelled"})

# 同项目单活跃补全组的串行化闸：把「检查 + 建组 + 打补全标记」整段互斥。
# 不用 DB 级 BEGIN IMMEDIATE 的原因：create_task_group 内部多次 session.commit()，
# 会把显式事务提前提交、释放写锁，无法跨越「检查 + 建组」整段；本 API 为单进程
# （daemon 经 inbox_pump 在进程内 tick），进程级锁足以串行化并发的 start 请求。
_START_LOCK = threading.Lock()


class AutopilotStepIn(APIModel):
    id: str
    agent_id: str
    label: str = ""
    adopt_type: str | None = None
    adopt_mode: Literal["draft", "strong"] | None = None
    episode_no: int | None = None
    depends_on: list[str] = Field(default_factory=list)


class AutopilotStartIn(APIModel):
    dispatcher_run_id: str | None = None
    mode: Literal["auto", "step"] = "auto"
    steps: list[AutopilotStepIn] = Field(default_factory=list)


def _has_active_autopilot(session: Session, project_id: str) -> bool:
    """同项目并发锁：已有非终态 autopilot 组且其任一 run 落在该项目上。"""
    groups = list(session.exec(select(AsyncTaskGroup)))
    for g in groups:
        if g.status in _TERMINAL_GROUP:
            continue
        if (g.plan_json or {}).get("pipeline") != "autopilot":
            continue
        exists = session.exec(
            select(AgentRun).where(
                AgentRun.task_group_id == g.id,
                AgentRun.project_id == project_id,
            )
        ).first()
        if exists is not None:
            return True
    return False


def _tasks_from_steps(project_id: str, mode: str, steps: list[AutopilotStepIn]) -> list[dict[str, Any]]:
    id_to_index: dict[str, int] = {}
    for i, step in enumerate(steps):
        id_to_index[step.id] = i

    tasks: list[dict[str, Any]] = []
    for step in steps:
        depends_on: list[Any] = []
        for dep in step.depends_on or []:
            if dep in id_to_index:
                depends_on.append(id_to_index[dep])
            elif dep.isdigit() and int(dep) in id_to_index:
                depends_on.append(int(dep))
            elif dep:
                # 非本地 id：按已建 run_id 透传（create_task_group 会原样保留）
                depends_on.append(dep)

        task: dict[str, Any] = {
            "project_id": project_id,
            "agent_id": step.agent_id,
            "instruction": step.label or step.agent_id,
            "label": step.label or step.agent_id,
            "depends_on": depends_on,
        }
        if mode == "step":
            task["checkpoint"] = True

        # adoptType/adoptMode/episodeNo 通过 input_extra 在 run 创建时即合并进 input_json，
        # 确保 create_task_group 末尾的首次 tick 入队前元数据已就位（不再依赖建组后回填）。
        extra: dict[str, Any] = {}
        if step.adopt_type is not None:
            extra["adoptType"] = step.adopt_type
        if step.adopt_mode is not None:
            extra["adoptMode"] = step.adopt_mode
        if step.episode_no is not None:
            extra["episodeNo"] = step.episode_no
        if extra:
            task["input_extra"] = extra
        tasks.append(task)
    return tasks


@router.post("/autopilot/start")
def start_autopilot(
    project_id: str,
    body: AutopilotStartIn,
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    return launch_autopilot(project_id, body, session, conversation_id=None)


def _batch_tasks(session, project_id, run):
    project = session.get(Project, project_id)
    if not run or run.project_id != project_id or run.agent_id != "orch.batch_writer" or not project:
        raise HTTPException(409, "dispatcher run/project mismatch")
    source = run.input_json
    fmt = source.get("format")
    agents = {"manju":"prose.episode_body", "ip_adapt":"prose.episode_body", "duanju":"scene.triple",
              "short_novel":"prose.novel_body", "male_long":"prose.novel_body", "female_long":"prose.novel_body"}
    match = re.fullmatch(r"(?:EP|CH)([0-9]{1,3})\s*[-–—]\s*(?:EP|CH)?([0-9]{1,3})", str(source.get("episode_range", "")), re.I)
    if fmt != project.format or fmt not in agents or not match:
        raise HTTPException(422, "bounded range and current project format required")
    start, end = map(int, match.groups())
    refs = source.get("outline_ref")
    if start < 1 or not 1 <= end-start+1 <= 3 or not isinstance(refs,list) or len(refs) != end-start+1:
        raise HTTPException(422, "one approved outline per slot, maximum three")
    progress = project.progress or {}
    tasks = []
    for i, ref in enumerate(refs):
        n = start+i
        art = session.get(Artifact, ref.get("id")) if isinstance(ref,dict) and ref.get("id") else None
        if (not art or art.project_id != project_id or art.type != daemon._outline_type_for(fmt)
                or ref.get("episodeNo") != n or art.version != ref.get("version")
                or not daemon.outline_version_approved(progress, art.id, art.version)):
            raise HTTPException(409, "outline missing or approval/version stale")
        meta = art.body_json or {}
        slot = meta.get("episodeNo") or meta.get("episode_no") or meta.get("chapterNo") or meta.get("ep_no") or meta.get("episode") or meta.get("chapter_no") or meta.get("epNo")
        if slot is None:
            slot_match = re.search(r"(?:EP|CH|第)\s*0*(\d+)", art.title, re.I)
            slot = slot_match.group(1) if slot_match else None
        if str(slot) != str(n):
            raise HTTPException(409, "outline slot mismatch")
        tasks.append({"project_id":project_id, "agent_id":agents[fmt], "format":fmt,
                      "depends_on":[i-1] if i else [], "instruction":f"仅按已确认大纲 {art.id} 写第 {n} 集/章正文。",
                      "input_extra":{"episodeNo":n,"chapterNo":n,"outline_ref":{"id":art.id,"version":art.version}}})
    tasks.append({"project_id":project_id,"agent_id":"qc.human_qc_duanju" if fmt=="duanju" else "qc.human_checklist",
                  "format":fmt,"depends_on":[len(tasks)-1],"instruction":"检查本组正文，交由用户人工确认。"})
    return tasks


def _batch_receipt(session, group, tasks):
    rows = list(session.exec(select(AgentRun).where(AgentRun.task_group_id == group.id)))
    ordered = []
    for task in tasks:
        deps = ordered[-1:] if ordered else []
        matches = [r for r in rows if r.agent_id == task["agent_id"] and r.depends_on_run_ids == deps
                   and r.input_json.get("episodeNo") == task.get("input_extra",{}).get("episodeNo")]
        if len(matches) != 1:
            raise HTTPException(409, "incomplete durable group; inspect before retry")
        ordered.append(matches[0].id)
    return {"taskGroupId":group.id,"runIds":ordered,"status":"dispatched",
            "episodeNos":[t["input_extra"]["episodeNo"] for t in tasks[:-1]]}


def launch_autopilot(project_id: str, body: AutopilotStartIn, session: Session, conversation_id: str | None):
    if not body.steps and not body.dispatcher_run_id:
        raise HTTPException(400, "steps required")

    # 检查 + 建组 + 标记整段持锁，消除 check-then-create 的 TOCTOU 竞态。
    with _START_LOCK:
        batch = body.dispatcher_run_id
        if batch:
            if body.steps or body.mode != "auto":
                raise HTTPException(422, "dispatcher steps are derived from its authorized input")
            for group in session.exec(select(AsyncTaskGroup)):
                if (group.plan_json or {}).get("dispatcherRunId") == batch:
                    if group.plan_json.get("projectId") != project_id:
                        raise HTTPException(409, "dispatcher group/project mismatch")
                    return _batch_receipt(session, group, group.plan_json["tasks"])
            dispatcher = session.get(AgentRun, batch)
            tasks = _batch_tasks(session, project_id, dispatcher)
            if dispatcher.input_json.get("pipelineExecutionId"):
                conversation_id = dispatcher.conversation_id
        if _has_active_autopilot(session, project_id):
            raise HTTPException(409, "该项目已有进行中的补全")

        approval_mode = "checkpoint_gate" if body.mode == "step" else "auto_pilot"
        if not batch:
            tasks = _tasks_from_steps(project_id, body.mode, body.steps)

        result = daemon.create_task_group(
            session,
            user_id=DEMO_USER,
            conversation_id=conversation_id,
            title="一键补全",
            goal="补全计划",
            kind="multi_agent",  # create_task_group 的 kind 校验只认 multi_*，补全标记写在 plan_json
            approval_mode=approval_mode,
            max_concurrency=1 if batch else 4,
            tasks=tasks,
            # 组级标记在建组时写入（先于 create_task_group 末尾的首次 tick），
            # 使 _is_autopilot_run 在首次入队时即可通过组标记识别补全 run。
            plan_extra={"pipeline": "autopilot", "projectId": project_id, **({"dispatcherRunId":batch} if batch else {})},
        )

    if batch:
        return _batch_receipt(session, session.get(AsyncTaskGroup,result["task_group_id"]), tasks)
    return {"taskGroupId": result["task_group_id"], "runIds": result["run_ids"]}
