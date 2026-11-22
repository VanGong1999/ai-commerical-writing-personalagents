from __future__ import annotations

import json
import re
import uuid
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Literal

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from ..knowledge_colleague import catalog as role_catalog, resolve_agent
from ..db import get_session
from ..llm_service import resolve_default_model
from ..models import AgentRun, Artifact, Job, Project, new_id, utcnow
from ..queue import enqueue_job, get_fleet_state, put_fleet_state, publish_job_event
from ..settings import get_settings

router = APIRouter(prefix="/agents", tags=["agents"])

MAX_FLEET_MEMBERS = 4

# Serialize read-modify-write callbacks, including across API processes using Redis.
_fleet_mutation_lock = threading.RLock()


@contextmanager
def _fleet_state_lock(fleet_id: str):
    from ..queue import _get_redis

    with _fleet_mutation_lock:
        client = _get_redis()
        if client is None:
            yield
            return
        lock = client.lock(f"fleet-lock:{fleet_id}", timeout=120, blocking_timeout=10)
        if not lock.acquire():
            raise HTTPException(503, "fleet update busy; retry callback")
        try:
            yield
        finally:
            lock.release()


ROOT = Path(__file__).resolve().parents[4]
SKILLS_ROOT = ROOT / "packages" / "agent-runtime" / "skills"
STAGE_GRAPHS_PATH = ROOT / "packages" / "agent-runtime" / "stage-graphs.json"
AGENT_CATALOG_PATH = ROOT / "packages" / "agent-runtime" / "agent-catalog.json"

# 回退目录（agent-catalog.json 缺失时）；正常路径读同步产物全量
_FALLBACK_AGENT_CATALOG = [
    {"id": "orch.writing", "name": "写作编排器", "summary": "按格式调度 Stage，不开跑全书。", "skillPath": "orchestrator/writing", "when": "任何格式开项目时", "formats": ["*"]},
    {"id": "topic.core_hook_batch", "name": "核心梗批量", "summary": "一次出多条可筛选核心梗。", "skillPath": "manju/core-hook", "when": "漫剧选题", "formats": ["manju"]},
    {"id": "topic.core_hook_critic", "name": "核心梗评审", "summary": "给候选梗打分排序。", "skillPath": "manju/core-hook-critic", "when": "梗太多难选", "formats": ["manju"]},
    {"id": "struct.episode_outline", "name": "前十集大纲", "summary": "分集内容|爽点|卡点。", "skillPath": "manju/episode-outline", "when": "梗已采纳", "formats": ["manju"]},
    {"id": "char.bio_manju", "name": "人物小传", "summary": "大纲前人设；写入 bible。", "skillPath": "manju/bio", "when": "100字测试后", "formats": ["manju"]},
    {"id": "struct.cool18", "name": "爽虐点批量", "summary": "十八爽点注入选题后。", "skillPath": "structure/cool-18-models", "when": "人设前", "formats": ["manju"]},
    {"id": "prose.episode_body", "name": "分集正文", "summary": "Bible注入+衰减硬停。", "skillPath": "manju/episode-body", "when": "大纲 ack 后", "formats": ["manju"]},
    {"id": "qc.bible_guard", "name": "圣经注入", "summary": "每集开写前强制注入。", "skillPath": "quality/bible-guard", "when": "写正文前", "formats": ["manju", "male_long", "female_long"]},
    {"id": "prose.length_decay_fix", "name": "字数衰减校正", "summary": "偷懒短稿扩回规格。", "skillPath": "manju/length-decay-fix", "when": "衰减硬停后", "formats": ["manju"]},
    {"id": "prose.storyboard", "name": "去小说化", "summary": "画面+台词分镜化。", "skillPath": "manju/storyboard", "when": "校正后", "formats": ["manju"]},
    {"id": "hook.foreshadow_ledger", "name": "伏笔台账", "summary": "埋点到期回收。", "skillPath": "structure/foreshadow-ledger", "when": "正文/扩展", "formats": ["manju"]},
    {"id": "prose.qa_correct", "name": "规格校正", "summary": "字数/场景/台词/悬念。", "skillPath": "manju/qa-correct", "when": "正文后", "formats": ["manju"]},
    {"id": "qc.de_ai", "name": "去 AI 味", "summary": "V3.8 去套话比喻。", "skillPath": "quality/de-ai-v3.8", "when": "初稿后", "formats": ["*"]},
    {"id": "qc.human_checklist", "name": "人工校稿清单", "summary": "逻辑门禁不可自动绿。", "skillPath": "gates/logic-ack", "when": "交稿前", "formats": ["*"]},
    {"id": "struct.extend_outline", "name": "扩展大纲", "summary": "EP11+ 滚动扩展。", "skillPath": "manju/extend-outline", "when": "前十集通过后", "formats": ["manju"]},
    {"id": "deliver.pitch_pack", "name": "投稿打包", "summary": "四件套缺一不可。", "skillPath": "manju/pitch-pack", "when": "准备投稿", "formats": ["manju"]},
    {"id": "mem.chapter_summary", "name": "章集摘要", "summary": "写完写入 journal 供续写。", "skillPath": "memory/chapter-summary", "when": "每集/章后", "formats": ["manju", "male_long", "female_long"]},
    {"id": "biz.product_align", "name": "短剧产品锁", "summary": "解压/代入/粘度。", "skillPath": "duanju/product/product-priority", "when": "短剧开题", "formats": ["duanju"]},
    {"id": "topic.want_how", "name": "想看怎么看", "summary": "选题三公式。", "skillPath": "duanju/topic/want-how-via-what", "when": "短剧选题", "formats": ["duanju"]},
    {"id": "struct.beat20", "name": "二十节拍", "summary": "Beat1–20 骨架。", "skillPath": "duanju/structure/beat-20", "when": "选题确认后", "formats": ["duanju"]},
    {"id": "scene.triple", "name": "场三件事", "summary": "目标冲突转机。", "skillPath": "duanju/scene/scene-triple", "when": "写场", "formats": ["duanju"]},
    {"id": "qc.revise20", "name": "修改20", "summary": "短剧改稿清单。", "skillPath": "duanju/revise/revise-20", "when": "场稿后", "formats": ["duanju"]},
    {"id": "swap.master", "name": "换元规划", "summary": "一度/二度映射。", "skillPath": "swap/master", "when": "拆书后", "formats": ["short_novel", "manju", "ip_adapt"]},
    {"id": "inspiration.expand", "name": "灵感升级", "summary": "四层级扩展。", "skillPath": "inspiration/expand", "when": "灵感页", "formats": ["*"]},
    {"id": "kb.report_pipeline", "name": "拆书报告", "summary": "九类报告流水线。", "skillPath": "kb/report-pipeline", "when": "知识库", "formats": ["*"]},
    {"id": "ip.select_score", "name": "IP选书", "summary": "四指标评分。", "skillPath": "ip/select-score", "when": "IP改编", "formats": ["ip_adapt"]},
    {"id": "ip.unit_cut", "name": "IP单元拆解", "summary": "拆单元并做减法。", "skillPath": "ip/unit-cut", "when": "选书后", "formats": ["ip_adapt"]},
    {"id": "ip.emotion_quant", "name": "IP情绪量化", "summary": "单元/集情绪曲线。", "skillPath": "ip/emotion-quant", "when": "单元后", "formats": ["ip_adapt"]},
    {"id": "ip.rebuild", "name": "IP压缩重构", "summary": "主线保留支线合并。", "skillPath": "ip/rebuild-blocks", "when": "情绪后", "formats": ["ip_adapt"]},
    {"id": "female.pace", "name": "女频节奏", "summary": "小爽大爽与留存。", "skillPath": "female_long/pace-ratio", "when": "女频卷纲", "formats": ["female_long"]},
    {"id": "female.tension", "name": "女频张力", "summary": "分合误会揭秘节拍。", "skillPath": "female_long/tension-pull", "when": "人设/细纲", "formats": ["female_long"]},
    {"id": "female.risk", "name": "女频雷区", "summary": "政策平台创作雷区。", "skillPath": "female_long/risk-list", "when": "交稿前", "formats": ["female_long"]},
    {"id": "struct.chase_wife", "name": "追妻五部曲", "summary": "追妻火葬场模板。", "skillPath": "structure/chase-wife-pentalogy", "when": "女频选题", "formats": ["female_long"]},
    {"id": "male.opening", "name": "男频开篇钩", "summary": "冲突/悬念/设定三板斧。", "skillPath": "male_long/opening-hook", "when": "男频选题", "formats": ["male_long"]},
    {"id": "male.gold_finger", "name": "男频金手指", "summary": "限制型金手指驱动主线。", "skillPath": "male_long/gold-finger-cap", "when": "设定阶段", "formats": ["male_long"]},
    {"id": "male.upgrade_loop", "name": "男频升级循环", "summary": "压抑爆发打脸新目标。", "skillPath": "male_long/upgrade-loop", "when": "卷纲", "formats": ["male_long"]},
    {"id": "male.cool_density", "name": "男频爽点密度", "summary": "装逼打脸节奏体检。", "skillPath": "male_long/cool-density", "when": "正文后", "formats": ["male_long"]},
    {"id": "male.risk", "name": "男频雷区", "summary": "无脑碾压/设定堆/水文。", "skillPath": "male_long/risk-list", "when": "交稿前", "formats": ["male_long"]},
    {"id": "prose.short_opening", "name": "短篇开篇", "summary": "冲突悬念前置。", "skillPath": "short_novel/opening-attract", "when": "短篇开写", "formats": ["short_novel"]},
    {"id": "struct.chapter_cap", "name": "章纲控长", "summary": "梗概章纲细纲分步。", "skillPath": "short_novel/chapter-outline-cap", "when": "短篇/长篇章纲", "formats": ["short_novel", "male_long", "female_long"]},
    {"id": "colleague.proactive", "name": "主动同事", "summary": "扫描缺口并提案（需批准）。", "skillPath": "colleague/proactive", "when": "不知道下一步", "formats": ["*"]},
    {"id": "mem.curator", "name": "今日目标", "summary": "整理 3 条可完成小目标。", "skillPath": "memory/curator", "when": "每日开工", "formats": ["*"]},
    {"id": "analytics.review", "name": "数据复盘", "summary": "按收藏/留存给改稿建议。", "skillPath": "analytics/review", "when": "连载数据录入后", "formats": ["*"]},
    {"id": "harness.check_critic", "name": "质检批判", "summary": "攻击质检集提缺失 check。", "skillPath": "harness/check-critic", "when": "质检翻车后", "formats": ["*"]},
]


def _load_agent_catalog() -> list[dict]:
    """优先读 sync 产物 agent-catalog.json；缺失则回退硬编码精简表。"""
    path = AGENT_CATALOG_PATH
    if not path.is_file():
        alt = Path("/packages/agent-runtime/agent-catalog.json")
        path = alt if alt.is_file() else AGENT_CATALOG_PATH
    try:
        if path.is_file():
            data = json.loads(path.read_text(encoding="utf-8"))
            raw = data.get("agents") or []
            out: list[dict] = []
            for a in raw:
                formats = a.get("formats") or a.get("format") or ["*"]
                if isinstance(formats, str):
                    formats = [formats]
                out.append(
                    {
                        "id": a.get("id"),
                        "name": a.get("name") or a.get("id"),
                        "summary": a.get("summary") or a.get("description") or "",
                        "persona": a.get("persona") or "",
                        "team": a.get("team") or "",
                        "skillPath": a.get("skillPath") or "",
                        "when": a.get("when") or "",
                        "formats": formats,
                        "stage": a.get("stage"),
                        "tools": a.get("tools") or [],
                        "modelProfile": a.get("modelProfile"),
                    }
                )
            if out:
                return out
    except Exception:  # noqa: BLE001
        pass
    return list(_FALLBACK_AGENT_CATALOG)


def _load_stage_graphs() -> dict:
    if not STAGE_GRAPHS_PATH.exists():
        return {}
    return json.loads(STAGE_GRAPHS_PATH.read_text(encoding="utf-8"))


def _parse_skill(path: Path) -> dict:
    raw = path.read_text(encoding="utf-8")
    meta: dict = {"name": path.parent.name, "description": "", "gates": [], "locks": []}
    body = raw
    if raw.startswith("---"):
        end = raw.find("\n---", 3)
        if end > 0:
            fm = raw[3:end].strip()
            body = raw[end + 4 :].strip()
            for line in fm.splitlines():
                m = re.match(r"^([A-Za-z0-9_]+):\s*(.*)$", line)
                if not m:
                    continue
                key, val = m.group(1), m.group(2).strip()
                if val.startswith("[") and val.endswith("]"):
                    meta[key] = [
                        x.strip().strip("\"'")
                        for x in val[1:-1].split(",")
                        if x.strip()
                    ]
                else:
                    meta[key] = val
    rel = str(path.parent.relative_to(SKILLS_ROOT)).replace("\\", "/")
    return {
        "id": rel,
        "name": meta.get("name") or path.parent.name,
        "description": meta.get("description") or "",
        "gates": meta.get("gates") or [],
        "locks": meta.get("locks") or [],
        "path": f"skills/{rel}/SKILL.md",
        "body": body,
        "folder": rel.split("/")[0] if "/" in rel else rel,
    }


@router.get("/catalog")
def list_agent_catalog(format: str | None = None, project_id: str | None = None, session: Session = Depends(get_session)) -> dict:
    agents = role_catalog(session, project_id)
    if format:
        agents = [
            a
            for a in agents
            if "*" in (a.get("formats") or []) or format in (a.get("formats") or [])
        ]
    return {
        "agents": agents,
        "count": len(agents),
        "hint": "写作助手工种（与 agent-catalog.json / registry 同步）。创作台按 Stage 调用；完整 Skills 见 /agents/skills。",
    }


def _count_skills() -> int:
    try:
        path = ROOT / "packages" / "agent-runtime" / "skills" / "catalog.json"
        if path.is_file():
            data = json.loads(path.read_text(encoding="utf-8"))
            return int(data.get("count") or len(data.get("skills") or []))
    except Exception:  # noqa: BLE001
        pass
    if SKILLS_ROOT.is_dir():
        return sum(1 for _ in SKILLS_ROOT.rglob("SKILL.md"))
    return 0


def _personal_agent_block() -> dict:
    from .personal_agent import SUPERVISOR_TOOLS_ALL, CHIEF_ID, CHIEF_NAME
    from ..tool_catalog_meta import lookup_tool

    tools = []
    for t in SUPERVISOR_TOOLS_ALL:
        fn = t.get("function") or {}
        name = fn.get("name") or ""
        meta = lookup_tool(name)
        tools.append(
            {
                **meta,
                "id": name,
                "description": fn.get("description") or meta.get("description"),
                "parameters": (fn.get("parameters") or {}).get("properties") or {},
                "required": (fn.get("parameters") or {}).get("required") or [],
            }
        )
    return {
        "id": CHIEF_ID,
        "name": CHIEF_NAME,
        "persona": "总编",
        "role": "Personal Agent / Router / Supervisor",
        "summary": "全双工对话总管：调度领域 Agent、跨书多章守护编排、记忆与审批门控。",
        "capabilities": [
            {"id": "full_duplex", "title": "全双工不阻塞", "desc": "子任务运行中仍可继续对话与插话。"},
            {"id": "async_daemon", "title": "跨书多章守护", "desc": "start_async_task 编排矩阵 + Task Daemon 并发推进。"},
            {"id": "vfs_memory", "title": "VFS 跨会话记忆", "desc": "/memories 持久化人设、决策与已汇报。"},
            {"id": "dual_approval", "title": "双模式审批", "desc": "auto_pilot 自动巡航 / checkpoint_gate 关键节点确认。"},
            {"id": "steer_interrupt", "title": "事中干预", "desc": "enqueue 追加或 interrupt 硬中断重跑。"},
            {"id": "feishu_sync", "title": "飞书同步", "desc": "完成与审批可推送到绑定会话。"},
        ],
        "asyncPrimitives": [
            "start_async_task",
            "check_async_task",
            "update_async_task",
            "cancel_async_task",
            "list_async_tasks",
        ],
        "tools": tools,
        "vfsPaths": ["/memories/user", "/memories/projects/{id}", "/projects", "/kb", "/workspace"],
    }


@router.get("/overview")
def agents_overview(project_id: str | None = None, session: Session = Depends(get_session)) -> dict:
    """智能体全景：Personal Agent + 统计 + Agents + Tools + Workflows + Skills 计数。"""
    from ..tool_catalog_meta import tools_catalog_for, lookup_tool

    agents = role_catalog(session, project_id)
    # 补全 tools 元数据摘要
    for a in agents:
        tool_ids = list(a.get("tools") or [])
        a["toolDetails"] = [lookup_tool(t) for t in tool_ids]
        a["toolCount"] = len(tool_ids)

    by_team: dict[str, int] = {}
    by_format: dict[str, int] = {}
    by_profile: dict[str, int] = {}
    for a in agents:
        team = str(a.get("team") or "其他") or "其他"
        by_team[team] = by_team.get(team, 0) + 1
        profile = str(a.get("modelProfile") or "fast")
        by_profile[profile] = by_profile.get(profile, 0) + 1
        for fmt in a.get("formats") or ["*"]:
            by_format[str(fmt)] = by_format.get(str(fmt), 0) + 1

    graphs = _load_stage_graphs()
    workflows = {
        fmt: {
            "format": fmt,
            "stageCount": len(stages),
            "ackCount": sum(1 for s in stages if s.get("requiresUserAck")),
            "stages": stages,
        }
        for fmt, stages in graphs.items()
    }

    # 收集所有领域工具名
    all_tool_names: list[str] = []
    seen: set[str] = set()
    for a in agents:
        for t in a.get("tools") or []:
            if t not in seen:
                seen.add(t)
                all_tool_names.append(t)

    skills_count = _count_skills()
    personal = _personal_agent_block()

    return {
        "personalAgent": personal,
        "stats": {
            "personalAgents": 1,
            "domainAgents": len(agents),
            "skills": skills_count,
            "tools": len(all_tool_names) + len(personal.get("tools") or []),
            "workflows": len(workflows),
            "byTeam": dict(sorted(by_team.items(), key=lambda x: -x[1])),
            "byFormat": by_format,
            "byModelProfile": by_profile,
        },
        "agents": agents,
        "toolsCatalog": tools_catalog_for(all_tool_names) + [
            lookup_tool(t.get("id")) for t in (personal.get("tools") or [])
        ],
        "workflows": workflows,
        "skillCount": skills_count,
        "hint": "工作台「智能体图鉴」消费本接口；详情弹窗可再拉 /agents/skills/{id}。",
    }


@router.get("/stages/{fmt}")
def get_stage_graph(fmt: str) -> dict:
    graphs = _load_stage_graphs()
    if fmt not in graphs:
        raise HTTPException(404, f"暂无格式「{fmt}」的 Stage 图（已支持：{', '.join(graphs.keys()) or '无'}）")
    stages = graphs[fmt]
    return {
        "format": fmt,
        "stages": stages,
        "hint": "requiresUserAck=true 的节点必须人工确认后才能 stage_lock 前进。",
    }


@router.get("/stages")
def list_stage_formats() -> dict:
    graphs = _load_stage_graphs()
    return {
        "formats": list(graphs.keys()),
        "graphs": {k: len(v) for k, v in graphs.items()},
    }


class StageLockIn(BaseModel):
    format: str
    current_stage_id: str = Field(alias="currentStageId")
    completed: list[str] = Field(default_factory=list)
    action: str = Field(description="inspect | ack | advance | can_jump")
    target_stage_id: str | None = Field(default=None, alias="targetStageId")
    force: bool = False
    reason: str | None = None

    model_config = {"populate_by_name": True}


_MANJU_STAGE_ALIASES = {
    "S4_BIO": "S3_BIO",
    "S4_CHAR_BIO": "S3_BIO",
    "S3_EP10_OUTLINE": "S4_EP10_OUTLINE",
    "S6_AI_CORRECT": "S6_QA",
    "S7_DE_AI": "S9_DE_AI",
    "S8_HUMAN_QC": "S10_HUMAN_QC",
    "S9_EXTEND": "S11_EXTEND",
    "S9_EXTEND_OUTLINE": "S11_EXTEND",
    "S10_PITCH": "S11_PITCH",
    "S10_DONE": "S11_DONE",
}

_DUANJU_STAGE_ALIASES = {
    "S0_SETUP": "S0_PRODUCT",
    "S1_TOPIC_CONFLICT": "S1_TOPIC",
    "S2_CHARACTER": "S2_BIO",
    "S3_UNIT_STRUCTURE": "S3_BEAT20",
    "S4_SCENE_OUTLINE": "S4_EP10_DRAFT",
    "S4_EP10_OUTLINE": "S4_EP10_DRAFT",
    "S5_BODY": "S5_SCENE",
    "S6_HOOK_CHECK": "S6_REVISE20",
    "S7_DE_AI": "S6_REVISE20",
    "S8_HUMAN_QC": "S7_SUBMIT",
    "S9_DONE": "S7_SUBMIT",
}


def _migrate_manju_stage(current_stage_id: str, completed: list[str]) -> tuple[str, list[str], str | None]:
    """旧「大纲→人设」项目：映射到新人设先路径，保留大纲提示补小传 ack。"""
    map_id = lambda x: _MANJU_STAGE_ALIASES.get(x, x)
    current = map_id(current_stage_id)
    done = list(dict.fromkeys(map_id(x) for x in completed))
    hint = None
    bio_acked = "S3_BIO_ACK" in done or "S3_BIO" in done
    outline_present = "S4_EP10_OUTLINE" in done or "S4_OUTLINE_ACK" in done or current in {
        "S4_EP10_OUTLINE",
        "S4_OUTLINE_ACK",
        "S5_EP_BODY_BATCH",
        "S6_QA",
        "S7_STORYBOARD",
        "S8_DIALOGUE",
        "S9_DE_AI",
        "S10_HUMAN_QC",
        "S11_EXTEND",
        "S11_PITCH",
        "S11_DONE",
    }
    if outline_present and not bio_acked:
        current = "S3_BIO_ACK"
        hint = "检测到旧顺序「先大纲后人设」项目：请确认/补全人物小传后再继续；已有大纲保留不删除。"
    return current, done, hint


@router.post("/stage-lock")
def stage_lock_action(body: StageLockIn) -> dict:
    """确定性 Stage 锁：与 TS stageLock 语义对齐（Python 侧轻量实现）。"""
    graphs = _load_stage_graphs()
    stages = graphs.get(body.format) or []
    by_id = {s["id"]: s for s in stages}

    current_id = body.current_stage_id
    completed = list(body.completed)
    migration_hint = None
    if body.format == "manju":
        current_id, completed, migration_hint = _migrate_manju_stage(current_id, completed)
    elif body.format == "duanju":
        map_id = lambda x: _DUANJU_STAGE_ALIASES.get(x, x)
        current_id = map_id(current_id)
        completed = list(dict.fromkeys(map_id(x) for x in completed))

    current = by_id.get(current_id)
    if not current:
        # 尝试别名后再查一次
        alias_map = (
            _MANJU_STAGE_ALIASES
            if body.format == "manju"
            else _DUANJU_STAGE_ALIASES
            if body.format == "duanju"
            else {}
        )
        aliased = alias_map.get(body.current_stage_id, body.current_stage_id)
        current = by_id.get(aliased)
        current_id = aliased if current else current_id
    if not current:
        raise HTTPException(400, f"未知 currentStageId：{body.current_stage_id}")

    if body.action == "inspect":
        return {
            "ok": True,
            "state": {"format": body.format, "currentStageId": current_id, "completed": completed},
            "migrationHint": migration_hint,
        }

    if body.action == "ack":
        if current_id not in completed:
            completed.append(current_id)
        out = {
            "ok": True,
            "state": {
                "format": body.format,
                "currentStageId": current_id,
                "completed": completed,
            },
            "message": f"已确认 {current.get('name')}",
        }
        if migration_hint:
            out["migrationHint"] = migration_hint
        return out

    requires_ack = bool(current.get("requiresUserAck"))
    locked = requires_ack and current_id not in completed

    if body.action == "advance":
        if locked and not body.force:
            out = {
                "ok": False,
                "locked": True,
                "requiresUserAck": True,
                "reason": f"Stage「{current.get('name')}」需人工确认后才能前进",
                "state": {
                    "format": body.format,
                    "currentStageId": current_id,
                    "completed": completed,
                },
            }
            if migration_hint:
                out["migrationHint"] = migration_hint
            return out
        if current_id not in completed:
            completed.append(current_id)
        nxt = current.get("next") or []
        next_id = nxt[0] if nxt else current_id
        out = {
            "ok": True,
            "locked": False,
            "nextStageIds": nxt,
            "state": {
                "format": body.format,
                "currentStageId": next_id,
                "completed": completed,
            },
            "message": f"前进到 {by_id.get(next_id, {}).get('name', next_id)}" if nxt else "已到末端",
            "forced": bool(body.force and locked),
            "reason": body.reason,
        }
        if migration_hint:
            out["migrationHint"] = migration_hint
        return out

    if body.action == "can_jump":
        target = body.target_stage_id
        if not target or target not in by_id:
            raise HTTPException(400, "缺少合法 targetStageId")
        ids = [s["id"] for s in stages]
        if current_id not in ids:
            raise HTTPException(400, f"未知 currentStageId：{current_id}")
        cur_i = ids.index(current_id)
        tgt_i = ids.index(target)
        if tgt_i <= cur_i:
            return {"ok": True, "reason": "允许回看"}
        if body.force:
            return {
                "ok": True,
                "forced": True,
                "reason": body.reason or "force 跳转（将记审计）",
            }
        for i in range(cur_i, tgt_i):
            sid = ids[i]
            if sid not in completed and sid != current_id:
                return {
                    "ok": False,
                    "reason": f"禁止跳过未完成 Stage「{by_id[sid].get('name')}」",
                }
        return {"ok": True, "reason": "可前进"}

    raise HTTPException(400, "action 须为 inspect | ack | advance | can_jump")


@router.get("/skills")
def list_skills() -> dict:
    if not SKILLS_ROOT.exists():
        return {"skills": [], "hint": "尚未找到 Skills 目录"}
    skills = [_parse_skill(p) for p in sorted(SKILLS_ROOT.rglob("SKILL.md"))]
    return {
        "skills": skills,
        "count": len(skills),
        "hint": "Skill 是助手岗位说明书。日常不必手改。",
    }


@router.get("/skills/{skill_id:path}")
def get_skill(skill_id: str) -> dict:
    path = SKILLS_ROOT / skill_id / "SKILL.md"
    if not path.exists():
        alt = SKILLS_ROOT / skill_id.replace("skills/", "") / "SKILL.md"
        path = alt if alt.exists() else path
    if not path.exists():
        raise HTTPException(404, "找不到这份 Skill 说明书")
    return _parse_skill(path)


class DoneCheckBody(BaseModel):
    contract: list[dict] = Field(default_factory=list)
    artifact_counts: dict[str, int] = Field(default_factory=dict, alias="artifactCounts")
    gate_results: list[dict] = Field(default_factory=list, alias="gateResults")
    user_acks: dict[str, bool] = Field(default_factory=dict, alias="userAcks")

    model_config = {"populate_by_name": True}


def _resolve_gate(name: str, gate_results: list[dict]) -> dict | None:
    """与 TS resolveGate 对齐：大小写不敏感 + id/name 双重匹配。"""
    target = str(name)
    tlow = target.lower()
    for g in gate_results or []:
        gid = str(g.get("id") or "")
        gname = str(g.get("name") or "")
        if gid == target or gname == target:
            return g
        if gid.lower() == tlow or gname.lower() == tlow:
            return g
    return None


@router.post("/done-check")
def done_check(body: DoneCheckBody) -> dict:
    """确定性评估 Done Contract（不调用模型）。"""
    checks: list[dict] = []
    for clause in body.contract:
        ctype = clause.get("type")
        if ctype == "artifact_count":
            art = str(clause.get("artifact") or "")
            mn = int(clause.get("min") or 0)
            count = int(body.artifact_counts.get(art) or 0)
            ok = count >= mn
            checks.append(
                {
                    "id": f"done.artifact_count.{art}",
                    "name": f"产物数量≥{mn}",
                    "result": "pass" if ok else "fail",
                    "message": f"{art}×{count}（需要≥{mn}）",
                }
            )
        elif ctype == "gate_pass":
            needed = list(clause.get("gates") or [])
            missing: list[str] = []
            failed: list[str] = []
            for g in needed:
                hit = _resolve_gate(g, body.gate_results)
                if hit is None:
                    missing.append(g)
                elif str(hit.get("result")) == "fail":
                    failed.append(g)
            ok = not missing and not failed
            checks.append(
                {
                    "id": f"done.gate_pass.{'+'.join(needed)}",
                    "name": "门禁全部通过",
                    "result": "pass" if ok else "fail",
                    "message": "ok" if ok else f"缺失={missing};失败={failed}",
                }
            )
        elif ctype == "user_ack":
            key = str(clause.get("checklist") or "")
            ok = bool(body.user_acks.get(key))
            checks.append(
                {
                    "id": f"done.user_ack.{key}",
                    "name": "人工确认",
                    "result": "pass" if ok else "fail",
                    "message": f"checklist「{key}」{'已' if ok else '未'}确认",
                }
            )
    ok_all = not any(c["result"] == "fail" for c in checks)
    return {"ok": ok_all, "checks": checks}


class PolicyBody(BaseModel):
    last_event_type: str | None = Field(default=None, alias="lastEventType")
    side_effect: str = Field(default="none", alias="sideEffect")
    already_applied: bool = Field(default=False, alias="alreadyApplied")
    operator_decision: str | None = Field(default=None, alias="operatorDecision")

    model_config = {"populate_by_name": True}


@router.post("/policy/resume")
def policy_resume(body: PolicyBody) -> dict:
    """控制平面：崩溃/存疑时 resume|refuse|ask_operator|safe_retry。"""
    if body.operator_decision == "refuse":
        return {"action": "refuse", "reason": "操作员拒绝恢复", "recordFact": "operator_refused"}
    if body.operator_decision == "mark_done":
        return {"action": "refuse", "reason": "操作员标记已完成", "recordFact": "operator_mark_done"}
    if body.operator_decision == "resume":
        return {"action": "resume", "reason": "操作员确认可恢复", "recordFact": "operator_resume"}
    if body.last_event_type == "tool_call" and body.side_effect not in ("", "none", None):
        if body.already_applied:
            return {
                "action": "refuse",
                "reason": "副作用可能已生效，禁止盲重试",
                "recordFact": "in_doubt_already_applied",
            }
        return {
            "action": "ask_operator",
            "reason": "it's in doubt：需操作员确认",
            "recordFact": "in_doubt",
        }
    if body.last_event_type == "model_call":
        return {"action": "safe_retry", "reason": "仅模型调用中断，可安全重试"}
    return {"action": "resume", "reason": "无存疑信号，允许恢复"}


class HandoffBody(BaseModel):
    run_id: str = Field(alias="runId")
    agent_id: str = Field(alias="agentId")
    goal: str
    constraints: list[str] = Field(default_factory=list)
    open_items: list[str] = Field(default_factory=list, alias="openItems")

    model_config = {"populate_by_name": True}


def _compile_done_contract(goal: str) -> list[dict]:
    """确定性 check 编译器（Session 4 简版）：从目标文案提取可执行 Done 条款。"""
    clauses: list[dict] = []
    g = goal or ""

    # 「至少 N 个 X」→ artifact_count
    for m in re.finditer(r"至少\s*(\d+)\s*(?:个|篇|章|集)?\s*([\u4e00-\u9fa5A-Za-z_]+)", g):
        art = m.group(2).strip()
        if art and not art.startswith(("通过", "人工", "必须")):
            clauses.append({"type": "artifact_count", "artifact": art, "min": int(m.group(1))})

    # 「必须通过 G1/G2」→ gate_pass
    for m in re.finditer(r"(?:必须)?通过\s*([A-Za-z_]+(?:\s*[,，、/]\s*[A-Za-z_]+)+)", g):
        gates = [x.strip() for x in re.split(r"[,，、/]", m.group(1)) if x.strip()]
        if gates:
            clauses.append({"type": "gate_pass", "gates": gates})

    # 「需人工确认 C」→ user_ack
    for m in re.finditer(r"(?:需|需要|必须)?人工确认\s*([A-Za-z_]+)", g):
        clauses.append({"type": "user_ack", "checklist": m.group(1).strip()})

    return clauses


@router.post("/handoff")
def create_handoff(body: HandoffBody) -> dict:
    """用户发起交接：浓缩目标，交给全新上下文（不带庞大会话）。"""
    constraints = [f"- {c}" for c in body.constraints] or ["- （无）"]
    open_items = [f"- {o}" for o in body.open_items] or ["- （无）"]
    text = "\n".join(
        [
            f"# Handoff Goal — {body.agent_id}",
            f"from_run: {body.run_id}",
            "",
            "## Goal",
            body.goal.strip(),
            "",
            "## Constraints",
            *constraints,
            "",
            "## Open items",
            *open_items,
            "",
            "新会话只带本目标，禁止回放完整旧上下文。",
        ]
    )
    return {
        "ok": True,
        "handoffMarkdown": text,
        "suggestedDoneContract": _compile_done_contract(body.goal),
        "hint": "将 handoffMarkdown 作为新 Run 的唯一 user prompt 启动",
    }


@router.get("/harness/capabilities")
def harness_capabilities() -> dict:
    """生产级 harness 能力清单（对照方法论验收）。"""
    return {
        "loop": {"maxTurns": True, "toolErrorFeedback": True, "doneContractKickback": True},
        "security": {"modes": ["readonly", "safe", "yolo"], "denyBash": True, "pathSandbox": True},
        "context": {"compaction": True, "microCompactTools": True, "ncNeverCompress": True},
        "memory": {"layeredMarkdown": True, "curator": True, "dreams": "skill:memory/dreams"},
        "skills": {"progressiveDisclosure": True, "skill_list": True, "skill_read": True},
        "session": {"jsonlEvents": True, "crashBoundary": True},
        "subagents": {
            "roles": ["scout", "planner", "worker", "reviewer"],
            "depthLimit": 2,
            "nestedLoop": True,
        },
        "policy": {"idempotency": True, "inDoubtAskOperator": True},
        "receipt": {"attestation": True, "narrative": True, "handoff": True},
        "orchestration": {
            "stageGraphs": True,
            "fleet": {
                "maxMembers": MAX_FLEET_MEMBERS,
                "modes": ["ordered", "union", "synthesis"],
                "workdir": "logical_namespace",
            },
        },
        "observability": {"otel": True, "jsonlSession": True, "jobEvents": True},
    }


class FleetMemberIn(BaseModel):
    name: str
    task: str
    workdir: str | None = None
    agentId: str | None = None
    securityMode: Literal["readonly", "safe", "yolo"] | None = "safe"


class FleetCreateIn(BaseModel):
    projectId: str = Field(alias="project_id")
    mode: Literal["synthesis", "union", "ordered"] = "ordered"
    mergePolicy: Literal["semantic_repair", "refuse", "human"] = Field(
        default="human", alias="merge_policy"
    )
    members: list[FleetMemberIn]
    synthesisAgentId: str = Field(default="orch.writing", alias="synthesis_agent_id")

    model_config = {"populate_by_name": True}


class FleetMemberPatchIn(BaseModel):
    name: str | None = None
    index: int | None = None
    status: Literal["pending", "running", "done", "failed"]
    summary: str | None = None
    runId: str | None = Field(default=None, alias="run_id")
    jobId: str | None = Field(default=None, alias="job_id")

    model_config = {"populate_by_name": True}


def _fleet_workdir(project_id: str, fleet_id: str, member_name: str) -> str:
    # 保留中文姓名，避免不同同事都被替换为 ____ 而共享写入空间。
    safe = re.sub(r"[^\w-]", "_", member_name or "member")[:48]
    import hashlib
    safe += "-" + hashlib.sha256((member_name or "member").encode()).hexdigest()[:10]
    return f"/memories/projects/{project_id}/fleet/{fleet_id}/{safe}"


def _merge_fleet_markdown(mode: str, reports: list[dict[str, Any]]) -> dict[str, Any]:
    sorted_rows = sorted(reports, key=lambda r: int(r.get("index") or 0))
    lines = [
        f"### [{r.get('index', i)}] {r.get('name')} ({r.get('status')})\n{r.get('summary') or '（无摘要）'}"
        for i, r in enumerate(sorted_rows)
    ]
    summaries = [str(r.get("summary") or f"{r.get('name')}:{r.get('status')}") for r in sorted_rows]
    if mode == "union":
        md = "## Fleet Union\n\n" + "\n".join(f"- {s}" for s in summaries)
        return {"markdown": md, "synthesisInput": None}
    if mode == "synthesis":
        md = "## Fleet Synthesis Source\n\n" + "\n\n".join(lines)
        return {
            "markdown": md,
            "synthesisInput": {
                "task": "综合以下舰队成员报告，产出统一结论与下一步建议（禁止重跑探索）。",
                "fleetReports": sorted_rows,
                "sourceMarkdown": md,
            },
        }
    md = "## Fleet Ordered\n\n" + "\n\n".join(lines)
    return {"markdown": md, "synthesisInput": None}


def _enqueue_fleet_job(
    session: Session,
    *,
    fleet_id: str,
    job_id: str,
    run_id: str,
    state: dict[str, Any],
    index: int,
    respect_governor: bool = True,
) -> bool:
    """Enqueue one fleet member. Returns False if deferred by LLM governor."""
    job = session.get(Job, job_id)
    if not job:
        return False
    resolve_agent(session, job.payload.get("agentId"), job.project_id, job.user_id)
    if respect_governor:
        from .. import llm_governor

        if not llm_governor.slots_available(priority="fleet"):
            deferred = list(state.get("deferredIndexes") or [])
            if index not in deferred:
                deferred.append(index)
                deferred.sort()
                state["deferredIndexes"] = deferred
            run = session.get(AgentRun, run_id)
            if run:
                run.progress_stage = "限流排队"
                session.add(run)
                session.commit()
            return False
    # 数据库 fallback 只领取 queued；调度放行前必须保持 blocked。
    from sqlalchemy import update
    released = session.execute(update(Job).where(Job.id == job_id, Job.status == "blocked",
                                    Job.result_ref == run_id).values(status="queued")).rowcount
    enqueued = list(state.get("enqueuedIndexes") or [])
    if index not in enqueued:
        enqueued.append(index)
        enqueued.sort()
        state["enqueuedIndexes"] = enqueued
    deferred = [i for i in list(state.get("deferredIndexes") or []) if i != index]
    state["deferredIndexes"] = deferred
    _sync_fleet_artifact(session, state)
    session.commit()
    if not released:
        return True
    if (job.payload.get("input") or {}).get("pipelineExecutionId") and session.info.get("inbox_owners"):
        from ..agent_inbox import check_owner
        check_owner(session, job.conversation_id)
    enqueue_job(job.id, {"type": job.type, "payload": job.payload, "runId": run_id})
    publish_job_event(
        job.id,
        {
            "type": "status",
            "status": "queued",
            "jobId": job.id,
            "runId": run_id,
            "fleetId": fleet_id,
            "fleetIndex": index,
        },
    )
    return True


def _sync_fleet_artifact(session: Session, state: dict[str, Any]) -> None:
    art_id = state.get("artifactId")
    if not art_id:
        return
    art = session.get(Artifact, art_id)
    if not art:
        return
    art.body_json = state
    art.body_markdown = state.get("mergeMarkdown") or json.dumps(state, ensure_ascii=False)
    art.updated_at = utcnow()
    session.add(art)
    session.commit()


def _fleet_snapshot(artifact: Artifact, fleet_id: str) -> dict[str, Any] | None:
    state = artifact.body_json
    if (
        artifact.type == "other"
        and isinstance(state, dict)
        and state.get("artifactId") == artifact.id
        and state.get("planId") == fleet_id
        and state.get("projectId") == artifact.project_id
    ):
        return state
    return None


def _load_fleet_state(session: Session, fleet_id: str) -> dict[str, Any]:
    cached = get_fleet_state(fleet_id)
    if cached:
        return cached

    rows = session.exec(
        select(Artifact)
        .join(Project, Project.id == Artifact.project_id)
        .where(Artifact.title == f"fleet-{fleet_id}", Project.user_id == get_settings().demo_user_id)
    )
    snapshots = [state for artifact in rows if (state := _fleet_snapshot(artifact, fleet_id))]
    if len(snapshots) != 1:
        raise HTTPException(404, "fleet not found")
    return snapshots[0]


_FLEET_FAILURE_LABELS = {"failed": "任务失败", "dead": "任务异常终止", "cancelled": "任务已取消"}


def _fleet_member_failure(
    session: Session, state: dict[str, Any], report: dict[str, Any],
) -> str | None:
    job_id, run_id = report.get("jobId"), report.get("runId")
    if not job_id or not run_id:
        return None
    job = session.get(Job, job_id)
    if (
        not job
        or job.status not in _FLEET_FAILURE_LABELS
        or job.result_ref != run_id
        or job.project_id != state.get("projectId")
        or job.payload.get("fleetId") != state.get("planId")
    ):
        return None
    run = session.get(AgentRun, run_id)
    if run and run.project_id == job.project_id and run.status in _FLEET_FAILURE_LABELS:
        return job.status
    return None


def _project_fleet_status(session: Session, state: dict[str, Any]) -> dict[str, Any]:
    """Show terminal Job/Run failures without running fleet transitions."""
    reports = []
    for report in state.get("reports") or []:
        if report.get("status") in {"pending", "running"}:
            failure = _fleet_member_failure(session, state, report)
            if failure:
                summary = _FLEET_FAILURE_LABELS[failure]
                if report.get("summary"):
                    summary += f"。{report['summary']}"
                report = {**report, "status": "failed", "summary": summary}
        reports.append(report)
    if reports and all(r.get("status") in {"done", "failed"} for r in reports) and any(
        r.get("status") == "failed" for r in reports
    ):
        return {**state, "reports": reports, "status": "failed", "awaitingHumanMerge": False}
    return {**state, "reports": reports}


def _write_merged_artifact(session: Session, fleet_id: str, state: dict[str, Any]) -> dict[str, Any]:
    """合并摘要落盘为独立项目产物（可回看）。"""
    if state.get("mergedArtifactId"):
        return state
    md = str(state.get("mergeMarkdown") or "").strip()
    if not md:
        return state
    project_id = str(state.get("projectId") or "")
    if not project_id:
        return state
    art = Artifact(
        id=new_id(),
        project_id=project_id,
        type="other",
        title=f"fleet-merge-{fleet_id}",
        body_markdown=md,
        body_json={
            "fleetId": fleet_id,
            "mode": state.get("mode"),
            "mergePolicy": state.get("mergePolicy"),
            "planId": fleet_id,
        },
        status="accepted",
    )
    session.add(art)
    session.commit()
    session.refresh(art)
    state["mergedArtifactId"] = art.id
    return state


def _enqueue_next_ordered_member(
    session: Session,
    fleet_id: str,
    state: dict[str, Any],
) -> dict[str, Any]:
    """ordered：当前 done 后入队下一个 pending。"""
    if state.get("mode") != "ordered":
        return state
    reports = sorted(list(state.get("reports") or []), key=lambda r: int(r.get("index") or 0))
    enqueued = set(int(i) for i in (state.get("enqueuedIndexes") or []))
    for r in reports:
        idx = int(r.get("index") or 0)
        if r.get("status") == "done":
            continue
        # 只允许第一个未完成成员运行；重复 done 回调不能跨过正在运行的成员。
        if r.get("status") != "pending" or idx in enqueued:
            break
        if r.get("status") == "pending" and idx not in enqueued and r.get("jobId") and r.get("runId"):
            upstream = []
            for previous in reports:
                if int(previous.get("index") or 0) >= idx:
                    break
                previous_run = session.get(AgentRun, previous['runId'])
                # Fleet done 回调先于 worker.finalize；此时 output_artifact_ids 可能尚未回写。
                artifact_ids = list(previous_run.output_artifact_ids or []) if previous_run else []
                if not artifact_ids:
                    artifact_ids = list(session.exec(select(Artifact.id).where(
                        Artifact.project_id == state['projectId'],
                        Artifact.created_by_run_id == previous['runId'],
                    )))
                upstream.append({'name': previous['name'], 'runId': previous['runId'],
                                 'summary': previous.get('summary') or '',
                                 'artifactIds': artifact_ids})
            run = session.get(AgentRun, r['runId'])
            job = session.get(Job, r['jobId'])
            if run and job:
                run.input_json = {**(run.input_json or {}), 'fleetUpstream': upstream}
                job.payload = {**(job.payload or {}), 'input': run.input_json}
                session.add(run)
                session.add(job)
                session.commit()
            _enqueue_fleet_job(
                session,
                fleet_id=fleet_id,
                job_id=str(r["jobId"]),
                run_id=str(r["runId"]),
                state=state,
                index=idx,
            )
            break
    return state


def create_fleet_impl(
    session: Session,
    body: FleetCreateIn,
    conversation_id: str | None = None,
    *,
    bind_dispatch=None,
) -> dict:
    """创建舰队：union/synthesis 并行入队；ordered 仅入队 index=0。

    抽成可复用函数，供 `POST /fleet` 路由与 Personal Agent Supervisor 共用。
    """
    if not body.members:
        raise HTTPException(400, "members required")
    if len(body.members) > MAX_FLEET_MEMBERS:
        raise HTTPException(400, f"members exceeds max {MAX_FLEET_MEMBERS}")

    project = session.get(Project, body.projectId)
    if not project:
        raise HTTPException(404, "project not found")
    project_format = project.format or "manju"

    from ..agent_colleagues import agent_id_from_bot_id

    for member in body.members:
        member.agentId = agent_id_from_bot_id(member.agentId or "orch.writing")
    body.synthesisAgentId = agent_id_from_bot_id(body.synthesisAgentId)
    owner = get_settings().demo_user_id
    names = [m.name.strip() for m in body.members]
    if any(not m.task.strip() for m in body.members):
        raise HTTPException(400, "fleet member tasks must be nonempty")
    if any(not name for name in names) or len(names) != len(set(names)):
        raise HTTPException(400, 'fleet member names must be nonempty and unique')
    agent_ids = [m.agentId or 'orch.writing' for m in body.members]
    if body.mode == 'synthesis':
        agent_ids.append(body.synthesisAgentId)
    for agent_id in agent_ids:
        meta = resolve_agent(session, agent_id, project.id, owner)
        if not meta:
            raise HTTPException(400, f'unknown agent: {agent_id}')
        formats = meta.get('formats') or ['*']
        if '*' not in formats and project_format not in formats:
            raise HTTPException(400, f'agent {agent_id} does not support {project_format}')

    fleet_id = f"fleet_{uuid.uuid4().hex[:16]}"
    with _fleet_state_lock(fleet_id):
        settings = get_settings()
        user_id = settings.demo_user_id
        reports: list[dict[str, Any]] = []
        jobs_out: list[dict[str, str]] = []

        for i, m in enumerate(body.members):
            agent_id = m.agentId or "orch.writing"
            workdir = m.workdir or _fleet_workdir(body.projectId, fleet_id, m.name)
            input_json = {
                "task": m.task,
                "fleetMember": m.name,
                "fleetWorkdir": workdir,
                "format": project_format,
            }
            run = AgentRun(
                project_id=body.projectId,
                conversation_id=conversation_id,
                agent_id=agent_id,
                status="queued",
                input_json=input_json,
                model=resolve_default_model(),
            )
            job = Job(
                type="agent.run",
                status="blocked",
                payload={
                    "runId": run.id,
                    "agentId": agent_id,
                    "input": input_json,
                    "fleetId": fleet_id,
                    "fleetIndex": i,
                    "fleetMode": body.mode,
                    "mergePolicy": body.mergePolicy,
                    "workdir": workdir,
                    "securityMode": m.securityMode or "safe",
                    "synthesisAgentId": body.synthesisAgentId,
                },
                project_id=body.projectId,
                conversation_id=conversation_id,
                user_id=user_id,
                result_ref=run.id,
            )
            session.add(run)
            session.add(job)
            if bind_dispatch:
                bind_dispatch(run, job)
            session.flush()
            reports.append(
                {
                    "name": m.name,
                    "agentId": agent_id,
                    "task": m.task,
                    "workdir": workdir,
                    "status": "pending",
                    "index": i,
                    "runId": run.id,
                    "jobId": job.id,
                    "summary": "",
                }
            )
            jobs_out.append({"jobId": job.id, "runId": run.id, "name": m.name})

        state: dict[str, Any] = {
            "planId": fleet_id,
            "mode": body.mode,
            "mergePolicy": body.mergePolicy,
            "projectId": body.projectId,
            "format": project_format,
            "synthesisAgentId": body.synthesisAgentId,
            "reports": reports,
            "enqueuedIndexes": [],
            "deferredIndexes": list(range(len(jobs_out))) if body.mode != "ordered" else [0],
        }
        art = Artifact(
            id=new_id(),
            project_id=body.projectId,
            type="other",
            title=f"fleet-{fleet_id}",
            body_markdown=json.dumps(state, ensure_ascii=False, indent=2),
            body_json=state,
            status="accepted",
        )
        session.add(art)
        state["artifactId"] = art.id
        art.body_json = dict(state)
        session.commit()

        if body.mode == "ordered":
            first = jobs_out[0]
            _enqueue_fleet_job(
                session,
                fleet_id=fleet_id,
                job_id=first["jobId"],
                run_id=first["runId"],
                state=state,
                index=0,
            )
        else:
            for i, j in enumerate(jobs_out):
                ok = _enqueue_fleet_job(
                    session,
                    fleet_id=fleet_id,
                    job_id=j["jobId"],
                    run_id=j["runId"],
                    state=state,
                    index=i,
                )
                if not ok:
                    # 剩余成员全部记入 deferred，由 tick 错峰入队
                    for k in range(i + 1, len(jobs_out)):
                        deferred = list(state.get("deferredIndexes") or [])
                        if k not in deferred:
                            deferred.append(k)
                        state["deferredIndexes"] = sorted(deferred)
                    break

        _sync_fleet_artifact(session, state)
        put_fleet_state(fleet_id, state)
        return {"ok": True, "fleetId": fleet_id, "jobs": jobs_out, "state": state}


def pump_deferred_fleets(session: Session) -> int:
    """错峰：把因限流延后的 fleet 成员入队。"""
    from .. import llm_governor

    if not llm_governor.slots_available(priority="fleet"):
        return 0
    rows = list(
        session.exec(
            select(Artifact)
            .where(Artifact.title.startswith("fleet-"))  # type: ignore[attr-defined]
            .order_by(Artifact.updated_at.desc())  # type: ignore[attr-defined]
        )
    )
    pumped = 0
    for art in rows:
        title = str(art.title or "")
        if title.startswith("fleet-merge-"):
            continue
        fleet_id = title.replace("fleet-", "", 1)
        with _fleet_state_lock(fleet_id):
            session.refresh(art)
            state = dict(art.body_json or {})
            deferred = list(state.get("deferredIndexes") or [])
            if not deferred:
                continue
            reports = list(state.get("reports") or [])
            still: list[int] = []
            for index in deferred:
                if not llm_governor.slots_available(priority="fleet"):
                    still.extend([i for i in deferred if i not in still and i >= index])
                    break
                report = next((r for r in reports if int(r.get("index", -1)) == index), None)
                if not report or report.get("status") in {"done", "failed"}:
                    continue
                if state.get("mode") == "ordered" and any(
                    r.get("status") != "done" for r in reports if int(r.get("index", -1)) < index
                ):
                    still.append(index)
                    continue
                job_id = str(report.get("jobId") or "")
                run_id = str(report.get("runId") or "")
                if not job_id or not run_id:
                    continue
                if _enqueue_fleet_job(
                    session,
                    fleet_id=fleet_id,
                    job_id=job_id,
                    run_id=run_id,
                    state=state,
                    index=index,
                ):
                    pumped += 1
                else:
                    still.append(index)
            state["deferredIndexes"] = still
            _sync_fleet_artifact(session, state)
            put_fleet_state(fleet_id, state)
    return pumped


@router.post("/fleet")
def create_fleet(body: FleetCreateIn, session: Session = Depends(get_session)) -> dict:
    return create_fleet_impl(session, body)


@router.get("/fleets")
def list_fleets(
    project_id: str = Query(..., alias="projectId"),
    session: Session = Depends(get_session),
) -> dict:
    """按项目列出舰队快照（来自 fleet-* artifacts，不含 fleet-merge-*）。"""
    rows = list(
        session.exec(
            select(Artifact)
            .join(Project, Project.id == Artifact.project_id)
            .where(Artifact.project_id == project_id)
            .where(Project.user_id == get_settings().demo_user_id)
            .where(Artifact.title.startswith("fleet-"))
            .order_by(Artifact.updated_at.desc())  # type: ignore[attr-defined]
        )
    )
    fleets: list[dict[str, Any]] = []
    for a in rows:
        if str(a.title).startswith("fleet-merge-"):
            continue
        plan_id = a.title.removeprefix("fleet-")
        snapshot = _fleet_snapshot(a, plan_id)
        if snapshot is None:
            continue
        live = _project_fleet_status(session, get_fleet_state(plan_id) or snapshot)
        fleets.append(
            {
                "planId": plan_id,
                "mode": live.get("mode"),
                "mergePolicy": live.get("mergePolicy"),
                "projectId": project_id,
                "format": live.get("format"),
                "awaitingHumanMerge": live.get("awaitingHumanMerge"),
                "mergedArtifactId": live.get("mergedArtifactId"),
                "artifactId": a.id,
                "enqueuedIndexes": live.get("enqueuedIndexes") or [],
                "reports": live.get("reports") or [],
                "updatedAt": (a.updated_at.isoformat() if a.updated_at else None),
            }
        )
    return {"fleets": fleets, "count": len(fleets)}


@router.get("/fleet/{fleet_id}")
def read_fleet(fleet_id: str, session: Session = Depends(get_session)) -> dict:
    return _project_fleet_status(session, _load_fleet_state(session, fleet_id))


@router.patch("/fleet/{fleet_id}/member")
def patch_fleet_member(
    fleet_id: str,
    body: FleetMemberPatchIn,
    session: Session = Depends(get_session),
) -> dict:
    """Worker 回写成员状态；ordered 链式入队；synthesis 可自动汇总。"""
    with _fleet_state_lock(fleet_id):
        state = _load_fleet_state(session, fleet_id)
        reports: list[dict[str, Any]] = list(state.get("reports") or [])
        target = None
        if body.index is not None:
            for r in reports:
                if int(r.get("index", -1)) == body.index:
                    target = r
                    break
        if target is None and body.name:
            for r in reports:
                if r.get("name") == body.name:
                    target = r
                    break
        if target is None and body.runId:
            for r in reports:
                if r.get("runId") == body.runId:
                    target = r
                    break
        if target is None:
            raise HTTPException(400, "member not found in fleet")

        # 终态回调幂等，迟到的 running 或相互矛盾的结果不能覆盖终态。
        if target.get('status') in {'done', 'failed'}:
            return state
        if body.status != "failed" and _fleet_member_failure(session, state, target):
            return _project_fleet_status(session, state)

        if "enqueuedIndexes" in state and target.get("index") not in state["enqueuedIndexes"] and body.status != "pending":
            raise HTTPException(409, "fleet member has not been admitted")
        if state.get("mode") == "ordered" and any(
            r.get("status") != "done" for r in reports
            if int(r.get("index", -1)) < int(target.get("index", -1))
        ):
            raise HTTPException(409, "fleet member is waiting for predecessors")

        target["status"] = body.status
        if body.summary is not None:
            target["summary"] = body.summary
        if body.runId:
            target["runId"] = body.runId
        if body.jobId:
            target["jobId"] = body.jobId

        state["reports"] = reports

        if body.status == 'failed' and state.get('mode') == 'ordered':
            for report in reports:
                if int(report.get('index', -1)) > int(target['index']):
                    report['status'] = 'failed'
                    report['summary'] = f"上游 {target['name']} 失败，未执行"
                    run = session.get(AgentRun, report['runId'])
                    job = session.get(Job, report['jobId'])
                    if run:
                        run.status = 'cancelled'
                        session.add(run)
                    if job:
                        job.status = 'cancelled'
                        session.add(job)
            state['deferredIndexes'] = []
            session.commit()

        if all(r.get('status') in {'done', 'failed'} for r in reports) and any(r.get('status') == 'failed' for r in reports):
            state['status'] = 'failed'
            state['awaitingHumanMerge'] = False
            _sync_fleet_artifact(session, state)
            put_fleet_state(fleet_id, state)
            return state

        # ordered：成员 done 后入队下一个
        if body.status == "done" and state.get("mode") == "ordered":
            state = _enqueue_next_ordered_member(session, fleet_id, state)

        terminal = all(r.get("status") in {"done", "failed"} for r in reports)
        synthesis_job_id = state.get("synthesisJobId")

        if (
            terminal
            and not synthesis_job_id
            and state.get("mode") == "synthesis"
            and state.get("mergePolicy") not in {"refuse", "human"}
        ):
            merged = _merge_fleet_markdown("synthesis", reports)
            settings = get_settings()
            agent_id = str(state.get("synthesisAgentId") or "orch.writing")
            project_id = str(state.get("projectId") or "")
            resolve_agent(session, agent_id, project_id, settings.demo_user_id)
            input_json = merged["synthesisInput"] or {}
            input_json.setdefault("format", state.get("format") or "manju")
            run = AgentRun(
                project_id=project_id,
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
                    "fleetId": fleet_id,
                    "fleetSynthesis": True,
                },
                project_id=project_id,
                user_id=settings.demo_user_id,
                result_ref=run.id,
            )
            session.add(run)
            session.add(job)
            session.commit()
            session.refresh(job)
            enqueue_job(job.id, {"type": job.type, "payload": job.payload, "runId": run.id})
            state["synthesisJobId"] = job.id
            state["mergeMarkdown"] = merged["markdown"]
            state = _write_merged_artifact(session, fleet_id, state)
        elif terminal:
            merged = _merge_fleet_markdown(str(state.get("mode") or "ordered"), reports)
            state["mergeMarkdown"] = merged["markdown"]
            if state.get("mergePolicy") == "human":
                state["awaitingHumanMerge"] = True
            elif state.get("mergePolicy") != "refuse":
                state = _write_merged_artifact(session, fleet_id, state)

        _sync_fleet_artifact(session, state)
        put_fleet_state(fleet_id, state)
        return state


class FleetConfirmMergeIn(BaseModel):
    accept: bool = True
    note: str | None = None


@router.post("/fleet/{fleet_id}/confirm-merge")
def confirm_fleet_merge(
    fleet_id: str,
    body: FleetConfirmMergeIn,
    session: Session = Depends(get_session),
) -> dict:
    """human mergePolicy：人工确认后落盘合并摘要；accept=false 标记拒绝。"""
    with _fleet_state_lock(fleet_id):
        state = _load_fleet_state(session, fleet_id)
        if not state.get("awaitingHumanMerge") and not state.get("mergeMarkdown"):
            raise HTTPException(400, "fleet is not awaiting human merge")

        state["awaitingHumanMerge"] = False
        state["humanMerge"] = {
            "accepted": bool(body.accept),
            "note": body.note or "",
            "at": datetime.now(timezone.utc).isoformat(),
        }
        if body.accept:
            if not state.get("mergeMarkdown"):
                reports = list(state.get("reports") or [])
                merged = _merge_fleet_markdown(str(state.get("mode") or "ordered"), reports)
                state["mergeMarkdown"] = merged["markdown"]
            if state.get("mode") == "synthesis" and not state.get("synthesisJobId"):
                merged = _merge_fleet_markdown("synthesis", list(state.get("reports") or []))
                settings = get_settings()
                agent_id = str(state.get("synthesisAgentId") or "orch.writing")
                project_id = str(state.get("projectId") or "")
                resolve_agent(session, agent_id, project_id, settings.demo_user_id)
                input_json = merged["synthesisInput"] or {}
                input_json.setdefault("format", state.get("format") or "manju")
                run = AgentRun(
                    project_id=project_id,
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
                        "fleetId": fleet_id,
                        "fleetSynthesis": True,
                    },
                    project_id=project_id,
                    user_id=settings.demo_user_id,
                    result_ref=run.id,
                )
                session.add(run)
                session.add(job)
                session.commit()
                session.refresh(job)
                enqueue_job(job.id, {"type": job.type, "payload": job.payload, "runId": run.id})
                state["synthesisJobId"] = job.id
                state["mergeMarkdown"] = merged["markdown"]
            state = _write_merged_artifact(session, fleet_id, state)
        else:
            state["mergeRejected"] = True

        _sync_fleet_artifact(session, state)
        put_fleet_state(fleet_id, state)
        return state
