from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from ..db import get_session
from ..models import OntoActionRun, OntoLink, OntoObject, OntoScenario, Project
from ..ontology.runtime import (
    execute_action,
    ScenarioConflict,
    scenario_branch_hash,
    load_registry,
    object_set,
    search_around,
    slice_story_graph_for_bible,
    materialize_story_graph_mermaid,
    is_action_only_artifact_type,
)
from ..settings import get_settings

router = APIRouter(prefix="/ontology", tags=["ontology"])


def _uid(x_user_id: str | None) -> str:
    return x_user_id or get_settings().demo_user_id


def _project(session: Session, project_id: str, user_id: str) -> Project:
    p = session.get(Project, project_id)
    if not p or (p.user_id and p.user_id != user_id and user_id != get_settings().demo_user_id):
        # demo single-user: allow if project exists
        if not p:
            raise HTTPException(404, "project not found")
    return p


class ActionSubmitIn(BaseModel):
    action_api_name: str = Field(alias="actionApiName")
    project_id: str = Field(alias="projectId")
    parameters: dict[str, Any] = Field(default_factory=dict)
    expected_hash: Optional[str] = Field(default=None, alias="expectedHash")
    job_id: Optional[str] = Field(default=None, alias="jobId")
    actor: str = "user"

    model_config = {"populate_by_name": True}


class QueryIn(BaseModel):
    function: str
    project_id: str = Field(alias="projectId")
    parameters: dict[str, Any] = Field(default_factory=dict)

    model_config = {"populate_by_name": True}


class LinkIn(BaseModel):
    project_id: str = Field(alias="projectId")
    link_type: str = Field(alias="linkType")
    from_rid: str = Field(alias="fromRid")
    to_rid: str = Field(alias="toRid")
    properties: dict[str, Any] = Field(default_factory=dict)

    model_config = {"populate_by_name": True}


@router.get("/registry")
def get_registry() -> dict[str, Any]:
    return load_registry()


@router.get("/formats/{fmt}/bindings")
def format_bindings(fmt: str) -> dict[str, Any]:
    reg = load_registry()
    actions = [
        a
        for a in (reg.get("actionTypes") or [])
        if not a.get("formats") or fmt in (a.get("formats") or [])
    ]
    return {
        "format": fmt,
        "actionTypes": actions,
        "actionOnlyArtifactTypes": reg.get("actionOnlyArtifactTypes") or [],
        "objectTypes": reg.get("objectTypes") or [],
        "views": reg.get("views") or [],
    }


@router.get("/projects/{project_id}/objects")
def list_objects(
    project_id: str,
    type_api_name: Optional[str] = Query(default=None, alias="typeApiName"),
    status: Optional[str] = None,
    session: Session = Depends(get_session),
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
) -> list[dict[str, Any]]:
    _project(session, project_id, _uid(x_user_id))
    rows = object_set(session, project_id=project_id, type_api_name=type_api_name, status=status)
    return [
        {
            "rid": o.rid,
            "typeApiName": o.type_api_name,
            "projectId": o.project_id,
            "status": o.status,
            "properties": o.properties,
            "contentHash": o.content_hash,
            "version": o.version,
            "backingArtifactId": o.backing_artifact_id,
            "updatedAt": o.updated_at.isoformat() if o.updated_at else None,
        }
        for o in rows
    ]


@router.get("/objects/{rid:path}")
def get_object(
    rid: str,
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    o = session.get(OntoObject, rid)
    if not o:
        raise HTTPException(404, "object not found")
    return {
        "rid": o.rid,
        "typeApiName": o.type_api_name,
        "projectId": o.project_id,
        "status": o.status,
        "properties": o.properties,
        "contentHash": o.content_hash,
        "version": o.version,
        "backingArtifactId": o.backing_artifact_id,
    }


@router.get("/projects/{project_id}/links")
def list_links(
    project_id: str,
    session: Session = Depends(get_session),
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
) -> list[dict[str, Any]]:
    _project(session, project_id, _uid(x_user_id))
    rows = list(session.exec(select(OntoLink).where(OntoLink.project_id == project_id)).all())
    return [
        {
            "id": L.id,
            "linkType": L.link_type,
            "fromRid": L.from_rid,
            "toRid": L.to_rid,
            "properties": L.properties,
        }
        for L in rows
    ]


@router.post("/actions/submit")
def submit_action(
    body: ActionSubmitIn,
    session: Session = Depends(get_session),
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
) -> dict[str, Any]:
    uid = _uid(x_user_id)
    _project(session, body.project_id, uid)
    try:
        result = execute_action(
            session,
            action_api_name=body.action_api_name,
            project_id=body.project_id,
            actor=body.actor or f"user:{uid}",
            parameters=body.parameters,
            job_id=body.job_id,
            user_id=uid,
            expected_hash=body.expected_hash,
        )
    except ScenarioConflict as exc:
        raise HTTPException(409, {"error": "scenario_conflict", "conflicts": exc.conflicts}) from exc
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    run: OntoActionRun = result["run"]
    return {
        "ok": result["ok"],
        "runId": run.id,
        "runRid": run.run_rid,
        "actionApiName": run.action_api_name,
        "criteria": run.criteria,
        "edits": run.edits,
        "sideEffects": run.side_effects,
        "error": run.error,
        "applied": result.get("applied") or [],
    }


@router.post("/query")
def ontology_query(
    body: QueryIn,
    session: Session = Depends(get_session),
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
) -> dict[str, Any]:
    _project(session, body.project_id, _uid(x_user_id))
    fn = body.function
    p = body.parameters
    if fn == "objectSet":
        rows = object_set(
            session,
            project_id=body.project_id,
            type_api_name=p.get("typeApiName"),
            status=p.get("status"),
        )
        return {
            "function": fn,
            "result": [
                {
                    "rid": o.rid,
                    "typeApiName": o.type_api_name,
                    "status": o.status,
                    "contentHash": o.content_hash,
                    "properties": o.properties,
                }
                for o in rows
            ],
        }
    if fn == "searchAround":
        return {
            "function": fn,
            "result": search_around(
                session,
                project_id=body.project_id,
                rid=str(p.get("rid") or ""),
                link_types=p.get("linkTypes"),
                depth=int(p.get("depth") or 1),
            ),
        }
    if fn == "sliceForBible":
        graphs = object_set(session, project_id=body.project_id, type_api_name="StoryGraph", status="adopted")
        props = graphs[0].properties if graphs else None
        return {
            "function": fn,
            "result": slice_story_graph_for_bible(
                props,
                current_ep=int(p.get("currentEp") or 0),
                recent_eps=int(p.get("recentEps") or 3),
            ),
        }
    if fn == "renderObjectView":
        view = str(p.get("viewApiName") or "StoryContinuity")
        if view == "StoryContinuity":
            graphs = object_set(session, project_id=body.project_id, type_api_name="StoryGraph", status="adopted")
            props = graphs[0].properties if graphs else {}
            rendered = materialize_story_graph_mermaid(dict(props or {}))
            return {
                "function": fn,
                "view": view,
                "result": {
                    "mermaid": rendered.get("mermaid"),
                    "nodeCount": len(rendered.get("nodes") or []),
                    "edgeCount": len(rendered.get("edges") or []),
                },
            }
        if view == "ObjectExplorer":
            rows = object_set(session, project_id=body.project_id)
            by_type: dict[str, int] = {}
            for o in rows:
                by_type[o.type_api_name] = by_type.get(o.type_api_name, 0) + 1
            return {"function": fn, "view": view, "result": {"counts": by_type, "total": len(rows)}}
        if view == "ActionAudit":
            runs = list(
                session.exec(
                    select(OntoActionRun)
                    .where(OntoActionRun.project_id == body.project_id)
                    .order_by(OntoActionRun.started_at.desc())  # type: ignore[attr-defined]
                ).all()
            )[:50]
            return {
                "function": fn,
                "view": view,
                "result": [
                    {
                        "id": r.id,
                        "actionApiName": r.action_api_name,
                        "ok": r.ok,
                        "actor": r.actor,
                        "startedAt": r.started_at.isoformat() if r.started_at else None,
                        "error": r.error,
                    }
                    for r in runs
                ],
            }
        return {"function": fn, "view": view, "result": None}
    if fn == "listMappedArtifactTypes":
        return {
            "function": fn,
            "result": load_registry().get("actionOnlyArtifactTypes") or [],
        }
    raise HTTPException(400, f"unknown function: {fn}")


@router.get("/projects/{project_id}/actions")
def list_action_runs(
    project_id: str,
    session: Session = Depends(get_session),
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
    limit: int = 50,
) -> list[dict[str, Any]]:
    _project(session, project_id, _uid(x_user_id))
    rows = list(
        session.exec(select(OntoActionRun).where(OntoActionRun.project_id == project_id)).all()
    )
    rows.sort(key=lambda r: r.started_at or r.finished_at, reverse=True)
    return [
        {
            "id": r.id,
            "runRid": r.run_rid,
            "actionApiName": r.action_api_name,
            "ok": r.ok,
            "actor": r.actor,
            "criteria": r.criteria,
            "edits": r.edits,
            "error": r.error,
            "startedAt": r.started_at.isoformat() if r.started_at else None,
            "finishedAt": r.finished_at.isoformat() if r.finished_at else None,
        }
        for r in rows[:limit]
    ]


@router.get("/projects/{project_id}/scenarios")
def list_scenarios(
    project_id: str,
    session: Session = Depends(get_session),
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
) -> list[dict[str, Any]]:
    _project(session, project_id, _uid(x_user_id))
    rows = list(session.exec(select(OntoScenario).where(OntoScenario.project_id == project_id)).all())
    return [
        {
            "rid": s.rid,
            "label": s.label,
            "status": s.status,
            "baseRids": s.base_rids,
            "contentHash": scenario_branch_hash(s),
            "baselines": (s.forked_properties or {}).get("__baseline__", {}),
            "forkedProperties": {k: v for k, v in (s.forked_properties or {}).items() if k != "__baseline__"},
            "createdAt": s.created_at.isoformat() if s.created_at else None,
        }
        for s in rows
    ]


@router.get("/cutover/artifact-types")
def cutover_types() -> dict[str, Any]:
    reg = load_registry()
    types = list(reg.get("actionOnlyArtifactTypes") or [])
    return {
        "actionOnlyArtifactTypes": types,
        "check": {t: is_action_only_artifact_type(t) for t in types},
    }


@router.post("/projects/{project_id}/import-kb-graph/{doc_id}")
def import_kb_graph(
    project_id: str,
    doc_id: str,
    session: Session = Depends(get_session),
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
) -> dict[str, Any]:
    """将 KB GraphSnapshot 映射为只读 KbGraphSnapshot Object（不改主线 continuity）。"""
    from ..models import GraphSnapshot

    uid = _uid(x_user_id)
    _project(session, project_id, uid)
    snap = session.exec(select(GraphSnapshot).where(GraphSnapshot.doc_id == doc_id)).first()
    if not snap:
        raise HTTPException(404, "kb graph not found")
    result = execute_action(
        session,
        action_api_name="UpsertObject",
        project_id=project_id,
        actor=f"user:{uid}",
        user_id=uid,
        parameters={
            "typeApiName": "KbGraphSnapshot",
            "properties": {
                "docId": doc_id,
                "nodes": snap.nodes,
                "edges": snap.edges,
                "readOnly": True,
                "title": f"KB graph {doc_id}",
            },
        },
    )
    return {"ok": result["ok"], "runId": result["run"].id, "docId": doc_id}
