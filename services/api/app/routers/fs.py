"""统一虚拟文件系统 HTTP API：供总编工具 / agent-worker / 前端使用。"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, StrictBool
from sqlmodel import Session

from ..db import get_session
from .. import vfs, directory_mounts

router = APIRouter(prefix="/fs", tags=["fs"])


class WriteIn(BaseModel):
    path: str
    content: str
    actor: str = "assistant"
    memories_only: bool = False
    expected_hash: str | None = None
    check_cas: bool = False
    source_run_id: str | None = None
    source_conversation_id: str | None = None


class EditIn(BaseModel):
    path: str
    old: str
    new: str
    replace_all: bool = False
    actor: str = "assistant"
    memories_only: bool = False
    expected_hash: str | None = None
    check_cas: bool = False


class WorkerScope(BaseModel):
    project_id: str | None = None
    agent_id: str | None = None


class GrepIn(WorkerScope):
    pattern: str
    path: str = "/"
    glob: str | None = None
    max_hits: int = 50


class FindIn(WorkerScope):
    path: str = "/"
    glob: str = "**/*"
    max_hits: int = 100


class MountIn(BaseModel):
    name: str
    root: str
    read_only: StrictBool = Field(default=True, alias="readOnly")


class RestoreIn(BaseModel):
    path: str
    version_id: str = Field(alias="versionId")
    expected_hash: str = Field(alias="expectedHash")


@router.get("/mounts")
def mounts(session: Session = Depends(get_session)) -> dict:
    return {"mounts": directory_mounts.list_mounts(session)}


@router.post("/mounts")
def put_mount(body: MountIn, session: Session = Depends(get_session)) -> dict:
    try:
        return directory_mounts.put_mount(session, body.name, body.root, body.read_only)
    except directory_mounts.MountError as exc:
        raise _http(exc) from exc


@router.delete("/mounts/{name}")
def delete_mount(name: str, session: Session = Depends(get_session)) -> dict:
    directory_mounts.delete_mount(session, name)
    return {"status": "deleted"}


@router.get("/versions")
def versions(path: str, session: Session = Depends(get_session)) -> dict:
    try:
        return {"versions": directory_mounts.versions(session, path)}
    except directory_mounts.MountError as exc:
        raise _http(exc) from exc


@router.get("/versions/{version_id}")
def version_content(version_id: str, path: str, session: Session = Depends(get_session)) -> dict:
    try:
        return directory_mounts.version_content(session, path, version_id)
    except directory_mounts.MountError as exc:
        raise _http(vfs.VfsError(str(exc), code=exc.code)) from exc


@router.post("/restore")
def restore(body: RestoreIn, session: Session = Depends(get_session)) -> dict:
    try:
        return directory_mounts.restore(session, body.path, body.version_id, body.expected_hash)
    except directory_mounts.MountError as exc:
        raise _http(exc) from exc


def _http(exc: vfs.VfsError) -> HTTPException:
    status = 404 if exc.code in {"not_found"} else 400
    if exc.code in {"forbidden", "readonly", "path_escape"}:
        status = 403
    if exc.code in {"frozen"}:
        status = 400
    if exc.code in {"conflict"}:
        status = 409
    return HTTPException(status, str(exc))


@router.get("/ls")
def fs_ls(path: str = "/", project_id: str | None = None, agent_id: str | None = None, session: Session = Depends(get_session)) -> dict[str, Any]:
    try:
        return {"path": path, "entries": vfs.ls(session, path, project_id=project_id, agent_id=agent_id)}
    except vfs.VfsError as exc:
        raise _http(exc) from exc


@router.get("/read")
def fs_read(
    path: str,
    offset: int = 1,
    limit: int | None = None,
    project_id: str | None = None,
    agent_id: str | None = None,
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    try:
        return vfs.read(session, path, offset=offset, limit=limit, project_id=project_id, agent_id=agent_id)
    except vfs.VfsError as exc:
        raise _http(exc) from exc


@router.put("/write")
def fs_write(body: WriteIn, session: Session = Depends(get_session)) -> dict[str, Any]:
    try:
        return vfs.write(
            session,
            body.path,
            body.content,
            actor=body.actor,
            allow_memories_only=body.memories_only,
            expected_hash=body.expected_hash,
            check_cas=body.check_cas,
            source_run_id=body.source_run_id,
            source_conversation_id=body.source_conversation_id,
        )
    except vfs.VfsError as exc:
        raise _http(exc) from exc


@router.post("/edit")
def fs_edit(body: EditIn, session: Session = Depends(get_session)) -> dict[str, Any]:
    try:
        return vfs.edit(
            session,
            body.path,
            body.old,
            body.new,
            replace_all=body.replace_all,
            actor=body.actor,
            allow_memories_only=body.memories_only,
            expected_hash=body.expected_hash,
            check_cas=body.check_cas,
        )
    except vfs.VfsError as exc:
        raise _http(exc) from exc


@router.post("/grep")
def fs_grep(body: GrepIn, session: Session = Depends(get_session)) -> dict[str, Any]:
    try:
        hits = vfs.grep(session, body.pattern, body.path, glob=body.glob, max_hits=body.max_hits, project_id=body.project_id, agent_id=body.agent_id)
        return {"hits": hits, "count": len(hits)}
    except vfs.VfsError as exc:
        raise _http(exc) from exc


@router.post("/find")
def fs_find(body: FindIn, session: Session = Depends(get_session)) -> dict[str, Any]:
    try:
        paths = vfs.find(session, body.path, glob_pat=body.glob, max_hits=body.max_hits, project_id=body.project_id, agent_id=body.agent_id)
        return {"paths": paths, "count": len(paths)}
    except vfs.VfsError as exc:
        raise _http(exc) from exc
