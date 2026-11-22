"""打扰判断：立即 / 攒进摘要 / 静默。"""

from __future__ import annotations

from typing import Any, Literal

from sqlmodel import Session, select

from .models import MemoryFile

DisturbDecision = Literal["immediate", "digest", "silent"]


def _reported_paths(session: Session, bot_id: str | None = None) -> set[str]:
    """读取 reported.md 中已汇报条目的简单指纹集合。"""
    paths = ["/memories/user/reported.md"]
    if bot_id:
        from .agent_colleagues import bot_id_aliases
        paths.extend(f"/memories/bots/{identity}/reported.md" for identity in bot_id_aliases(bot_id))
    keys: set[str] = set()
    for p in paths:
        row = session.exec(select(MemoryFile).where(MemoryFile.path == p)).first()
        if not row or not row.content:
            continue
        for line in row.content.splitlines():
            line = line.strip()
            if line.startswith("- ") or line.startswith("* "):
                keys.add(line[2:].strip()[:120])
            elif line:
                keys.add(line[:120])
    return keys


def mark_reported(session: Session, fingerprint: str, *, bot_id: str | None = None) -> None:
    """追加一条已汇报指纹（简易追加，不做 CAS）。"""
    from .memory_service import cas_write_memory, ensure_store

    from .agent_colleagues import agent_id_from_bot_id
    bot_id = agent_id_from_bot_id(bot_id)
    path = f"/memories/bots/{bot_id}/reported.md" if bot_id else "/memories/user/reported.md"
    if bot_id:
        ensure_store(
            session,
            f"bot.{bot_id}.profile",
            name=f"Bot {bot_id}",
            kind="agent",
            scope_ref=bot_id,
            shared=False,
        )
    existing = session.exec(select(MemoryFile).where(MemoryFile.path == path)).first()
    prev = (existing.content if existing else "") or ""
    if fingerprint[:120] in prev:
        return
    new_content = (prev.rstrip() + "\n" if prev.strip() else "") + f"- {fingerprint[:200]}\n"
    try:
        cas_write_memory(
            session,
            path=path,
            content=new_content,
            expected_hash=existing.hash if existing else None,
            actor=f"bot:{bot_id}" if bot_id else "system",
            allow_create=True,
        )
    except Exception:  # noqa: BLE001
        pass


def decide_disturb(
    *,
    session: Session | None = None,
    quiet_policy: str = "silent_if_nothing",
    needs_decision: bool = False,
    failed: bool = False,
    completed: bool = False,
    has_change: bool = False,
    fingerprint: str | None = None,
    bot_id: str | None = None,
) -> DisturbDecision:
    """按事件性质与 quiet_policy 决定是否打扰用户。

    - needs_decision / failed → immediate
    - completed + has_change → 按 quiet_policy
    - 无变化 → silent（没进展就不说话）
    - fingerprint 已在 reported → silent
    """
    if needs_decision or failed:
        return "immediate"

    if fingerprint and session is not None:
        reported = _reported_paths(session, bot_id=bot_id)
        if fingerprint[:120] in reported:
            return "silent"

    if not has_change and not completed:
        return "silent"

    if quiet_policy == "immediate":
        return "immediate"
    if quiet_policy == "digest":
        return "digest" if (completed or has_change) else "silent"
    # silent_if_nothing（默认）
    if completed and has_change:
        return "immediate"
    if completed and not has_change:
        return "silent"
    if has_change:
        return "digest"
    return "silent"


def build_catch_up_summary(
    *,
    since_text: str,
    events: list[dict[str, Any]],
    action_items: list[dict[str, Any]] | None = None,
) -> str:
    """生成「自上条消息以来」执行摘要。"""
    lines = [f"## 进度摘要（自上条消息以来）", f"参考：{since_text[:80] or '—'}", ""]
    if not events:
        lines.append("暂无新进展。")
    else:
        lines.append("### 发生了什么")
        for ev in events[:12]:
            title = ev.get("title") or ev.get("kind") or "event"
            detail = ev.get("detail") or ""
            lines.append(f"- **{title}**：{detail[:160]}")
    items = action_items or []
    if items:
        lines.append("")
        lines.append("### 需要你拍板")
        for it in items[:8]:
            ctx = it.get("context") or it.get("summary") or ""
            lines.append(f"- {it.get('title') or '决策'}：{ctx[:200]}")
    else:
        lines.append("")
        lines.append("无需你拍板的事项。")
    return "\n".join(lines)
