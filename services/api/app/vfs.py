"""统一虚拟文件系统：/memories /projects /kb /workspace。"""

from __future__ import annotations

import fnmatch
import json
import os
import re
from pathlib import Path
from typing import Any

from sqlmodel import Session, select
from sqlalchemy import update

from .models import (
    AnalysisReport,
    Artifact,
    ArtifactVersion,
    KnowledgeDoc,
    MemoryFile,
    utcnow,
)
from .memory_service import (
    MemoryConflictError,
    MemoryFrozenError,
    cas_write_memory,
    memory_hash,
    is_context_snapshot,
)
from .seed import DEMO_USER
from . import directory_mounts

WORKSPACE_ROOT = Path(__file__).resolve().parent.parent / "data" / "workspace"


class VfsError(Exception):
    def __init__(self, message: str, *, code: str = "vfs_error"):
        super().__init__(message)
        self.code = code


def _mounted_call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except directory_mounts.MountError as exc:
        raise VfsError(str(exc), code=exc.code) from exc


def _norm(path: str) -> str:
    p = (path or "/").strip() or "/"
    if not p.startswith("/"):
        p = "/" + p
    # 折叠 //
    while "//" in p:
        p = p.replace("//", "/")
    if len(p) > 1 and p.endswith("/"):
        p = p[:-1]
    return p


def _ensure_workspace() -> Path:
    WORKSPACE_ROOT.mkdir(parents=True, exist_ok=True)
    return WORKSPACE_ROOT


def _workspace_resolve(rel: str) -> Path:
    """把 /workspace/... 解析到真实磁盘，防路径逃逸。"""
    root = _ensure_workspace().resolve()
    inner = rel[len("/workspace") :].lstrip("/") if rel.startswith("/workspace") else rel.lstrip("/")
    target = (root / inner).resolve() if inner else root
    if root != target and root not in target.parents:
        raise VfsError("路径逃逸：禁止访问 /workspace 之外", code="path_escape")
    return target


def _worker_path_allowed(path: str, project_id: str, agent_id: str, *, directory: bool = False) -> bool:
    if not project_id or not agent_id or re.search(r"[\\%]|(?:^|/)\.{1,2}(?:/|$)", path):
        return False
    project = f"/projects/{project_id}"
    memory = f"/memories/projects/{project_id}"
    if directory and path in {"/", "/projects", "/memories", "/memories/projects", "/memories/user"}:
        return True
    if path == project or path.startswith(project + "/"):
        return True
    if path == memory or path.startswith(memory + "/"):
        relative = path[len(memory):].lstrip("/")
        if relative == "procedural":
            return directory
        return not relative.startswith("procedural/") or relative == f"procedural/{agent_id}" or relative.startswith(f"procedural/{agent_id}/")
    return path == "/memories/user/preferences.md" or any(path == root or path.startswith(root + "/") for root in ["/memories/org", "/files", "/kb"])


def _worker_guard(path: str, project_id: str | None, agent_id: str | None, *, directory: bool = False) -> None:
    if project_id is None and agent_id is None:
        return  # PA / desktop callers retain the existing filesystem view.
    if not _worker_path_allowed(path, project_id, agent_id, directory=directory):
        raise VfsError("worker scope: path is outside this project/agent", code="forbidden")


def _worker_memory_ls(session: Session, path: str, project_id: str, agent_id: str) -> list[dict[str, Any]]:
    # Fetch path metadata only. Exclude other agents in SQL, before loading content.
    prefix = path + "/"
    private = f"/memories/projects/{project_id}/procedural/"
    own = private + agent_id + "/"
    paths = session.exec(select(MemoryFile.path).where(
        (MemoryFile.path == path) | MemoryFile.path.startswith(prefix),
        (~MemoryFile.path.startswith(private)) | MemoryFile.path.startswith(own),
    )).all()
    entries = {}
    for item in paths:
        if is_context_snapshot(item):
            continue
        rest = item[len(prefix):] if item != path else ""
        child = prefix + rest.split("/", 1)[0] if rest else item
        entries[child] = {"name": Path(child).name, "type": "dir" if "/" in rest else "file", "path": child}
    return sorted(entries.values(), key=lambda e: (e["type"] != "dir", e["name"]))


def ls(session: Session, path: str = "/", *, project_id: str | None = None, agent_id: str | None = None) -> list[dict[str, Any]]:
    path = _norm(path)
    if is_context_snapshot(path):
        raise VfsError("引用快照不能通过文件工具访问", code="not_found")
    entries: list[dict[str, Any]] = []
    _worker_guard(path, project_id, agent_id, directory=True)
    if project_id is not None:
        roots = {
            "/": [f"/projects/{project_id}", "/memories/org", "/memories/user/preferences.md", "/kb", "/files"],
            "/projects": [f"/projects/{project_id}"],
            "/memories": [f"/memories/projects/{project_id}", "/memories/org", "/memories/user/preferences.md"],
            "/memories/projects": [f"/memories/projects/{project_id}"],
            "/memories/user": ["/memories/user/preferences.md"],
        }
        if path in roots:
            return [{"name": Path(p).name, "type": "file" if p.endswith(".md") else "dir", "path": p} for p in roots[path]]
        if path.startswith("/memories/"):
            return _worker_memory_ls(session, path, project_id, agent_id)

    if path == "/":
        return ([{"name": "files", "type": "dir", "path": "/files"}]
                if directory_mounts.list_mounts(session) else []) + [
            {"name": "memories", "type": "dir", "path": "/memories"},
            {"name": "projects", "type": "dir", "path": "/projects"},
            {"name": "kb", "type": "dir", "path": "/kb"},
            {"name": "workspace", "type": "dir", "path": "/workspace"},
            {"name": "runs", "type": "dir", "path": "/runs"},
            {"name": "threads", "type": "dir", "path": "/threads"},
            {"name": "inbox", "type": "dir", "path": "/inbox"},
        ]

    if path == "/files" or path.startswith("/files/"):
        return _mounted_call(directory_mounts.ls, session, path)

    # /runs — 链式召回：run 摘要 + 产物指针
    if path == "/runs":
        from .models import AgentRun

        runs = list(session.exec(select(AgentRun).order_by(AgentRun.created_at.desc()).limit(40)))
        return [
            {
                "name": f"{r.agent_id}_{r.id[:8]}.md",
                "type": "file",
                "path": f"/runs/{r.id}",
                "runId": r.id,
                "status": r.status,
            }
            for r in runs
        ]

    m = re.match(r"^/runs/([^/]+)$", path)
    if m:
        return []  # file, see read()

    # /threads
    if path == "/threads":
        from .models import ThreadSubscription

        subs = list(
            session.exec(
                select(ThreadSubscription)
                .where(ThreadSubscription.status == "active")
                .order_by(ThreadSubscription.created_at.desc())
                .limit(40)
            )
        )
        seen: set[str] = set()
        out = []
        for s in subs:
            if s.thread_key in seen:
                continue
            seen.add(s.thread_key)
            safe = re.sub(r"[^\w\-.:]+", "_", s.thread_key)[:60]
            out.append(
                {
                    "name": f"{safe}.md",
                    "type": "file",
                    "path": f"/threads/{s.thread_key}",
                    "threadKey": s.thread_key,
                }
            )
        return out

    m = re.match(r"^/threads/(.+)$", path)
    if m:
        return []

    # /inbox — 最近事件
    if path == "/inbox":
        from .models import AgentEvent

        events = list(
            session.exec(select(AgentEvent).order_by(AgentEvent.created_at.desc()).limit(50))
        )
        return [
            {
                "name": f"{e.source}_{e.id[:8]}.md",
                "type": "file",
                "path": f"/inbox/{e.id}",
                "status": e.status,
            }
            for e in events
        ]

    m = re.match(r"^/inbox/([^/]+)$", path)
    if m:
        return []

    if path == "/memories" or path.startswith("/memories/"):
        prefix = path if path.endswith("/") or path == "/memories" else path + "/"
        if path == "/memories":
            prefix = "/memories/"
        rows = list(session.exec(select(MemoryFile).where(MemoryFile.path.startswith(prefix))).all())
        # 也包含恰好等于 path 的文件
        exact = session.get(MemoryFile, path)
        seen: set[str] = set()
        if exact:
            entries.append({"name": Path(path).name, "type": "file", "path": path})
            seen.add(path)
        for row in rows:
            if is_context_snapshot(row.path):
                continue
            rest = row.path[len(prefix) :] if row.path.startswith(prefix) else ""
            if not rest:
                continue
            name = rest.split("/", 1)[0]
            child = f"{prefix.rstrip('/')}/{name}"
            if child in seen:
                continue
            seen.add(child)
            is_dir = "/" in rest
            entries.append({"name": name, "type": "dir" if is_dir else "file", "path": child})
        return sorted(entries, key=lambda e: (e["type"] != "dir", e["name"]))

    if path == "/projects":
        from .models import Project

        projects = list(session.exec(select(Project)).all())
        return [{"name": p.id, "type": "dir", "path": f"/projects/{p.id}", "title": p.title} for p in projects]

    m = re.match(r"^/projects/([^/]+)$", path)
    if m:
        return [
            {"name": "artifacts", "type": "dir", "path": f"{path}/artifacts"},
            {"name": "memories", "type": "dir", "path": f"/memories/projects/{m.group(1)}"},
        ]

    m = re.match(r"^/projects/([^/]+)/artifacts$", path)
    if m:
        arts = list(session.exec(select(Artifact).where(Artifact.project_id == m.group(1))).all())
        types = sorted({a.type for a in arts})
        return [{"name": t, "type": "dir", "path": f"{path}/{t}"} for t in types]

    m = re.match(r"^/projects/([^/]+)/artifacts/([^/]+)$", path)
    if m:
        arts = list(
            session.exec(
                select(Artifact).where(Artifact.project_id == m.group(1), Artifact.type == m.group(2))
            ).all()
        )
        out = []
        for a in arts:
            safe = re.sub(r"[^\w\u4e00-\u9fff\-]+", "_", a.title)[:40] or a.id[:8]
            out.append(
                {
                    "name": f"{safe}.md",
                    "type": "file",
                    "path": f"{path}/{safe}.md",
                    "artifactId": a.id,
                    "title": a.title,
                }
            )
        return out

    if path == "/kb" or path.startswith("/kb/"):
        docs = list(session.exec(select(KnowledgeDoc)).all())
        if path == "/kb":
            return [
                {
                    "name": f"{(d.title or d.id)[:40]}.md",
                    "type": "file",
                    "path": f"/kb/{d.id}.md",
                    "docId": d.id,
                    "title": d.title,
                }
                for d in docs[:100]
            ]
        return []

    if path == "/workspace" or path.startswith("/workspace"):
        target = _workspace_resolve(path)
        if not target.exists():
            return []
        if target.is_file():
            return [{"name": target.name, "type": "file", "path": path}]
        out = []
        for child in sorted(target.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
            rel = "/workspace/" + str(child.relative_to(_ensure_workspace())).replace("\\", "/")
            out.append({"name": child.name, "type": "dir" if child.is_dir() else "file", "path": rel})
        return out

    raise VfsError(f"未知路径：{path}", code="not_found")


def _read_artifact(session: Session, path: str) -> tuple[str, dict[str, Any]]:
    m = re.match(r"^/projects/([^/]+)/artifacts/([^/]+)/(.+)\.md$", path)
    if not m:
        raise VfsError("产物路径无效", code="not_found")
    pid, atype, _name = m.group(1), m.group(2), m.group(3)
    arts = list(session.exec(select(Artifact).where(Artifact.project_id == pid, Artifact.type == atype)).all())
    # 按 title 模糊匹配
    for a in arts:
        safe = re.sub(r"[^\w\u4e00-\u9fff\-]+", "_", a.title)[:40] or a.id[:8]
        if path.endswith(f"/{safe}.md") or a.id in path:
            return a.body_markdown or "", {"artifactId": a.id, "title": a.title, "type": a.type}
    if arts:
        a = arts[0]
        return a.body_markdown or "", {"artifactId": a.id, "title": a.title, "type": a.type}
    raise VfsError("找不到产物", code="not_found")


def read(
    session: Session,
    path: str,
    *,
    offset: int = 1,
    limit: int | None = None,
    project_id: str | None = None,
    agent_id: str | None = None,
) -> dict[str, Any]:
    path = _norm(path)
    _worker_guard(path, project_id, agent_id)
    if is_context_snapshot(path):
        raise VfsError("引用快照不能通过文件工具访问", code="not_found")
    meta: dict[str, Any] = {"path": path}
    content = ""

    if path.startswith("/files/"):
        mounted = _mounted_call(directory_mounts.read_text, session, path)
        content = mounted.pop("text")
        meta.update(mounted)
    elif path.startswith("/memories/"):
        row = session.get(MemoryFile, path)
        if not row:
            raise VfsError(f"文件不存在：{path}", code="not_found")
        content = row.content or ""
        meta["updatedAt"] = row.updated_at.isoformat() if row.updated_at else None
    elif path.startswith("/projects/") and "/artifacts/" in path:
        content, extra = _read_artifact(session, path)
        meta.update(extra)
    elif path.startswith("/kb/"):
        doc_id = Path(path).stem
        doc = session.get(KnowledgeDoc, doc_id)
        if not doc:
            raise VfsError(f"知识库文档不存在：{path}", code="not_found")
        content = f"# {doc.title}\n\nsource: {doc.source or '—'}\ntags: {', '.join(doc.tags or [])}\n"
        for rid in (doc.analysis_report_ids or [])[:3]:
            rep = session.get(AnalysisReport, rid)
            if rep and rep.body_markdown:
                content += f"\n## 报告 {rep.title or rid}\n{rep.body_markdown[:4000]}\n"
                break
        meta["title"] = doc.title
    elif path.startswith("/workspace"):
        target = _workspace_resolve(path)
        if not target.exists() or not target.is_file():
            raise VfsError(f"文件不存在：{path}", code="not_found")
        content = target.read_text(encoding="utf-8", errors="replace")
    elif path.startswith("/runs/"):
        from .models import AgentRun, ThreadSubscription

        run_id = path[len("/runs/") :].split("/")[0]
        run = session.get(AgentRun, run_id)
        if not run:
            raise VfsError(f"run 不存在：{path}", code="not_found")
        arts = run.output_artifact_ids or []
        art_lines = []
        for aid in arts[:10]:
            if run.project_id:
                art_lines.append(f"- /projects/{run.project_id}/artifacts/{aid}")
            else:
                art_lines.append(f"- artifact:{aid}")
        parent = f"/runs/{run.parent_run_id}" if run.parent_run_id else "—"
        subs = list(
            session.exec(
                select(ThreadSubscription).where(ThreadSubscription.run_id == run.id)
            )
        )
        thread_lines = [f"- /threads/{s.thread_key}" for s in subs]
        content = (
            f"# Run {run.id}\n\n"
            f"- agent: {run.agent_id}\n"
            f"- status: {run.status}\n"
            f"- project: {run.project_id or '—'}\n"
            f"- conversation: {run.conversation_id or '—'}\n"
            f"- parent: {parent}\n"
            f"- tokens: prompt={run.token_prompt} completion={run.token_completion}\n\n"
            f"## 产物指针\n"
            + ("\n".join(art_lines) if art_lines else "- （无）")
            + "\n\n## 订阅 Thread\n"
            + ("\n".join(thread_lines) if thread_lines else "- （无）")
            + "\n"
        )
        meta.update({"runId": run.id, "agentId": run.agent_id, "status": run.status})
    elif path.startswith("/threads/"):
        from .models import ThreadSubscription

        thread_key = path[len("/threads/") :]
        subs = list(
            session.exec(
                select(ThreadSubscription).where(ThreadSubscription.thread_key == thread_key)
            )
        )
        if not subs:
            raise VfsError(f"thread 不存在：{path}", code="not_found")
        lines = [f"# Thread {thread_key}\n"]
        for s in subs:
            lines.append(
                f"- sub={s.id} conv={s.conversation_id} run=/runs/{s.run_id or '—'} "
                f"agent={s.agent_id} mode={s.mode} status={s.status}"
            )
            if s.project_id:
                lines.append(f"  project=/projects/{s.project_id}")
        content = "\n".join(lines) + "\n"
        meta["threadKey"] = thread_key
    elif path.startswith("/inbox/"):
        from .models import AgentEvent
        from .agent_inbox import render_event

        eid = path[len("/inbox/") :].split("/")[0]
        ev = session.get(AgentEvent, eid)
        if not ev:
            raise VfsError(f"事件不存在：{path}", code="not_found")
        content = (
            f"# Inbox Event {ev.id}\n\n"
            f"- source: {ev.source}\n"
            f"- status: {ev.status}\n"
            f"- conversation: {ev.conversation_id}\n"
            f"- created: {ev.created_at}\n\n"
            f"## Inline\n{render_event(ev)}\n\n"
            f"## Payload\n```json\n{json.dumps(ev.payload or {}, ensure_ascii=False, indent=2)[:3000]}\n```\n"
        )
        meta.update({"eventId": ev.id, "source": ev.source})
    else:
        raise VfsError(f"不可读路径：{path}", code="not_found")

    lines = content.splitlines()
    start = max(1, int(offset or 1))
    end = len(lines) if limit is None else min(len(lines), start - 1 + max(0, int(limit)))
    sliced = lines[start - 1 : end]
    numbered = "\n".join(f"{i}|{line}" for i, line in enumerate(sliced, start=start))
    return {
        "path": path,
        "content": numbered,
        "raw": content if path.startswith("/files/") and start == 1 and limit is None else "\n".join(sliced),
        "totalLines": len(lines),
        "offset": start,
        "limit": limit,
        **{k: v for k, v in meta.items() if k != "path"},
    }


def write(
    session: Session,
    path: str,
    content: str,
    *,
    actor: str = "assistant",
    allow_memories_only: bool = False,
    expected_hash: str | None = None,
    check_cas: bool = False,
    source_run_id: str | None = None,
    source_conversation_id: str | None = None,
) -> dict[str, Any]:
    path = _norm(path)
    if is_context_snapshot(path):
        raise VfsError("引用快照不能通过文件工具访问", code="not_found")
    if path.startswith("/files/"):
        return _mounted_call(directory_mounts.write_text, session, path, content, expected_hash)
    if allow_memories_only and not path.startswith("/memories/"):
        raise VfsError("总编仅可写入 /memories", code="forbidden")

    if path.startswith("/memories/"):
        project_id = None
        m = re.match(r"^/memories/projects/([^/]+)/", path)
        if m:
            project_id = m.group(1)
        try:
            result = cas_write_memory(
                session,
                path=path,
                content=content,
                project_id=project_id,
                expected_hash=expected_hash,
                check_cas=check_cas or expected_hash is not None,
                actor=actor,
                source_run_id=source_run_id,
                source_conversation_id=source_conversation_id,
            )
        except MemoryFrozenError as exc:
            raise VfsError(str(exc), code="frozen") from exc
        except MemoryConflictError as exc:
            raise VfsError(json.dumps(exc.as_detail(), ensure_ascii=False), code="conflict") from exc
        except ValueError as exc:
            raise VfsError(str(exc), code="bad_path") from exc
        return {
            "path": path,
            "bytes": len(content),
            "hash": result.row.hash,
            "storeId": result.row.store_id,
            "versionId": result.version_id,
        }

    if path.startswith("/projects/") and "/artifacts/" in path:
        m = re.match(r"^/projects/([^/]+)/artifacts/([^/]+)/(.+)\.md$", path)
        if not m:
            raise VfsError("产物路径无效", code="bad_path")
        pid, atype, name = m.group(1), m.group(2), m.group(3)
        title = name.replace("_", " ")
        arts = list(session.exec(select(Artifact).where(Artifact.project_id == pid, Artifact.type == atype)).all())
        art = next((a for a in arts if (re.sub(r"[^\w\u4e00-\u9fff\-]+", "_", a.title)[:40] or a.id[:8]) == name), None)
        from .routers.projects import _capture_baseline, _snapshot_version, _record_content_edit
        if art:
            from .ontology.runtime import sync_artifact_to_object
            previous_version = art.version
            content_changed = art.body_markdown != content
            _capture_baseline(session, art, "before file edit")
            result = session.execute(
                update(Artifact).where(Artifact.id == art.id, Artifact.version == previous_version)
                .values(body_markdown=content, version=previous_version + 1, updated_at=utcnow())
                .execution_options(synchronize_session=False)
            )
            if result.rowcount != 1:
                session.rollback()
                raise VfsError("稿件已更新，请重新读取后修改", code="conflict")
            session.refresh(art)
            _record_content_edit(session, art, previous_version, content_changed)
            sync_artifact_to_object(session, artifact=art, via_action=True)
        else:
            art = Artifact(
                project_id=pid,
                type=atype,
                title=title,
                status="draft",
                body_markdown=content,
            )
            session.add(art)
        _snapshot_version(session, art, actor=actor if actor in {"user", "assistant"} else "system")
        session.commit()
        return {"path": path, "artifactId": art.id, "bytes": len(content)}

    if path.startswith("/workspace"):
        target = _workspace_resolve(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return {"path": path, "bytes": len(content)}

    if path.startswith("/kb/"):
        raise VfsError("/kb 只读", code="readonly")

    raise VfsError(f"不可写路径：{path}", code="forbidden")


def edit(
    session: Session,
    path: str,
    old: str,
    new: str,
    *,
    replace_all: bool = False,
    actor: str = "assistant",
    allow_memories_only: bool = False,
    expected_hash: str | None = None,
    check_cas: bool = False,
) -> dict[str, Any]:
    current = read(session, path, offset=1, limit=None)
    raw = current.get("raw") or ""
    # memories 路径：必须基于存储的原文（保留末尾换行）计算 hash 与替换，否则 CAS 会误判冲突
    pre_hash = expected_hash
    if _norm(path).startswith("/memories/"):
        row = session.get(MemoryFile, _norm(path))
        raw = (row.content or "") if row else raw
        if pre_hash is None:
            pre_hash = memory_hash(raw)
            check_cas = True
    count = raw.count(old)
    if count == 0:
        raise VfsError("未找到匹配的 old 文本", code="no_match")
    if count > 1 and not replace_all:
        raise VfsError(f"old 文本出现 {count} 次，请提供更唯一的片段或设 replace_all=true", code="ambiguous")
    if replace_all:
        updated = raw.replace(old, new)
    else:
        updated = raw.replace(old, new, 1)
    return write(
        session,
        path,
        updated,
        actor=actor,
        allow_memories_only=allow_memories_only,
        expected_hash=pre_hash,
        check_cas=check_cas,
    )


def grep(
    session: Session,
    pattern: str,
    path: str = "/",
    *,
    glob: str | None = None,
    max_hits: int = 50,
    project_id: str | None = None,
    agent_id: str | None = None,
) -> list[dict[str, Any]]:
    path = _norm(path)
    _worker_guard(path, project_id, agent_id, directory=True)
    if is_context_snapshot(path):
        raise VfsError("引用快照不能通过文件工具访问", code="not_found")
    try:
        rx = re.compile(pattern)
    except re.error as exc:
        raise VfsError(f"正则无效：{exc}", code="bad_regex") from exc

    hits: list[dict[str, Any]] = []
    visited = 0

    def _scan_file(fpath: str, content: str) -> None:
        if glob and not fnmatch.fnmatch(Path(fpath).name, glob):
            return
        for i, line in enumerate(content.splitlines(), start=1):
            if rx.search(line):
                hits.append({"path": fpath, "line": i, "text": line[:200]})
                if len(hits) >= max_hits:
                    return

    def _walk(p: str) -> None:
        nonlocal visited
        visited += 1
        if len(hits) >= max_hits or visited > 2000 or p.count('/') > 64:
            return
        try:
            entries = ls(session, p, project_id=project_id, agent_id=agent_id)
        except VfsError:
            # 可能是文件
            try:
                data = read(session, p, project_id=project_id, agent_id=agent_id)
                _scan_file(p, data.get("raw") or "")
            except VfsError:
                return
            return
        for e in entries:
            if e["type"] == "dir":
                _walk(e["path"])
            else:
                try:
                    data = read(session, e["path"], project_id=project_id, agent_id=agent_id)
                    _scan_file(e["path"], data.get("raw") or "")
                except VfsError:
                    continue
                if len(hits) >= max_hits:
                    return

    _walk(path)
    return hits


def find(session: Session, path: str = "/", *, glob_pat: str = "**/*", max_hits: int = 100, project_id: str | None = None, agent_id: str | None = None) -> list[str]:
    path = _norm(path)
    _worker_guard(path, project_id, agent_id, directory=True)
    if is_context_snapshot(path):
        raise VfsError("引用快照不能通过文件工具访问", code="not_found")
    found: list[str] = []
    visited = 0

    def _walk(p: str) -> None:
        nonlocal visited
        visited += 1
        if len(found) >= max_hits or visited > 2000 or p.count('/') > 64:
            return
        try:
            entries = ls(session, p, project_id=project_id, agent_id=agent_id)
        except VfsError:
            if p == "/files" or p.startswith("/files/"):
                try:
                    read(session, p, project_id=project_id, agent_id=agent_id)
                except VfsError:
                    return
            if fnmatch.fnmatch(Path(p).name, glob_pat.replace("**/", "")):
                found.append(p)
            return
        for e in entries:
            name = e["name"]
            if e["type"] == "file" and (
                fnmatch.fnmatch(name, glob_pat)
                or fnmatch.fnmatch(e["path"], glob_pat)
                or fnmatch.fnmatch(name, glob_pat.replace("**/", ""))
            ):
                found.append(e["path"])
            elif e["type"] == "dir":
                _walk(e["path"])

    _walk(path)
    return found[:max_hits]
