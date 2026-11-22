"""自管理记忆核心：Store 解析、content-hash CAS、归属快照、Hybrid 检索、Dreaming 合入。"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Optional

from fastapi import HTTPException
from sqlmodel import Session, select

from .agent_colleagues import agent_id_from_bot_id, bot_id_aliases

from .models import (
    AgentRun,
    Conversation,
    DreamChange,
    DreamJob,
    MemoryFile,
    MemoryMount,
    MemoryStore,
    MemoryVersion,
    new_id,
    utcnow,
)
from .seed import DEMO_USER


class MemoryConflictError(Exception):
    """乐观并发冲突：expected_hash 与当前内容不一致。"""

    def __init__(self, path: str, current: MemoryFile | None, message: str = "memory conflict"):
        super().__init__(message)
        self.path = path
        self.current = current

    def as_detail(self) -> dict[str, Any]:
        row = self.current
        return {
            "error": "memory_conflict",
            "path": self.path,
            "message": str(self),
            "current_hash": row.hash if row else None,
            "current_content": (row.content if row else "")[:8000] if row else "",
            "actor": row.actor if row else None,
            "updated_at": row.updated_at.isoformat() if row and row.updated_at else None,
            "frozen": bool(row.frozen) if row else False,
        }


class MemoryFrozenError(Exception):
    def __init__(self, path: str):
        super().__init__(f"file is frozen: {path}")
        self.path = path


def memory_hash(content: str) -> str:
    return hashlib.sha256((content or "").encode("utf-8")).hexdigest()


def infer_memory_kind(path: str) -> str:
    p = (path or "").lower()
    if "/scratch" in p or p.endswith("scratchpad.json"):
        return "scratch"
    if "/episodes/" in p:
        return "episodic"
    if "/semantic/" in p:
        return "semantic"
    if "/procedural/" in p:
        return "procedural"
    if "/reflections/" in p:
        return "reflection"
    if "/journal/" in p:
        return "journal"
    if any(
        x in p
        for x in (
            "decisions.md",
            "characters.md",
            "world.md",
            "bible",
            "story_graph",
            "foreshadow",
        )
    ):
        return "bible"
    if "hypothesis:" in p:
        return "semantic"
    return "other"


def resolve_store_id(path: str, *, project_id: str | None = None) -> str:
    """从虚拟路径解析 MemoryStore id（兼容现有 /memories/... 布局）。"""
    parts = (path or "").strip("/").split("/")
    # /memories/user/...
    if len(parts) >= 2 and parts[0] == "memories" and parts[1] == "user":
        return "user.profile"
    # /memories/archive/...
    if len(parts) >= 2 and parts[0] == "memories" and parts[1] == "archive":
        return "user.archive"
    # /memories/reported.md / skills-distilled
    if len(parts) >= 2 and parts[0] == "memories" and parts[1] in {
        "reported.md",
        "skills-distilled",
    }:
        return "user.profile"
    # /memories/projects/{pid}/fleet/{fid}/{member}/...
    if (
        len(parts) >= 6
        and parts[0] == "memories"
        and parts[1] == "projects"
        and parts[3] == "fleet"
    ):
        return f"fleet.{parts[4]}.{parts[5]}"
    # /memories/projects/{pid}/...
    if len(parts) >= 3 and parts[0] == "memories" and parts[1] == "projects":
        pid = parts[2]
        rest = "/".join(parts[3:]) if len(parts) > 3 else ""
        if rest.startswith("journal/") or rest.startswith("episodes/"):
            return f"project.{pid}.journal"
        if rest.startswith("procedural/") or rest.startswith("reflections/"):
            # agent lessons 落在项目下但按 agent 文件拆分
            m = re.match(r"procedural/([^/]+)", rest)
            if m:
                return f"agent.{m.group(1)}.lessons"
            return f"project.{pid}.bible"
        if rest.startswith("semantic/"):
            return f"project.{pid}.bible"
        return f"project.{pid}.bible"
    # /memories/org/...
    if len(parts) >= 2 and parts[0] == "memories" and parts[1] == "org":
        return "org.methodology"
    # /memories/bots/{bot_id}/...
    if len(parts) >= 3 and parts[0] == "memories" and parts[1] == "bots":
        return f"bot.{parts[2]}.profile"
    if project_id:
        return f"project.{project_id}.bible"
    return "user.profile"


def ensure_store(
    session: Session,
    store_id: str,
    *,
    name: str | None = None,
    kind: str | None = None,
    scope_ref: str | None = None,
    description: str = "",
    shared: bool = True,
    commit: bool = True,
) -> MemoryStore:
    if store_id.startswith("bot.") and store_id.endswith(".profile"):
        kind = "agent"
        scope_ref = store_id[4:-8]
        shared = False
    row = session.get(MemoryStore, store_id)
    if row:
        return row
    if not kind:
        kind = store_id.split(".", 1)[0] if "." in store_id else "project"
    if scope_ref is None:
        bits = store_id.split(".")
        if kind == "project" and len(bits) >= 2:
            scope_ref = bits[1]
        elif kind == "agent" and len(bits) >= 2:
            scope_ref = bits[1]
        elif kind == "session" and len(bits) >= 2:
            scope_ref = bits[1]
        elif kind == "fleet" and len(bits) >= 3:
            scope_ref = f"{bits[1]}.{bits[2]}"
    if not name:
        name = {
            "org.methodology": "组织方法论（只读）",
            "user.profile": "用户画像与偏好",
            "user.archive": "冷归档",
        }.get(store_id, store_id)
        if store_id.startswith("project.") and store_id.endswith(".bible"):
            name = "项目圣经（共享）"
        elif store_id.startswith("project.") and store_id.endswith(".journal"):
            name = "项目 journal / 情景"
        elif store_id.startswith("agent."):
            name = f"Agent 独立经验：{scope_ref or ''}"
            shared = False
        elif store_id.startswith("fleet."):
            name = f"Fleet 工作区：{scope_ref or ''}"
            shared = False
        elif store_id.startswith("session."):
            name = "会话 Scratchpad"
            shared = False
    row = MemoryStore(
        id=store_id,
        name=name,
        kind=kind or "project",
        scope_ref=scope_ref,
        description=description,
        shared=shared,
        status="active",
    )
    session.add(row)
    if commit:
        session.commit()
        session.refresh(row)
    else:
        session.flush()
    return row


def ensure_default_stores(session: Session, *, project_id: str | None = None) -> list[MemoryStore]:
    ids = ["org.methodology", "user.profile", "user.archive"]
    if project_id:
        ids.extend([f"project.{project_id}.bible", f"project.{project_id}.journal"])
    out = []
    for sid in ids:
        shared = not sid.startswith("agent.") and not sid.startswith("session.")
        out.append(ensure_store(session, sid, shared=shared))
    return out


def _private_store_ids(store_id: str) -> tuple[str | None, tuple[str, ...]]:
    for prefix, suffix in (("bot.", ".profile"), ("agent.", ".lessons")):
        if store_id.startswith(prefix) and store_id.endswith(suffix):
            aliases = bot_id_aliases(store_id[len(prefix):-len(suffix)])
            return aliases[0], tuple(prefix + identity + suffix for identity in aliases)
    return None, (store_id,)


def resolve_mount_store(session: Session, store_id: str, agent_id: str | None,
                        conversation_id: str | None, run_id: str | None,
                        project_id: str | None = None) -> str:
    owner, ids = _private_store_ids(store_id)
    if owner is None:
        return store_id
    if not owner or agent_id_from_bot_id(agent_id) != owner:
        raise HTTPException(403, "私有记忆只能挂载给所属同事")
    conv = session.get(Conversation, conversation_id) if conversation_id else None
    if conversation_id and (not conv or agent_id_from_bot_id(conv.bot_id) != owner
                            or (project_id and conv.project_id != project_id)):
        raise HTTPException(403, "该会话不能挂载此私有记忆")
    if run_id:
        run = session.get(AgentRun, run_id)
        if (not run or agent_id_from_bot_id(run.agent_id) != owner
                or (project_id and run.project_id != project_id)
                or (conv and (run.project_id != conv.project_id or
                              run.conversation_id not in (None, conversation_id)))):
            raise HTTPException(403, "该运行不能挂载此私有记忆")
    return next((sid for sid in ids if session.get(MemoryStore, sid)), ids[0])


def default_mounts_for_project(
    session: Session,
    *,
    project_id: str,
    conversation_id: str | None = None,
    run_id: str | None = None,
    agent_id: str | None = None,
) -> list[MemoryMount]:
    """为一次 run/会话挂载：org RO + user RO + project bible/journal RW + agent lessons RW。"""
    agent_id = agent_id_from_bot_id(agent_id)
    sid = (resolve_mount_store(session, f"agent.{agent_id}.lessons", agent_id,
                               conversation_id, run_id, project_id) if agent_id else None)
    ensure_default_stores(session, project_id=project_id)
    specs = [
        ("org.methodology", "read_only", "组织方法论与红线，只读，禁止改写", 100),
        ("user.profile", "read_only", "用户口味与禁忌（跨项目）", 90),
        (f"project.{project_id}.bible", "read_write", "项目共享圣经：决策/人设/世界/伏笔", 80),
        (f"project.{project_id}.journal", "read_write", "章节摘要与情景记忆", 70),
    ]
    if sid:
        ensure_store(session, sid, kind="agent", scope_ref=agent_id, shared=False)
        specs.append((sid, "read_write", f"仅 {agent_id} 的独立经验与手法", 60))
    mounts: list[MemoryMount] = []
    for store_id, access, hint, prio in specs:
        m = MemoryMount(
            store_id=store_id,
            conversation_id=conversation_id,
            run_id=run_id,
            agent_id=agent_id,
            access=access,
            prompt_hint=hint,
            priority=prio,
        )
        session.add(m)
        mounts.append(m)
    session.commit()
    for m in mounts:
        session.refresh(m)
    return mounts


@dataclass
class CasWriteResult:
    row: MemoryFile
    version_id: str | None
    created: bool
    conflict: bool = False


def is_context_snapshot(path: str) -> bool:
    return path.rstrip("/") == "/memories/context_refs" or path.startswith("/memories/context_refs/")


def cas_write_memory(
    session: Session,
    *,
    path: str,
    content: str,
    project_id: str | None = None,
    expected_hash: str | None = None,
    check_cas: bool = False,
    actor: str = "user",
    source_run_id: str | None = None,
    source_conversation_id: str | None = None,
    is_hypothesis: bool | None = None,
    note: str | None = None,
    change_summary: str | None = None,
    allow_create: bool = True,
    allow_context_snapshot: bool = False,
    commit: bool = True,
) -> CasWriteResult:
    """带 content-hash 乐观并发的统一写入。

    - check_cas=False：兼容旧调用（UI/测试可不传 expected_hash）
    - check_cas=True：必须匹配 expected_hash；新建时 expected_hash 应为 None 或 ""
    """
    if is_context_snapshot(path) and not allow_context_snapshot:
        raise ValueError("引用快照仅可由选区引用服务写入")
    if not path.startswith("/memories"):
        raise ValueError("path must be under /memories")

    row = session.get(MemoryFile, path)
    if row and row.frozen:
        raise MemoryFrozenError(path)

    precondition = row.hash if row else None

    if check_cas:
        if row is None:
            if expected_hash not in (None, "", "*"):
                raise MemoryConflictError(path, None, "文件不存在，但 expected_hash 非空")
        else:
            if expected_hash == "*":
                pass
            elif (expected_hash or "") != (row.hash or ""):
                raise MemoryConflictError(
                    path,
                    row,
                    f"乐观并发冲突：expected={expected_hash} current={row.hash}",
                )

    if row is None and not allow_create:
        raise MemoryConflictError(path, None, "文件不存在且不允许创建")

    store_id = resolve_store_id(path, project_id=project_id)
    ensure_store(session, store_id, commit=commit)
    proj = project_id
    if not proj:
        m = re.match(r"^/memories/projects/([^/]+)/", path)
        if m:
            proj = m.group(1)

    version_id: str | None = None
    created = row is None
    if row and (row.content or "") != (content or ""):
        ver = MemoryVersion(
            id=new_id(),
            path=path,
            store_id=row.store_id or store_id,
            content=row.content or "",
            hash=row.hash,
            precondition_hash=precondition,
            note=note,
            change_summary=change_summary or "写前快照",
            actor=actor,
            source_run_id=source_run_id or row.source_run_id,
            source_conversation_id=source_conversation_id or row.source_conversation_id,
        )
        session.add(ver)
        version_id = ver.id

    if not row:
        row = MemoryFile(path=path, user_id=DEMO_USER)

    row.content = content or ""
    row.hash = memory_hash(row.content)
    row.project_id = proj
    row.store_id = store_id
    row.actor = actor
    row.source_run_id = source_run_id or row.source_run_id
    row.source_conversation_id = source_conversation_id or row.source_conversation_id
    row.memory_kind = infer_memory_kind(path)
    if is_hypothesis is None:
        row.is_hypothesis = "hypothesis:" in path or "/semantic/" in path and "待验证" in (content or "")
    else:
        row.is_hypothesis = bool(is_hypothesis)
    row.updated_at = utcnow()
    session.add(row)
    if commit:
        session.commit()
        session.refresh(row)
    else:
        session.flush()
    return CasWriteResult(row=row, version_id=version_id, created=created)


_CJK_RE = re.compile(r"[\u4e00-\u9fff]")


def _cjk_bigrams(terms: list[str]) -> list[str]:
    """长度≥3 的含中文词 → 去重的字符二元组（'主角性格' → 主角/角性/性格）。"""
    out: list[str] = []
    for t in terms:
        if len(t) < 3 or not _CJK_RE.search(t):
            continue
        for i in range(len(t) - 1):
            g = t[i : i + 2]
            if g not in out:
                out.append(g)
    return out


def scoped_memory_files(session: Session, store_id: str | None, project_id: str | None) -> list[MemoryFile]:
    query = select(MemoryFile).where(MemoryFile.user_id == DEMO_USER)
    owner = None
    if store_id:
        owner, store_ids = _private_store_ids(store_id)
        query = query.where(MemoryFile.store_id.in_(store_ids))
    rows = [r for r in session.exec(query) if not is_context_snapshot(r.path)]
    if store_id:
        if owner:
            files = {}
            for row in rows:
                parts = row.path.split("/")
                if parts[1:3] == ["memories", "bots"] and len(parts) > 3:
                    index = 3
                    if project_id and parts[4:5] == ["projects"] and parts[5:6] != [project_id]:
                        continue
                elif parts[1:3] == ["memories", "projects"] and len(parts) > 5 and parts[4] == "procedural":
                    index = 5
                    if project_id and parts[3] != project_id:
                        continue
                else:
                    continue
                if resolve_store_id(row.path) not in store_ids or agent_id_from_bot_id(parts[index]) != owner:
                    continue
                if row.user_id != DEMO_USER or (project_id and row.project_id not in (None, project_id)):
                    continue
                canonical_path = parts[index] == owner
                parts[index] = owner
                key = tuple(parts)
                if canonical_path or key not in files:
                    files[key] = row
            rows = list(files.values())
    if project_id:
        prefix = f"/memories/projects/{project_id}/"
        rows = [
            r
            for r in rows
            if r.project_id == project_id
            or (r.path or "").startswith(prefix)
            or (r.path or "").startswith("/memories/user/")
        ]
    return rows


def hybrid_search_memory(
    session: Session,
    q: str,
    *,
    store_id: str | None = None,
    project_id: str | None = None,
    limit: int = 40,
) -> list[MemoryFile]:
    """本地轻量 Hybrid：关键词子串 + 路径加权；可按 store/project 过滤。"""
    rows = scoped_memory_files(session, store_id, project_id)
    ql = (q or "").strip().lower()
    if not ql:
        rows.sort(key=lambda r: r.updated_at or utcnow(), reverse=True)
        return rows[:limit]

    terms = [t for t in re.split(r"\s+", ql) if t]
    fuzzy = _cjk_bigrams(terms)
    scored: list[tuple[float, MemoryFile]] = []
    for r in rows:
        score = 0.0
        low_path = (r.path or "").lower()
        low_body = (r.content or "").lower()
        for t in terms:
            if t in low_path:
                score += 5
            if t in low_body:
                score += 2 + min(3, low_body.count(t) * 0.2)
        # 中文无空格：整词没命中时用字符二元组做模糊召回（权重远低于整词命中）
        if fuzzy:
            hit = sum(1 for g in fuzzy if g in low_body or g in low_path)
            score += 1.5 * (hit / len(fuzzy))
        if score <= 0:
            continue
        # 热路径加权：bible / decisions
        kind = r.memory_kind or infer_memory_kind(r.path)
        if kind == "bible":
            score += 1.5
        if r.frozen:
            score += 0.5
        scored.append((score, r))
    scored.sort(key=lambda x: (-x[0], x[1].updated_at or utcnow()), reverse=False)
    scored.sort(key=lambda x: -x[0])
    return [r for _, r in scored[:limit]]


def build_dream_changes_from_scan(
    session: Session,
    *,
    store_id: str,
    project_id: str | None,
    window_hours: int = 168,
) -> tuple[list[dict[str, Any]], str]:
    """启发式 Dreaming 扫描（不依赖 LLM）：去重建议、验证回填、索引、过期 journal 提示。

    返回 (changes, report_markdown)。真实 LLM 巩固可由 mem.dreams agent 补充到同一 DreamJob。
    """
    scoped = [r for r in scoped_memory_files(session, store_id, project_id)
              if resolve_store_id(r.path) == store_id and (not project_id or r.project_id in (None, project_id))]
    if store_id == f"project.{project_id}.journal":
        # Journal remains in its original store. Episode summaries are reviewed there.
        scoped = [r for r in scoped if "/journal/" in r.path]
    elif store_id not in {f"project.{project_id}.bible", "user.profile"}:
        return [], "此库没有可巩固的条目。"
    if store_id == "user.profile":
        project_id = None

    changes: list[dict[str, Any]] = []
    report_lines = [
        "## Dreams 巩固报告（启发式）",
        f"- store: `{store_id}`",
        f"- 扫描文件：{len(scoped)}",
        f"- 窗口：{window_hours}h",
        "",
    ]

    # 1) INDEX.md 策展
    index_path = (
        f"/memories/projects/{project_id}/INDEX.md"
        if project_id
        else "/memories/user/index.md"
    )
    index_lines = ["# Memory Index", "", "由 Dreaming 生成，供下游 agent 优先阅读。", ""]
    by_kind: dict[str, list[MemoryFile]] = {}
    for r in scoped:
        k = r.memory_kind or infer_memory_kind(r.path)
        by_kind.setdefault(k, []).append(r)
    for kind, files in sorted(by_kind.items()):
        index_lines.append(f"## {kind} ({len(files)})")
        for f in sorted(files, key=lambda x: x.path)[:40]:
            leaf = f.path.rsplit("/", 1)[-1]
            index_lines.append(f"- `{leaf}` — {f.path}")
        index_lines.append("")
    after_index = "\n".join(index_lines)
    before = session.get(MemoryFile, index_path)
    if not before or (before.content or "") != after_index:
        changes.append(
            {
                "path": index_path,
                "op": "update" if before else "create",
                "before_content": before.content if before else "",
                "after_content": after_index,
                "before_hash": before.hash if before else None,
                "rationale": "策展索引：提高召回效率，避免全库 grep",
            }
        )
        report_lines.append(f"- 更新索引：`{index_path}`")

    # 2) 验证回填笔记
    verify_path = (
        f"/memories/projects/{project_id}/semantic/verification.md"
        if project_id
        else "/memories/user/semantic/verification.md"
    )
    now = utcnow().isoformat()
    verify_body = (
        f"# 验证回填\n\n"
        f"- verified_at: {now}\n"
        f"- store: {store_id}\n"
        f"- files_scanned: {len(scoped)}\n"
        f"- note: 基于近期文件状态的启发式验证；人工审查后方可视为权威。\n"
        f"- frozen_count: {sum(1 for r in scoped if r.frozen)}\n"
        f"- hypothesis_count: {sum(1 for r in scoped if r.is_hypothesis)}\n"
    )
    before_v = session.get(MemoryFile, verify_path)
    changes.append(
        {
            "path": verify_path,
            "op": "verify" if before_v else "create",
            "before_content": before_v.content if before_v else "",
            "after_content": verify_body,
            "before_hash": before_v.hash if before_v else None,
            "rationale": "验证回填：标记记忆在扫描时刻的准确性与假设条目数",
        }
    )
    report_lines.append(f"- 验证回填：`{verify_path}`")

    # 3) 重复 hypothesis 合并建议（同名碎片）
    hyp = [r for r in scoped if r.is_hypothesis or "hypothesis:" in (r.path or "")]
    if len(hyp) >= 2:
        merge_path = (
            f"/memories/projects/{project_id}/semantic/hypotheses_merged.md"
            if project_id
            else "/memories/user/semantic/hypotheses_merged.md"
        )
        body = ["# 合并后的假设（待人工确认）", ""]
        for r in hyp[:20]:
            body.append(f"## {r.path}")
            body.append((r.content or "")[:800])
            body.append("")
        after = "\n".join(body)
        before_m = session.get(MemoryFile, merge_path)
        changes.append(
            {
                "path": merge_path,
                "op": "merge" if before_m else "create",
                "before_content": before_m.content if before_m else "",
                "after_content": after,
                "before_hash": before_m.hash if before_m else None,
                "rationale": f"去重策展：将 {len(hyp)} 条假设汇总，便于人工升格为决策",
            }
        )
        report_lines.append(f"- 假设合并候选：{len(hyp)} 条 → `{merge_path}`")

    # 4) episodic stub from recent journals
    journals = [r for r in scoped if (r.memory_kind == "journal") or "/journal/" in (r.path or "")]
    if journals and project_id:
        journals.sort(key=lambda r: r.updated_at or utcnow(), reverse=True)
        top = journals[0]
        ep_path = f"/memories/projects/{project_id}/episodes/latest.md"
        ep_body = (
            f"# Episodic · latest\n\n"
            f"- source: {top.path}\n"
            f"- updated: {top.updated_at}\n"
            f"- topics: journal, handoff\n\n"
            f"## Summary\n\n{(top.content or '')[:1200]}\n"
        )
        before_e = session.get(MemoryFile, ep_path)
        changes.append(
            {
                "path": ep_path,
                "op": "update" if before_e else "create",
                "before_content": before_e.content if before_e else "",
                "after_content": ep_body,
                "before_hash": before_e.hash if before_e else None,
                "rationale": "情景记忆：从最近 journal 提取跨会话可检索摘要",
            }
        )
        report_lines.append(f"- 情景记忆：`{ep_path}` ← `{top.path}`")

    report_lines.append("")
    changes = [ch for ch in changes if resolve_store_id(ch["path"]) == store_id]
    report_lines.append(f"- 提案变更数：{len(changes)}")
    report_lines.append("- 状态：待用户 Diff 审查后 CAS 合入（不自动覆盖）")
    return changes, "\n".join(report_lines)


def _dedupe_lesson_lines(content: str) -> list[str]:
    seen: set[str] = set()
    kept: list[str] = []
    for line in (content or "").splitlines():
        t = line.strip()
        if not t or t.startswith("# "):
            continue
        key = re.sub(r"^- \[[^\]]*\]\s*", "", t)
        if key in seen:
            continue
        seen.add(key)
        kept.append(t)
    return kept


def build_lessons_consolidation(
    session: Session,
    *,
    store_id: str,
    max_chars: int = 6000,
    project_id: str | None = None,
) -> tuple[list[dict[str, Any]], str]:
    """私有 lessons Store 的巩固：每个文件去重、保留最新条目、控制体积（非破坏性提案）。"""
    rows = scoped_memory_files(session, store_id, project_id)
    agent_id = store_id.split(".", 1)[1].rsplit(".lessons", 1)[0] if store_id.startswith("agent.") else store_id
    changes: list[dict[str, Any]] = []
    report = [
        "## Dreams 巩固报告（Agent 私有经验）",
        f"- store: `{store_id}`",
        f"- 文件数：{len(rows)}",
        "",
    ]
    for r in sorted(rows, key=lambda x: x.path):
        lines = _dedupe_lesson_lines(r.content or "")
        header = f"# {agent_id} 经验（私有，仅本 Agent 读取）"
        while lines and len(header) + 1 + sum(len(x) + 1 for x in lines) > max_chars:
            lines.pop(0)
        after = f"{header}\n" + "\n".join(lines) + "\n" if lines else header + "\n"
        if after.strip() == (r.content or "").strip():
            continue
        changes.append(
            {
                "path": r.path,
                "op": "merge",
                "before_content": r.content or "",
                "after_content": after,
                "before_hash": r.hash,
                "rationale": f"经验去重与瘦身（{len((r.content or '').splitlines())}→{len(lines)} 条，≤{max_chars} 字）",
            }
        )
        report.append(f"- 瘦身：`{r.path}`")
    report.append("")
    report.append(f"- 提案变更数：{len(changes)}")
    report.append("- 状态：待审查后 CAS 合入（不自动覆盖）")
    return changes, "\n".join(report)


def apply_dream_merge(
    session: Session,
    job: DreamJob,
    *,
    actor: str | None = None,
) -> dict[str, Any]:
    """Persist explicitly accepted rows and their review state in one SQLite transaction."""
    from sqlalchemy import update
    from .dream_sources import check_dream_scope, current_change

    # Acquire the SQLite write lock before checking approval, source and target.
    session.execute(update(DreamJob).where(DreamJob.id == job.id).values(id=DreamJob.id))
    session.expire_all()
    check_dream_scope(session, job)
    if job.status not in {"ready", "partial", "merged"}:
        raise HTTPException(409, "提案当前不可合入")
    changes = list(session.exec(select(DreamChange).where(DreamChange.dream_job_id == job.id)))
    actor = actor or f"dream:{job.id}"
    for ch in changes:
        if ch.status != "accepted":
            continue
        if not current_change(session, job, ch):
            ch.status, ch.conflict_detail = "conflict", "来源或范围已改变，请重新扫描"
            continue
        row = session.get(MemoryFile, ch.path)
        content = ch.edited_content if ch.edited_content is not None else ch.after_content
        evidence = ch.provenance or {}
        try:
            # Older scans used verify/merge for both first writes and updates.
            expect_absent = ch.op == "create" or (
                ch.op in {"verify", "merge"} and ch.before_hash is None and not ch.before_content)
            if expect_absent and row:
                raise MemoryConflictError(ch.path, row, "目标文件已存在")
            if ch.op != "create" and row and row.content != ch.before_content:
                raise MemoryConflictError(ch.path, row)
            cas_write_memory(session, path=ch.path, content="" if ch.op == "delete" else content,
                             project_id=job.project_id if ch.path.startswith("/memories/projects/") else None,
                             expected_hash=ch.before_hash, check_cas=True,
                             allow_create=expect_absent,
                             actor=actor, source_conversation_id=evidence.get("conversationId"),
                             source_run_id=evidence.get("runId"), commit=False,
                             change_summary=f"dream {ch.op}: {ch.rationale[:120]}")
            if ch.op == "delete":
                session.delete(row)
            ch.status = "merged"
        except (MemoryConflictError, MemoryFrozenError) as exc:
            ch.status, ch.conflict_detail = "conflict", str(exc)
    merged = sum(ch.status == "merged" for ch in changes)
    conflicts = sum(ch.status == "conflict" for ch in changes)
    rejected = sum(ch.status == "rejected" for ch in changes)
    if conflicts or any(ch.status == "pending" for ch in changes):
        job.status = "partial" if merged or conflicts else "ready"
    else:
        job.status = "merged"
    if merged:
        job.merged_at = utcnow()
    session.add(job)
    session.commit()
    return {
        "job_id": job.id,
        "status": job.status,
        "merged": merged,
        "conflicts": conflicts,
        "rejected": rejected,
    }


_AUTHORITATIVE_KINDS = {"bible", "decision"}


def compute_confidence(
    access_count: int,
    is_hypothesis: bool,
    memory_kind: str | None,
    last_accessed_at: datetime | None,
    updated_at: datetime,
    now: datetime | None = None,
) -> float:
    """记忆条目置信度（0~1）：召回频率 + 假设惩罚 + 衰减 + 权威来源加权。单一来源。"""
    now = now or utcnow()
    anchor = last_accessed_at or updated_at
    idle_days = max(0, (now - anchor).days)
    confidence = (
        0.5
        + 0.2 * min(1.0, access_count / 5)
        - (0.3 if is_hypothesis else 0.0)
        - 0.2 * min(1.0, idle_days / 90)
        + (0.1 if memory_kind in _AUTHORITATIVE_KINDS else 0.0)
    )
    return max(0.0, min(1.0, confidence))


def touch_memory(session: Session, path: str) -> MemoryFile | None:
    """agent 显式召回记账：访问计数 +1、刷新 last_accessed_at、重算置信度。不存在返回 None。"""
    row = session.get(MemoryFile, path)
    if not row:
        return None
    row.access_count = int(row.access_count or 0) + 1
    row.last_accessed_at = utcnow()
    row.confidence = compute_confidence(
        int(row.access_count),
        bool(row.is_hypothesis),
        row.memory_kind,
        row.last_accessed_at,
        row.updated_at,
    )
    session.add(row)
    session.commit()
    return row
