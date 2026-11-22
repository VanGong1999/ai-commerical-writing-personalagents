"""把现有 agent-catalog 里的专职 agents 虚拟成「AI 同事」。

不落库：id 与目录相同，兼容旧 `agent:<catalog_id>`，由 get_bot / roster / squads 统一解析。
总编（chief）与蛋博士（eggbot）仍走持久化 Bot。
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from .models import Bot, utcnow

AGENT_PREFIX = "agent:"

ROOT = Path(__file__).resolve().parents[3]
AGENT_CATALOG_PATH = ROOT / "packages" / "agent-runtime" / "agent-catalog.json"
STAGE_GRAPHS_PATH = ROOT / "packages" / "agent-runtime" / "stage-graphs.json"

FORMAT_LABEL: dict[str, str] = {
    "manju": "漫剧",
    "duanju": "短剧",
    "male_long": "男频",
    "female_long": "女频",
    "short_novel": "短篇",
    "ip_adapt": "IP 改编",
    "*": "全体裁",
}

TEAM_EMOJI: dict[str, str] = {
    "编排": "🎩",
    "选题": "💡",
    "结构": "📐",
    "人设": "🎭",
    "正文": "✍️",
    "审校": "🔍",
    "钩子": "🪝",
    "拆书": "📚",
    "知识": "🧠",
    "换元": "🔄",
    "男频": "⚔️",
    "女频": "💫",
    "IP": "🎬",
    "交付": "📦",
    "记忆": "🧩",
    "场景": "🎞️",
    "其他": "🤖",
}

TEAM_COLOR: dict[str, str] = {
    "编排": "#6366f1",
    "选题": "#f59e0b",
    "结构": "#06b6d4",
    "人设": "#ec4899",
    "正文": "#22c55e",
    "审校": "#ef4444",
    "钩子": "#a855f7",
    "拆书": "#14b8a6",
    "知识": "#3b82f6",
    "换元": "#eab308",
    "男频": "#0ea5e9",
    "女频": "#f472b6",
    "IP": "#84cc16",
    "交付": "#64748b",
    "记忆": "#8b5cf6",
    "场景": "#f97316",
    "其他": "#94a3b8",
}


@lru_cache(maxsize=1)
def _catalog_ids() -> frozenset[str]:
    return frozenset(load_catalog_by_id())


def agent_id_from_bot_id(bot_id: str) -> str:
    if bot_id and bot_id.startswith(AGENT_PREFIX):
        candidate = bot_id[len(AGENT_PREFIX):]
        if candidate in _catalog_ids():
            return candidate
    return bot_id


def is_agent_colleague_id(bot_id: str | None) -> bool:
    return bool(bot_id) and agent_id_from_bot_id(bot_id) in _catalog_ids()


def bot_id_for_agent(agent_id: str) -> str:
    return agent_id_from_bot_id(agent_id)


def bot_id_aliases(bot_id: str) -> tuple[str, ...]:
    canonical = agent_id_from_bot_id(bot_id)
    if canonical in _catalog_ids():
        return canonical, AGENT_PREFIX + canonical
    return (bot_id,)


def canonical_members(ids: list[str]) -> list[str]:
    return list(dict.fromkeys(agent_id_from_bot_id(item) for item in ids))


@lru_cache(maxsize=1)
def _load_catalog_raw() -> tuple[dict[str, dict[str, Any]], ...]:
    """返回 (by_id_tuple_items,) 以便 lru_cache；实际用 load_catalog_by_id。"""
    path = AGENT_CATALOG_PATH
    if not path.is_file():
        return tuple()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return tuple()
    items: list[tuple[str, dict[str, Any]]] = []
    for a in data.get("agents") or []:
        aid = str(a.get("id") or "").strip()
        if not aid:
            continue
        formats = a.get("formats") or a.get("format") or ["*"]
        if isinstance(formats, str):
            formats = [formats]
        items.append(
            (
                aid,
                {
                    "id": aid,
                    "name": a.get("name") or aid,
                    "summary": a.get("summary") or a.get("description") or "",
                    "persona": a.get("persona") or a.get("name") or aid,
                    "team": a.get("team") or "其他",
                    "skillPath": a.get("skillPath") or "",
                    "when": a.get("when") or "",
                    "formats": list(formats),
                    "stage": a.get("stage"),
                    "tools": list(a.get("tools") or []),
                    "modelProfile": a.get("modelProfile") or "fast",
                },
            )
        )
    return tuple(items)


def load_catalog_by_id() -> dict[str, dict[str, Any]]:
    return dict(_load_catalog_raw())


def load_catalog_list() -> list[dict[str, Any]]:
    return [dict(v) for _, v in _load_catalog_raw()]


@lru_cache(maxsize=1)
def _load_stage_graphs_raw() -> str:
    if not STAGE_GRAPHS_PATH.is_file():
        return "{}"
    try:
        return STAGE_GRAPHS_PATH.read_text(encoding="utf-8")
    except Exception:  # noqa: BLE001
        return "{}"


def load_stage_graphs() -> dict[str, list[dict[str, Any]]]:
    raw = json.loads(_load_stage_graphs_raw())
    out: dict[str, list[dict[str, Any]]] = {}
    for fmt, stages in (raw or {}).items():
        if isinstance(stages, list):
            out[str(fmt)] = stages
    return out


def _format_labels(formats: list[str]) -> list[str]:
    return [FORMAT_LABEL.get(f, f) for f in formats]


def _tool_plain(tool_id: str) -> dict[str, str]:
    try:
        from .tool_catalog_meta import lookup_tool

        meta = lookup_tool(tool_id)
        return {
            "id": str(meta.get("id") or tool_id),
            "label": str(meta.get("label") or meta.get("name") or tool_id),
            "desc": str(meta.get("desc") or meta.get("description") or ""),
        }
    except Exception:  # noqa: BLE001
        return {"id": tool_id, "label": tool_id, "desc": ""}


def _neighbors(agent_id: str) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    """由 stage-graphs 推导上游 / 下游同事（按阶段 next 边）。"""
    by_id = load_catalog_by_id()
    upstream: dict[str, dict[str, str]] = {}
    downstream: dict[str, dict[str, str]] = {}
    for _fmt, stages in load_stage_graphs().items():
        stage_by_id = {str(s.get("id")): s for s in stages if s.get("id")}
        for st in stages:
            aids = [str(x) for x in (st.get("agentIds") or [])]
            if agent_id not in aids:
                continue
            # 同阶段其他成员视为协作同伴（上下游都记一点）
            for other in aids:
                if other == agent_id or other not in by_id:
                    continue
                peer = {
                    "id": bot_id_for_agent(other),
                    "agentId": other,
                    "name": str(by_id[other].get("persona") or by_id[other].get("name")),
                }
                upstream[other] = peer
            for nxt in st.get("next") or []:
                nxt_st = stage_by_id.get(str(nxt))
                if not nxt_st:
                    continue
                for other in nxt_st.get("agentIds") or []:
                    oid = str(other)
                    if oid == agent_id or oid not in by_id:
                        continue
                    downstream[oid] = {
                        "id": bot_id_for_agent(oid),
                        "agentId": oid,
                        "name": str(by_id[oid].get("persona") or by_id[oid].get("name")),
                    }
            # 谁指向本阶段 → 上游
            for prev in stages:
                if str(st.get("id")) in (prev.get("next") or []):
                    for other in prev.get("agentIds") or []:
                        oid = str(other)
                        if oid == agent_id or oid not in by_id:
                            continue
                        upstream[oid] = {
                            "id": bot_id_for_agent(oid),
                            "agentId": oid,
                            "name": str(by_id[oid].get("persona") or by_id[oid].get("name")),
                        }
    return list(upstream.values())[:8], list(downstream.values())[:8]


def virtual_bot_from_agent(agent: dict[str, Any]) -> Bot:
    """把目录项变成内存中的 Bot（不入库）。"""
    aid = str(agent["id"])
    team = str(agent.get("team") or "其他")
    persona = str(agent.get("persona") or agent.get("name") or aid)
    name = persona
    aliases = list(
        {
            str(agent.get("name") or ""),
            aid,
            aid.split(".")[-1] if "." in aid else "",
        }
        - {"", name}
    )
    summary = str(agent.get("summary") or "")
    when = str(agent.get("when") or "")
    tools = [str(t) for t in (agent.get("tools") or [])]
    return Bot(
        id=bot_id_for_agent(aid),
        name=name,
        aliases=aliases,
        avatar={
            "emoji": TEAM_EMOJI.get(team, "🤖"),
            "color": TEAM_COLOR.get(team, "#94a3b8"),
            "team": team,
        },
        persona=f"你是「{persona}」：{summary}" if summary else f"你是「{persona}」。",
        tone="专业、简洁、中文 Markdown",
        duties=[d for d in [summary, when and f"时机：{when}"] if d],
        never_do=["不越权做其他同事的专职工作", "不跳过需要主人确认的门禁"],
        role_kind="specialist",
        delegate_only=False,
        allowed_agent_ids=[aid],
        tool_allowlist=tools,
        model_profile=str(agent.get("modelProfile") or "fast"),
        trust_level=2,
        veto_window_min=60,
        restate_before_act=False,
        weekly_token_budget=None,
        pinned=False,
        is_system=True,
        template_id=aid,
        status="active",
        owner_user_id="system",
        created_at=utcnow(),
        updated_at=utcnow(),
    )


def get_virtual_bot(bot_id: str) -> Bot | None:
    if not is_agent_colleague_id(bot_id):
        # 也允许直接传 catalog id
        by_id = load_catalog_by_id()
        if bot_id in by_id:
            return virtual_bot_from_agent(by_id[bot_id])
        return None
    aid = agent_id_from_bot_id(bot_id)
    agent = load_catalog_by_id().get(aid)
    if not agent:
        return None
    return virtual_bot_from_agent(agent)


def list_virtual_bots() -> list[Bot]:
    return [virtual_bot_from_agent(a) for a in load_catalog_list()]


def roster(*, format_filter: str | None = None, team_filter: str | None = None, agents=None) -> dict[str, Any]:
    """按 team 分组的花名册，附带白话职责与上下游。"""
    agents = agents if agents is not None else load_catalog_list()
    if format_filter and format_filter not in {"", "全部", "*"}:
        agents = [
            a
            for a in agents
            if format_filter in (a.get("formats") or []) or "*" in (a.get("formats") or [])
        ]
    if team_filter and team_filter not in {"", "全部"}:
        agents = [a for a in agents if (a.get("team") or "其他") == team_filter]

    teams: dict[str, list[dict[str, Any]]] = {}
    for a in agents:
        team = str(a.get("team") or "其他")
        up, down = _neighbors(str(a["id"]))
        tools = [_tool_plain(t) for t in (a.get("tools") or [])[:8]]
        card = {
            "id": bot_id_for_agent(str(a["id"])),
            "agentId": a["id"],
            "name": a.get("persona") or a.get("name"),
            "displayName": a.get("persona") or a.get("name"),
            "catalogName": a.get("name"),
            "team": team,
            "teamColor": TEAM_COLOR.get(team, "#94a3b8"),
            "emoji": TEAM_EMOJI.get(team, "🤖"),
            "summary": a.get("summary") or "",
            "when": a.get("when") or "",
            "formats": a.get("formats") or ["*"],
            "formatLabels": _format_labels(list(a.get("formats") or ["*"])),
            "stage": a.get("stage"),
            "tools": tools,
            "upstream": up,
            "downstream": down,
            "examplePrompts": _example_prompts(a),
            "roleKind": "specialist",
            "isVirtual": not a.get("custom", False),
            "projectId": a.get("projectId"),
        }
        teams.setdefault(team, []).append(card)

    # 稳定排序：按团队规模降序，组内按名字
    ordered_teams = sorted(teams.items(), key=lambda kv: (-len(kv[1]), kv[0]))
    for _, members in ordered_teams:
        members.sort(key=lambda m: str(m.get("name") or ""))

    return {
        "chief": {
            "id": "chief",
            "name": "幕僚长",
            "displayName": "幕僚长",
            "aliases": ["总编"],
            "team": "编排",
            "teamColor": TEAM_COLOR["编排"],
            "emoji": "🎩",
            "summary": "默认联系人：统筹分派、汇总进度、向主人请示。",
            "when": "不知道找谁时先找总编",
            "isVirtual": False,
            "roleKind": "chief",
            "pinned": True,
        },
        "eggbot": {
            "id": "eggbot",
            "name": "蛋博士",
            "displayName": "蛋博士",
            "team": "编排",
            "teamColor": TEAM_COLOR.get("编排", "#6366f1"),
            "emoji": "🥚",
            "summary": "高级：设计自定义同事、体检例程。",
            "when": "需要造自定义同事或审计例程时",
            "isVirtual": False,
            "roleKind": "designer",
            "pinned": True,
            "advanced": True,
        },
        "teams": [
            {
                "team": team,
                "teamColor": TEAM_COLOR.get(team, "#94a3b8"),
                "emoji": TEAM_EMOJI.get(team, "🤖"),
                "count": len(members),
                "members": members,
            }
            for team, members in ordered_teams
        ],
        "stats": {
            "domainAgents": sum(len(m) for _, m in ordered_teams),
            "teams": len(ordered_teams),
        },
    }


def _example_prompts(agent: dict[str, Any]) -> list[str]:
    persona = agent.get("persona") or agent.get("name") or "你"
    summary = agent.get("summary") or "帮我做你擅长的事"
    when = agent.get("when") or ""
    prompts = [f"@{persona} {summary}"]
    if when:
        prompts.append(f"@{persona} 现在到了「{when}」，请按你的职责推进。")
    prompts.append(f"@{persona} 先说明你会怎么做，再动手。")
    return prompts[:3]


def squads() -> list[dict[str, Any]]:
    """编组预设：按体裁工作流 + 按 team。"""
    by_id = load_catalog_by_id()
    out: list[dict[str, Any]] = []

    for fmt, stages in load_stage_graphs().items():
        member_ids: list[str] = []
        stage_nodes: list[dict[str, Any]] = []
        seen: set[str] = set()
        for st in stages:
            aids = [str(x) for x in (st.get("agentIds") or []) if str(x) in by_id]
            stage_nodes.append(
                {
                    "id": st.get("id"),
                    "name": st.get("name") or st.get("id"),
                    "requiresUserAck": bool(st.get("requiresUserAck")),
                    "mode": st.get("mode") or "ordered",
                    "next": list(st.get("next") or []),
                    "agentIds": aids,
                    "memberBotIds": [bot_id_for_agent(a) for a in aids],
                }
            )
            for a in aids:
                if a not in seen:
                    seen.add(a)
                    member_ids.append(bot_id_for_agent(a))
        if not member_ids:
            continue
        label = FORMAT_LABEL.get(fmt, fmt)
        out.append(
            {
                "id": f"squad.workflow.{fmt}",
                "kind": "workflow",
                "format": fmt,
                "name": f"{label}主线编组",
                "description": f"按「{label}」工作流阶段依次接力；关键阶段需主人确认。",
                "speakPolicy": "pipeline",
                "leadBotId": "chief",
                "memberBotIds": member_ids,
                "stages": stage_nodes,
                "coverageTeams": sorted(
                    {
                        str(by_id[agent_id_from_bot_id(m)].get("team") or "其他")
                        for m in member_ids
                        if agent_id_from_bot_id(m) in by_id
                    }
                ),
            }
        )

    # 按 team 的轻量预设
    team_members: dict[str, list[str]] = {}
    for a in load_catalog_list():
        team = str(a.get("team") or "其他")
        team_members.setdefault(team, []).append(bot_id_for_agent(str(a["id"])))
    for team, members in sorted(team_members.items(), key=lambda kv: (-len(kv[1]), kv[0])):
        if len(members) < 2:
            continue
        out.append(
            {
                "id": f"squad.team.{team}",
                "kind": "team",
                "format": None,
                "name": f"{team}小组",
                "description": f"召集「{team}」组全部同事协作。",
                "speakPolicy": "orchestrated",
                "leadBotId": "chief",
                "memberBotIds": members,
                "stages": [],
                "coverageTeams": [team],
            }
        )
    return out


def coverage_report(member_bot_ids: list[str], *, format: str | None = None) -> dict[str, Any]:
    """编组覆盖 / 缺口：对照某体裁工作流需要的 agents。"""
    by_id = load_catalog_by_id()
    selected_agents = {
        agent_id_from_bot_id(m)
        for m in member_bot_ids
        if is_agent_colleague_id(m) or agent_id_from_bot_id(m) in by_id
    }
    selected_teams = {
        str(by_id[a].get("team") or "其他") for a in selected_agents if a in by_id
    }
    required: list[dict[str, Any]] = []
    missing: list[dict[str, Any]] = []
    if format and format in load_stage_graphs():
        for st in load_stage_graphs()[format]:
            for aid in st.get("agentIds") or []:
                aid = str(aid)
                if aid not in by_id:
                    continue
                item = {
                    "agentId": aid,
                    "botId": bot_id_for_agent(aid),
                    "name": by_id[aid].get("persona") or by_id[aid].get("name"),
                    "stage": st.get("id"),
                    "stageName": st.get("name"),
                    "team": by_id[aid].get("team"),
                }
                required.append(item)
                if aid not in selected_agents:
                    missing.append(item)
    return {
        "selectedCount": len(selected_agents),
        "selectedTeams": sorted(selected_teams),
        "requiredCount": len(required),
        "missing": missing,
        "coverageRatio": (1.0 if not required else max(0.0, 1.0 - len(missing) / max(1, len(required)))),
    }


def resolve_agent_mentions(text: str, *, catalog: dict[str, dict[str, Any]] | None = None) -> list[str]:
    """在全文里按 @persona / @name / @agentId 解析出目录 bot_id。"""
    import re

    if not text:
        return []
    catalog = catalog or load_catalog_by_id()
    name_map: dict[str, str] = {}
    for aid, a in catalog.items():
        bid = bot_id_for_agent(aid)
        for label in filter(
            None,
            [
                str(a.get("persona") or ""),
                str(a.get("name") or ""),
                aid,
                aid.split(".")[-1] if "." in aid else "",
            ],
        ):
            name_map[label.lower()] = bid
    found: list[str] = []
    seen: set[str] = set()
    for m in re.finditer(r"@([^\s@，,。.!！？?：:；;]+)", text):
        key = m.group(1).strip().lower()
        bid = name_map.get(key)
        if bid and bid not in seen:
            seen.add(bid)
            found.append(bid)
    return found
