"""Bot 注册表：CRUD、seed、记忆挂载、@提及解析。"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from sqlmodel import Session, select

from .agent_colleagues import agent_id_from_bot_id, bot_id_aliases, canonical_members, is_agent_colleague_id
from .memory_service import cas_write_memory, ensure_store
from .models import Bot, BotSkill, BotTeam, MemoryFile, ScheduledTask, new_id, utcnow

CHIEF_BOT_ID = "chief"
EGG_BOT_ID = "eggbot"

_REPO_ROOT = Path(__file__).resolve().parents[3]
_TEMPLATES_DIR = _REPO_ROOT / "packages" / "agent-runtime" / "bot-templates"

_MENTION_RE = re.compile(r"@([^\s@，,。.!！？?：:；;]+)")


def _default_avatar(emoji: str, color: str = "#6366f1") -> dict[str, Any]:
    return {"emoji": emoji, "color": color}


SYSTEM_BOTS: list[dict[str, Any]] = [
    {
        "id": CHIEF_BOT_ID,
        "name": "幕僚长",
        "aliases": ["总编", "chief", "幕僚"],
        "avatar": _default_avatar("🎩", "#4f46e5"),
        "persona": "你是写作漫剧产品的幕僚长：调度与汇报，不亲自干重活。",
        "tone": "简洁、果断、中文 Markdown",
        "duties": ["统一分派任务", "汇总进度", "向主人汇报并请示"],
        "never_do": ["不替主人公开发布", "不跳过审批写正文"],
        "role_kind": "chief",
        "delegate_only": True,
        "trust_level": 2,
        "restate_before_act": False,
        "pinned": True,
        "is_system": True,
        "tool_allowlist": [],
        "allowed_agent_ids": [],
    },
    {
        "id": EGG_BOT_ID,
        "name": "蛋博士",
        "aliases": ["Dr Eggbot", "eggbot", "Eggbot"],
        "avatar": _default_avatar("🥚", "#f59e0b"),
        "persona": "你是 Bot 设计师与审计官：帮主人造好 Bot、体检例程、提出改进；同时是 Agent 实例的生命周期管理员（agent_ps 巡检、agent_inspect 诊断、agent_pause/agent_resume/stop_agent 处置卡住或失控的实例，处置后向主人汇报）。",
        "tone": "严谨、带一点幽默，喜欢给 Bot 取有趣的名字",
        "duties": ["设计 Bot", "审计纠错与例程效率", "提出改进提案", "管理 Agent 实例生命周期（ps/inspect/pause/resume/stop）并处置卡住实例"],
        "never_do": ["不替其他 Bot 直接写正文", "不擅自删除系统 Bot"],
        "role_kind": "designer",
        "delegate_only": False,
        "trust_level": 2,
        "pinned": True,
        "is_system": True,
        "template_id": "eggbot",
        "tool_allowlist": [
            "bot_create",
            "bot_update",
            "bot_list",
            "bot_inspect",
            "routine_audit",
            "agent_ps",
            "agent_inspect",
            "agent_pause",
            "agent_resume",
            "stop_agent",
            "list_async_tasks",
            "agent_status",
            "ask_bot",
            "skill_save",
            "routine_list",
            "show_memories",
            "catch_up",
            "restate_intent",
            "search_tools",
            "invoke_tool",
            "read_memory",
            "write_memory",
            "ls",
            "read",
            "write",
            "list_proposals",
            "approve_proposal",
            "navigate",
            "plan",
            "follow_up",
        ],
    },
]


def ensure_bot_memory(session: Session, bot: Bot) -> None:
    """为 Bot 创建私有记忆库与种子文件。虚拟同事（agent:）跳过落库。"""

    if is_agent_colleague_id(bot.id):
        return
    store_id = f"bot.{bot.id}.profile"
    ensure_store(
        session,
        store_id,
        name=f"{bot.name} 私有记忆",
        kind="agent",
        scope_ref=bot.id,
        description=f"Bot {bot.name} 的 profile / corrections / journal",
        shared=False,
    )
    seeds = {
        f"/memories/bots/{bot.id}/profile.md": (
            f"# {bot.name}\n\n"
            f"- 职责：{', '.join(bot.duties) or '（未设）'}\n"
            f"- 禁止：{', '.join(bot.never_do) or '（未设）'}\n"
            f"- 语气：{bot.tone or '默认'}\n"
            f"- 人设：{bot.persona or '（未设）'}\n"
        ),
        f"/memories/bots/{bot.id}/corrections.md": f"# {bot.name} 纠错记录\n\n",
        f"/memories/bots/{bot.id}/journal.md": f"# {bot.name} 工作日志\n\n",
        f"/memories/bots/{bot.id}/reported.md": f"# {bot.name} 已汇报\n\n",
    }
    for path, content in seeds.items():
        existing = session.exec(select(MemoryFile).where(MemoryFile.path == path)).first()
        if existing:
            continue
        try:
            cas_write_memory(
                session,
                path=path,
                content=content,
                expected_hash=None,
                actor=f"bot:{bot.id}",
                allow_create=True,
            )
        except Exception:  # noqa: BLE001
            pass


def seed_system_bots(session: Session) -> list[Bot]:
    """幂等写入系统 Bot（幕僚长、蛋博士）。"""
    out: list[Bot] = []
    for spec in SYSTEM_BOTS:
        row = session.get(Bot, spec["id"])
        payload = {k: v for k, v in spec.items() if k != "id"}
        payload["updated_at"] = utcnow()
        if row:
            for k, v in payload.items():
                setattr(row, k, v)
            session.add(row)
        else:
            row = Bot(id=spec["id"], **payload)
            session.add(row)
        session.commit()
        session.refresh(row)
        ensure_bot_memory(session, row)
        out.append(row)
    _seed_eggbot_routines(session)
    return out


def _seed_eggbot_routines(session: Session) -> None:
    specs = [
        {
            "id": "eggbot.daily_audit",
            "name": "蛋博士·工作日纠错审计",
            "cron_or_interval": "0 9 * * 1-5",
            "enabled": True,
            "description": "扫描各 Bot 纠错与误解，提出改进提案",
            "prompt": "扫描所有 Bot 的 corrections.md 与近期对话纠错，提出 bot_improvement 提案。",
            "quiet_policy": "digest",
        },
        {
            "id": "eggbot.weekly_routine_audit",
            "name": "蛋博士·周一例程体检",
            "cron_or_interval": "0 10 * * 1",
            "enabled": True,
            "description": "体检例程频率与 token 成本",
            "prompt": "运行 routine_audit：找出未使用、过勤、过贵的例程并提出调整。",
            "quiet_policy": "digest",
        },
        {
            "id": "eggbot.weekly_manual_labor",
            "name": "蛋博士·周一手动搬运盘点",
            "cron_or_interval": "0 11 * * 1",
            "enabled": True,
            "description": "回顾一周对话，找出主人仍在手动/复制粘贴的步骤",
            "prompt": (
                "用 chat_audit 回顾本周所有 Bot 对话，找出主人还在手动做、或要把信息复制粘贴给你的步骤。"
                "逐条说明：你能不能直接替主人做？要做的话需要主人连接/授权什么？"
                "哪些可以写成脚本或技能省额度？以 bot_improvement 提案形式提出。"
            ),
            "quiet_policy": "digest",
        },
    ]
    for s in specs:
        row = session.get(ScheduledTask, s["id"])
        data = dict(
            name=s["name"],
            cron_or_interval=s["cron_or_interval"],
            enabled=s["enabled"],
            owner_scope="bot",
            description=s["description"],
            payload_template={"type": "bot.routine", "bot_id": EGG_BOT_ID},
            bot_id=EGG_BOT_ID,
            prompt=s["prompt"],
            trigger_type="schedule",
            quiet_policy=s["quiet_policy"],
        )
        if row:
            for k, v in data.items():
                setattr(row, k, v)
            session.add(row)
        else:
            session.add(ScheduledTask(id=s["id"], **data))
    session.commit()


def list_bots(
    session: Session,
    *,
    include_archived: bool = False,
    include_virtual: bool = False,
) -> list[Bot]:
    q = select(Bot)
    if not include_archived:
        q = q.where(Bot.status != "archived")
    rows = [row for row in session.exec(q) if not is_agent_colleague_id(row.id)]
    if include_virtual:
        from .agent_colleagues import list_virtual_bots

        existing = {b.id for b in rows}
        for vb in list_virtual_bots():
            if vb.id not in existing:
                rows.append(vb)
    rows.sort(key=lambda b: (not b.pinned, b.name))
    return rows


def get_bot(session: Session, bot_id: str) -> Bot | None:
    if not bot_id:
        return None
    from .agent_colleagues import get_virtual_bot

    virtual = get_virtual_bot(bot_id)
    if virtual and session.exec(select(Bot.id).where(Bot.id.in_(bot_id_aliases(bot_id)))).first():
        from fastapi import HTTPException
        raise HTTPException(409, "同事 ID 与已有记录冲突")
    return virtual or session.get(Bot, bot_id)


def private_memory_files(session: Session, bot_id: str, user_id: str, project_id: str | None,
                         conversation_id: str | None = None) -> list[MemoryFile]:
    files = {}
    for identity in bot_id_aliases(bot_id):
        prefix = f"/memories/bots/{identity}/"
        rows = session.exec(select(MemoryFile).where(
            MemoryFile.user_id == user_id, MemoryFile.path.startswith(prefix, autoescape=True)
        ))
        for row in rows:
            relative = row.path[len(prefix):]
            if row.project_id and row.project_id != project_id:
                continue
            if relative.startswith("projects/") and not relative.startswith(f"projects/{project_id}/"):
                continue
            if relative.startswith("conversations/") and not relative.startswith(f"conversations/{conversation_id}/"):
                continue
            files.setdefault(relative, row)
    return list(files.values())


def create_bot(session: Session, data: dict[str, Any], *, owner_user_id: str = "demo_user") -> Bot:
    if "owner_user_id" in data or data.get("is_system", False) is not False:
        raise ValueError("不可指定同事所有者或系统身份")
    bot_id = data.pop("id", None) or new_id()
    if bot_id in (CHIEF_BOT_ID, EGG_BOT_ID) or session.get(Bot, bot_id):
        raise ValueError("同事 ID 已保留或已存在")
    if is_agent_colleague_id(bot_id):
        raise ValueError("目录 ID 已保留")
    from .knowledge_colleague import validate_config
    data["execution"] = validate_config(session, owner_user_id, data.get("execution") or {}, data.get("tool_allowlist") or [])
    bot = Bot(id=bot_id, owner_user_id=owner_user_id, **data)
    session.add(bot)
    session.commit()
    session.refresh(bot)
    ensure_bot_memory(session, bot)
    return bot


def patch_bot(session: Session, bot: Bot, patch: dict[str, Any]) -> Bot:
    if {"id","is_system","owner_user_id"} & patch.keys():
        raise ValueError("同事身份不可修改")
    if is_agent_colleague_id(bot.id):
        raise ValueError("内置同事不可编辑")
    if bot.is_system and patch.get("status") == "archived":
        raise ValueError("系统 Bot 不可归档")
    if patch.get("notify_policy") not in (None, "all", "important", "none"):
        raise ValueError("notify_policy 只能是 all / important / none")
    from .knowledge_colleague import canonical_bot_owner, validate_config
    if bot.is_system and patch.get("execution"):
        raise ValueError("系统同事不支持自定义知识岗位")
    if "execution" in patch or "tool_allowlist" in patch:
        patch["execution"] = validate_config(session, canonical_bot_owner(bot.owner_user_id), patch.get("execution", bot.execution), patch.get("tool_allowlist", bot.tool_allowlist))
    for k, v in patch.items():
        if v is not None and hasattr(bot, k):
            setattr(bot, k, v)
    bot.updated_at = utcnow()
    session.add(bot)
    session.commit()
    session.refresh(bot)
    return bot


def delete_bot(session: Session, bot: Bot) -> None:
    if bot.is_system:
        raise ValueError("系统 Bot 不可删除")
    bot.status = "archived"
    bot.updated_at = utcnow()
    session.add(bot)
    session.commit()


def resolve_mentions(text: str, bots: list[Bot] | None = None) -> list[str]:
    """按 @名字 / 别名 / persona 解析提及的 bot_id 列表（保序去重）。

    bots 为空时，自动并入虚拟同事（agent-catalog）以便 @灵感猎手 这类点名。
    """
    if not text:
        return []
    pool = list(bots or [])
    if not pool:
        from .agent_colleagues import list_virtual_bots

        pool = list_virtual_bots()
    else:
        # 若调用方只传了持久化 Bot，也允许点名目录里的 persona
        from .agent_colleagues import list_virtual_bots

        existing = {b.id for b in pool}
        for vb in list_virtual_bots():
            if vb.id not in existing:
                pool.append(vb)

    name_map: dict[str, str] = {}
    for b in pool:
        if b.status != "active":
            continue
        name_map[b.name.lower()] = b.id
        name_map[b.id.lower()] = b.id
        for a in b.aliases or []:
            name_map[str(a).lower()] = b.id
    found: list[str] = []
    seen: set[str] = set()
    for m in _MENTION_RE.finditer(text):
        key = m.group(1).strip().lower()
        bid = name_map.get(key)
        if bid and bid not in seen:
            seen.add(bid)
            found.append(bid)
    # 「Bot名：」出现在句首或文中（如「…，蛋博士：也来」）
    for b in pool:
        if b.status != "active":
            continue
        for label in [b.name, *(b.aliases or [])]:
            for sep in ("：", ":"):
                token = f"{label}{sep}"
                if token in text and b.id not in seen:
                    seen.add(b.id)
                    found.append(b.id)
                    break
    return found


def slash_to_skill(session: Session, text: str, *, bot_id: str | None = None) -> BotSkill | None:
    """若消息以 /slash 开头则匹配技能。"""
    stripped = text.strip()
    if not stripped.startswith("/"):
        return None
    token = stripped[1:].split()[0].strip().lower()
    if not token:
        return None
    rows = list(session.exec(select(BotSkill).where(BotSkill.slash == token)))
    if not rows:
        # 也允许按 name
        rows = list(session.exec(select(BotSkill)))
        rows = [r for r in rows if r.slash.lower() == token or r.name.lower() == token]
    if bot_id:
        prefer = [r for r in rows if r.bot_id in bot_id_aliases(bot_id)]
        if prefer:
            return prefer[0]
    shared = [r for r in rows if r.bot_id is None]
    if shared:
        return shared[0]
    return rows[0] if rows and not bot_id else None


# 与 agents 花名册重复的人设类模板：不再对外展示（文件可保留或已删除）
_HIDDEN_TEMPLATE_IDS = {
    "topic-scout",
    "topic-editor",
    "outline-lead",
    "prose-lead",
    "deai-reviewer",
    "character-designer",
    "kb-librarian",
    "gardener",
    "team-editorial",
    "team-short-drama",
}


def list_templates() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if not _TEMPLATES_DIR.exists():
        return out
    for p in sorted(_TEMPLATES_DIR.glob("*.json")):
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            continue
        tid = data.get("id") or p.stem
        if tid in _HIDDEN_TEMPLATE_IDS or p.stem in _HIDDEN_TEMPLATE_IDS:
            continue
        out.append(
            {
                "id": tid,
                "kind": data.get("kind") or "bot",
                "name": data.get("name") or p.stem,
                "description": data.get("description") or "",
                "payload": data,
            }
        )
    return out


def load_template(template_id: str) -> dict[str, Any] | None:
    for t in list_templates():
        if t["id"] == template_id:
            return t["payload"]
    return None


def import_from_template(
    session: Session,
    *,
    template_id: str | None = None,
    payload: dict[str, Any] | None = None,
    name_override: str | None = None,
    owner_user_id: str = "demo_user",
) -> Bot | BotTeam:
    data = payload or (load_template(template_id) if template_id else None)
    if not data:
        raise ValueError("模板不存在")
    kind = data.get("kind") or "bot"
    if kind == "team":
        members = []
        for m in data.get("members") or []:
            if isinstance(m, str):
                # 引用已有 bot id 或模板 id
                existing = get_bot(session, m)
                if existing:
                    from .knowledge_colleague import owns_bot
                    if not owns_bot(existing, owner_user_id) or existing.status != "active":
                        raise ValueError("模板成员不可用")
                    members.append(existing.id)
                else:
                    nested = load_template(m)
                    if nested and (nested.get("kind") or "bot") == "bot":
                        b = import_from_template(
                            session, payload=nested, owner_user_id=owner_user_id
                        )
                        assert isinstance(b, Bot)
                        members.append(b.id)
            elif isinstance(m, dict):
                b = import_from_template(session, payload={**m, "kind": "bot"}, owner_user_id=owner_user_id)
                assert isinstance(b, Bot)
                members.append(b.id)
        team = BotTeam(
            name=name_override or data.get("name") or "未命名团队",
            member_bot_ids=canonical_members(members),
            lead_bot_id=agent_id_from_bot_id(data.get("lead_bot_id")) or (members[0] if members else None),
            rules_md=data.get("rules_md") or "",
            truth_source_path=data.get("truth_source_path"),
            speak_policy=data.get("speak_policy") or "orchestrated",
            max_rounds=int(data.get("max_rounds") or 6),
            owner_user_id=owner_user_id,
            template_id=data.get("id"),
        )
        session.add(team)
        session.commit()
        session.refresh(team)
        return team

    # bot
    cfg = data.get("bot") or data
    create_data = {
        "name": name_override or cfg.get("name") or "未命名同事",
        "aliases": list(cfg.get("aliases") or []),
        "avatar": dict(cfg.get("avatar") or _default_avatar("🤖")),
        "persona": cfg.get("persona") or "",
        "tone": cfg.get("tone") or "",
        "duties": list(cfg.get("duties") or []),
        "never_do": list(cfg.get("never_do") or []),
        "role_kind": cfg.get("role_kind") or "specialist",
        "delegate_only": bool(cfg.get("delegate_only") or False),
        "allowed_agent_ids": list(cfg.get("allowed_agent_ids") or []),
        "tool_allowlist": list(cfg.get("tool_allowlist") or []),
        "model_profile": cfg.get("model_profile") or "default",
        "trust_level": int(cfg.get("trust_level") or 1),
        "veto_window_min": int(cfg.get("veto_window_min") or 60),
        "restate_before_act": bool(cfg.get("restate_before_act") or False),
        "notify_policy": cfg.get("notify_policy") if cfg.get("notify_policy") in {"all", "important", "none"} else "important",
        "weekly_token_budget": cfg.get("weekly_token_budget"),
        "pinned": bool(cfg.get("pinned") or False),
        "template_id": data.get("id") or cfg.get("id"),
        "is_system": False,
    }
    # 系统模板里固定 id 的（如 eggbot）若已存在则直接返回
    fixed_id = cfg.get("id")
    if fixed_id and cfg.get("is_system"):
        if fixed_id not in (CHIEF_BOT_ID, EGG_BOT_ID):
            raise ValueError("不可自定义系统同事身份")
        existing = get_bot(session, fixed_id)
        if existing:
            return existing
        seed_system_bots(session)
        return get_bot(session, fixed_id)
    bot = create_bot(session, create_data, owner_user_id=owner_user_id)
    for sk in data.get("skills") or cfg.get("skills") or []:
        session.add(
            BotSkill(
                bot_id=bot.id,
                name=sk.get("name") or "未命名技能",
                slash=(sk.get("slash") or sk.get("name") or "skill").lower().replace(" ", "-"),
                when_to_use=sk.get("when_to_use") or "",
                inputs=list(sk.get("inputs") or []),
                steps_md=sk.get("steps_md") or "",
                evidence_required=bool(sk.get("evidence_required")),
                confirm_when=sk.get("confirm_when") or "",
                trust_stage=sk.get("trust_stage") or "saved",
            )
        )
    for rt in data.get("routines") or cfg.get("routines") or []:
        rid = rt.get("id") or f"bot.{bot.id}.{new_id()[:8]}"
        if session.get(ScheduledTask, rid):
            continue
        session.add(
            ScheduledTask(
                id=rid,
                name=rt.get("name") or f"{bot.name}例程",
                cron_or_interval=rt.get("cron_or_interval") or "1h",
                enabled=bool(rt.get("enabled", False)),
                owner_scope="bot",
                description=rt.get("description"),
                payload_template={"type": "bot.routine", "bot_id": bot.id},
                bot_id=bot.id,
                prompt=rt.get("prompt") or "",
                trigger_type=rt.get("trigger_type") or "schedule",
                event_filter=dict(rt.get("event_filter") or {}),
                quiet_policy=rt.get("quiet_policy") or "silent_if_nothing",
                active_window=rt.get("active_window"),
            )
        )
    for path, content in (data.get("memory_seeds") or {}).items():
        full = path if path.startswith("/") else f"/memories/bots/{bot.id}/{path}"
        try:
            cas_write_memory(
                session,
                path=full,
                content=str(content),
                expected_hash=None,
                actor=f"bot:{bot.id}",
                allow_create=True,
            )
        except Exception:  # noqa: BLE001
            pass
    session.commit()
    session.refresh(bot)
    return bot


def export_bot(session: Session, bot: Bot) -> dict[str, Any]:
    skills = list(session.exec(select(BotSkill).where(BotSkill.bot_id.in_(bot_id_aliases(bot.id)))))
    routines = list(session.exec(select(ScheduledTask).where(ScheduledTask.bot_id.in_(bot_id_aliases(bot.id)))))
    return {
        "id": bot.template_id or bot.id,
        "kind": "bot",
        "name": bot.name,
        "description": bot.persona[:200] if bot.persona else "",
        "bot": {
            "name": bot.name,
            "aliases": bot.aliases,
            "avatar": bot.avatar,
            "persona": bot.persona,
            "tone": bot.tone,
            "duties": bot.duties,
            "never_do": bot.never_do,
            "role_kind": bot.role_kind,
            "delegate_only": bot.delegate_only,
            "allowed_agent_ids": bot.allowed_agent_ids,
            "tool_allowlist": bot.tool_allowlist,
            "model_profile": bot.model_profile,
            "trust_level": bot.trust_level,
            "veto_window_min": bot.veto_window_min,
            "restate_before_act": bot.restate_before_act,
            "notify_policy": getattr(bot, "notify_policy", "important"),
            "weekly_token_budget": bot.weekly_token_budget,
        },
        "skills": [
            {
                "name": s.name,
                "slash": s.slash,
                "when_to_use": s.when_to_use,
                "inputs": s.inputs,
                "steps_md": s.steps_md,
                "evidence_required": s.evidence_required,
                "confirm_when": s.confirm_when,
                "trust_stage": s.trust_stage,
            }
            for s in skills
        ],
        "routines": [
            {
                "id": r.id,
                "name": r.name,
                "cron_or_interval": r.cron_or_interval,
                "enabled": r.enabled,
                "description": r.description,
                "prompt": r.prompt,
                "trigger_type": r.trigger_type,
                "event_filter": r.event_filter,
                "quiet_policy": r.quiet_policy,
                "active_window": r.active_window,
            }
            for r in routines
        ],
    }


def interview_to_draft(answers: dict[str, Any], free_text: str | None = None) -> dict[str, Any]:
    """入职访谈答案 → Bot 配置草案。"""
    role = str(answers.get("role") or answers.get("job") or "写作助手")
    duties = answers.get("duties") or []
    if isinstance(duties, str):
        duties = [d.strip() for d in duties.split("、") if d.strip()]
    never = answers.get("never_do") or answers.get("never") or []
    if isinstance(never, str):
        never = [d.strip() for d in never.split("、") if d.strip()]
    name = str(answers.get("name") or _fun_name(role))
    return {
        "name": name,
        "aliases": list(answers.get("aliases") or []),
        "avatar": answers.get("avatar") or _default_avatar("✨"),
        "persona": str(answers.get("persona") or free_text or f"你是专门负责{role}的同事。"),
        "tone": str(answers.get("tone") or "专业、友好"),
        "duties": duties or [f"负责{role}"],
        "never_do": never or ["不替主人公开发布", "不可逆操作前先请示"],
        "role_kind": str(answers.get("role_kind") or "specialist"),
        "delegate_only": bool(answers.get("delegate_only") or False),
        "allowed_agent_ids": list(answers.get("allowed_agent_ids") or []),
        "tool_allowlist": list(answers.get("tool_allowlist") or []),
        "trust_level": int(answers.get("trust_level") or 1),
        "restate_before_act": bool(answers.get("restate_before_act") or True),
    }


_FUN_NAMES = ["大福", "抹茶", "饺子", "汤圆", "豆沙", "芋圆", "布丁", "年糕", "米糕", "芝麻"]


def _fun_name(role: str) -> str:
    import hashlib

    idx = int(hashlib.md5(role.encode()).hexdigest(), 16) % len(_FUN_NAMES)
    return _FUN_NAMES[idx]
