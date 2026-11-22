from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

from sqlmodel import Session, select
from sqlalchemy import update

from ..models import (
    ActivityLog,
    Artifact,
    OntoActionRun,
    OntoLink,
    OntoObject,
    OntoObjectVersion,
    OntoScenario,
    Project,
    utcnow,
)

ACTION_ONLY_ARTIFACT_TYPES = frozenset(
    {
        "core_hook",
        "character",
        "episode_outline",
        "story_graph",
        "episode_graph",
        "foreshadow_ledger",
        "expectation_conflict",
        "manuscript",
        "master_outline",
        "framework",
        "character_graph",
    }
)

_ARTIFACT_TO_OT = {
    "core_hook": "CoreHook",
    "character": "Character",
    "episode_outline": "EpisodeOutline",
    "story_graph": "StoryGraph",
    "episode_graph": "EpisodeGraph",
    "foreshadow_ledger": "ForeshadowEntry",
    "expectation_conflict": "ExpectationConflict",
    "manuscript": "Manuscript",
    "master_outline": "MasterOutline",
    "framework": "Framework",
    "character_graph": "CharacterRelation",
    "logline": "Logline",
    "swap_plan": "SwapImitate",
    "dissect_params": "DissectParams",
    "gold_finger_cap": "GoldFinger",
    "world_setting": "WorldSetting",
    "topic_card": "TopicCard",
    "book_pack": "BookPack",
    "beat20": "Beat20",
    "scene": "SceneShot",
}


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


@lru_cache(maxsize=1)
def load_registry() -> dict[str, Any]:
    path = _repo_root() / "packages" / "ontology" / "ontology-registry.json"
    if not path.exists():
        return {
            "schemaVersion": "writing-ontology/1",
            "objectTypes": [],
            "actionTypes": [],
            "actionOnlyArtifactTypes": list(ACTION_ONLY_ARTIFACT_TYPES),
            "counts": {},
        }
    return json.loads(path.read_text(encoding="utf-8"))


def is_action_only_artifact_type(artifact_type: str) -> bool:
    reg = load_registry()
    listed = reg.get("actionOnlyArtifactTypes") or list(ACTION_ONLY_ARTIFACT_TYPES)
    return artifact_type in listed


def content_hash(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    ).hexdigest()


def make_rid(type_api_name: str, raw_id: str | None = None) -> str:
    return f"ri.writing.{type_api_name}.{raw_id or uuid.uuid4()}"


def materialize_story_graph_mermaid(properties: dict[str, Any]) -> dict[str, Any]:
    """Deterministic Mermaid from nodes/edges (mirrors domain storyGraphToMermaid)."""
    nodes = properties.get("nodes") or []
    edges = properties.get("edges") or []
    edge_label = {
        "causes": "导致",
        "enables": "促成",
        "blocks": "阻碍",
        "foreshadows": "伏笔",
        "payoff": "兑现",
        "knows": "知晓",
        "owns": "持有",
        "located": "位于",
    }
    lines = ["flowchart TD"]

    def esc_id(x: str) -> str:
        import re

        s = re.sub(r"[^a-zA-Z0-9_\u4e00-\u9fff]", "_", str(x))[:48]
        return s or "n"

    def esc_label(x: str) -> str:
        return str(x).replace("[", " ").replace("]", " ").replace('"', " ").replace("\n", " ")[:40]

    for n in nodes:
        nid = esc_id(n.get("id", ""))
        label = esc_label(n.get("label", nid))
        kind = n.get("kind", "fact")
        if kind == "character":
            shape = f"([{label}])"
        elif kind == "event":
            shape = f"[{label}]"
        elif kind == "location":
            shape = f"[[{label}]]"
        else:
            shape = f"({label})"
        lines.append(f"  {nid}{shape}")
    for e in edges:
        frm = esc_id(e.get("from", ""))
        to = esc_id(e.get("to", ""))
        kind = e.get("kind", "")
        label = edge_label.get(kind, kind)
        ep = e.get("episode") or 0
        ep_s = f" EP{ep}" if ep else ""
        lines.append(f"  {frm} -->|{label}{ep_s}| {to}")
    if not nodes:
        lines.append("  empty([暂无节点])")
    out = dict(properties)
    out["mermaid"] = "\n".join(lines)
    out.setdefault("schemaVersion", "story-graph/1")
    out.setdefault("kind", properties.get("kind") or "story_graph")
    return out


def slice_story_graph_for_bible(properties: dict[str, Any] | None, current_ep: int = 0, recent_eps: int = 3) -> str:
    if not properties:
        return "（尚无 story_graph）"
    nodes = properties.get("nodes") or []
    edges = properties.get("edges") or []
    states = properties.get("characterStates") or []
    min_ep = max(0, current_ep - recent_eps)
    active = [n for n in nodes if n.get("status") == "active" or True][:40]
    open_edges = [
        e
        for e in edges
        if e.get("open") or e.get("kind") == "foreshadows" or (e.get("episode") or 0) >= min_ep
    ][:40]
    st = sorted(
        [s for s in states if (s.get("episode") or 0) >= min_ep],
        key=lambda s: s.get("episode") or 0,
        reverse=True,
    )[:24]
    lines = [
        f"nodes({len(active)}/{len(nodes)}):",
        *[f"- {n.get('id')}[{n.get('kind')}] {n.get('label')} · {n.get('status')}" for n in active],
        f"edges({len(open_edges)}/{len(edges)}):",
        *[
            f"- {e.get('from')} -{e.get('kind')}-> {e.get('to')}"
            + (f" @EP{e.get('episode')}" if e.get("episode") else "")
            + (" [open]" if e.get("open") else "")
            for e in open_edges
        ],
        "characterStates:",
    ]
    if st:
        lines.extend(
            [
                f"- EP{s.get('episode')} {s.get('name') or s.get('characterId')}: @{s.get('location') or '?'} | {s.get('powerLevel') or '-'} | {s.get('emotion') or '-'}"
                for s in st
            ]
        )
    else:
        lines.append("- （无快照）")
    return "\n".join(lines)[:3500]


def object_set(
    session: Session,
    *,
    project_id: str,
    type_api_name: str | None = None,
    status: str | None = None,
) -> list[OntoObject]:
    q = select(OntoObject).where(OntoObject.project_id == project_id)
    if type_api_name:
        q = q.where(OntoObject.type_api_name == type_api_name)
    if status:
        q = q.where(OntoObject.status == status)
    return list(session.exec(q).all())


def search_around(
    session: Session,
    *,
    project_id: str,
    rid: str,
    link_types: list[str] | None = None,
    depth: int = 1,
) -> list[dict[str, Any]]:
    links = list(session.exec(select(OntoLink).where(OntoLink.project_id == project_id)).all())
    allow = set(link_types) if link_types else None
    out: list[dict[str, Any]] = []
    frontier = {rid}
    seen = {rid}
    for d in range(1, max(1, depth) + 1):
        nxt: set[str] = set()
        for L in links:
            if allow and L.link_type not in allow:
                continue
            if L.from_rid in frontier and L.to_rid not in seen:
                seen.add(L.to_rid)
                nxt.add(L.to_rid)
                out.append({"rid": L.to_rid, "via": L.link_type, "depth": d})
            if L.to_rid in frontier and L.from_rid not in seen:
                seen.add(L.from_rid)
                nxt.add(L.from_rid)
                out.append({"rid": L.from_rid, "via": L.link_type, "depth": d})
        frontier = nxt
    return out


def _snapshot(session: Session, obj: OntoObject, action_run_id: str | None, actor: str) -> None:
    session.add(
        OntoObjectVersion(
            rid=obj.rid,
            version=obj.version,
            properties=dict(obj.properties or {}),
            content_hash=obj.content_hash,
            status=obj.status,
            action_run_id=action_run_id,
            actor=actor,
        )
    )


def _upsert_object(
    session: Session,
    *,
    project_id: str,
    user_id: str,
    type_api_name: str,
    properties: dict[str, Any],
    rid: str | None = None,
    status: str = "draft",
    expected_hash: str | None = None,
    action_run_id: str | None = None,
    actor: str = "system",
    backing_artifact_id: str | None = None,
) -> OntoObject:
    if type_api_name in ("StoryGraph", "EpisodeGraph"):
        properties = materialize_story_graph_mermaid(properties)
    h = content_hash(properties)
    if rid:
        obj = session.get(OntoObject, rid)
        if obj:
            if obj.project_id != project_id:
                raise ValueError(f"project_boundary:{rid}")
            if obj.type_api_name != type_api_name:
                raise ValueError(f"object_type_mismatch:{rid}")
            # Source evidence survives a narrative-only replacement. Explicit sourceRefs
            # still allow the caller to replace or clear provenance deliberately.
            properties = {**{key: value for key, value in (obj.properties or {}).items()
                             if key in {"sourceRefs", "provenance"}}, **properties}
            h = content_hash(properties)
            if expected_hash and obj.content_hash and expected_hash != obj.content_hash:
                raise ValueError(f"cas_conflict: expected {expected_hash}, got {obj.content_hash}")
            previous_version = obj.version
            _snapshot(session, obj, action_run_id, actor)
            changes = {"properties": properties, "content_hash": h, "status": status or obj.status,
                       "version": previous_version + 1, "updated_at": utcnow()}
            if backing_artifact_id:
                changes["backing_artifact_id"] = backing_artifact_id
            result = session.execute(update(OntoObject).where(
                OntoObject.rid == rid, OntoObject.project_id == project_id,
                OntoObject.version == previous_version,
            ).values(**changes).execution_options(synchronize_session=False))
            if result.rowcount != 1:
                raise ValueError(f"object_version_conflict:{rid}")
            session.refresh(obj)
            return obj
    new_rid = rid or make_rid(type_api_name)
    obj = OntoObject(
        rid=new_rid,
        type_api_name=type_api_name,
        project_id=project_id,
        user_id=user_id,
        status=status,
        properties=properties,
        content_hash=h,
        version=1,
        backing_artifact_id=backing_artifact_id,
    )
    session.add(obj)
    _snapshot(session, obj, action_run_id, actor)
    return obj


def _materialize_artifact(
    session: Session,
    *,
    project_id: str,
    type_api_name: str,
    properties: dict[str, Any],
    title: str,
    obj: OntoObject,
    adoption: bool = False,
    snapshot_actor: str = "system",
    created_by_run_id: str | None = None,
) -> Artifact | None:
    artifact_type = None
    for k, v in _ARTIFACT_TO_OT.items():
        if v == type_api_name:
            artifact_type = k
            break
    if not artifact_type:
        reg = load_registry()
        for ot in reg.get("objectTypes") or []:
            if ot.get("apiName") == type_api_name and ot.get("artifactType"):
                artifact_type = ot["artifactType"]
                break
    if not artifact_type:
        return None

    body_md = properties.get("bodyMarkdown")
    if not isinstance(body_md, str) or not body_md.strip():
        if type_api_name in ("StoryGraph", "EpisodeGraph"):
            mermaid = properties.get("mermaid") or "flowchart TD\n  empty([暂无节点])"
            body_md = f"# {type_api_name}\n\n```mermaid\n{mermaid}\n```\n"
        else:
            body_md = f"# {title}\n\n```json\n{json.dumps(properties, ensure_ascii=False, indent=2)}\n```\n"

    art: Artifact | None = None
    if obj.backing_artifact_id:
        art = session.get(Artifact, obj.backing_artifact_id)
        if not art or art.project_id != project_id:
            raise ValueError("project_boundary:backing_artifact")
    # Object identity is the only update key. A new candidate may have the same
    # title/type as an existing one; neither title nor singleton count identifies it.

    from ..routers.projects import _capture_baseline, _snapshot_version, _record_content_edit, _generation_actor
    snapshot_actor = _generation_actor(session, project_id, created_by_run_id, snapshot_actor)
    if art:
        previous_version = art.version
        # These fields are mirror/adoption metadata added by the ontology
        # bridge itself, rather than changes to the narrative source.
        metadata = {"title", "bodyMarkdown", "status", "adoptedAt", "adoptMode"}
        previous_body = {key: value for key, value in (art.body_json or {}).items() if key not in metadata}
        next_body = {key: value for key, value in properties.items() if key not in metadata}
        if adoption:
            title, body_md = art.title, art.body_markdown
        elif obj.status == "adopted" and previous_body == next_body and not properties.get("bodyMarkdown"):
            # A status-only adoption must not regenerate a different JSON body
            # containing adoptedAt/adoptMode and immediately invalidate itself.
            body_md = art.body_markdown
        content_changed = art.body_markdown != body_md or previous_body != next_body
        status = obj.status if obj.status in ("draft", "candidate", "adopted") else art.status
        if content_changed and (art.status == "adopted" or status == "adopted"):
            status = "draft"
        changes = {"title": title, "body_markdown": body_md, "body_json": properties,
                   "status": status, "version": previous_version + 1, "updated_at": utcnow()}
        if content_changed:
            changes["adopted_at"] = None
        elif adoption or obj.status == "adopted":
            changes["adopted_at"] = utcnow()
        if created_by_run_id:
            changes["created_by_run_id"] = created_by_run_id
        _capture_baseline(session, art, "before ontology update")
        result = session.execute(
            update(Artifact).where(Artifact.id == art.id, Artifact.version == previous_version)
            .values(**changes).execution_options(synchronize_session=False)
        )
        if result.rowcount != 1:
            session.rollback()
            raise ValueError("artifact_version_conflict")
        session.refresh(art)
        _record_content_edit(session, art, previous_version, content_changed)
        obj.status = art.status
    else:
        art = Artifact(
            project_id=project_id,
            type=artifact_type,
            title=title,
            status=obj.status if obj.status in ("draft", "candidate", "adopted") else "candidate",
            body_markdown=body_md,
            body_json=properties,
            created_by_run_id=created_by_run_id,
        )
        session.add(art)
        session.flush()
    _snapshot_version(session, art, actor=snapshot_actor)
    obj.backing_artifact_id = art.id
    session.add(obj)
    return art


def _plan_action(action_api_name: str, parameters: dict[str, Any], project_id: str) -> dict[str, Any]:
    """Mirror packages/ontology planAction (Python side)."""
    if action_api_name not in {a["apiName"] for a in load_registry().get("actionTypes", [])}:
        return {"ok": False, "runRid": make_rid("ActionRun"), "actionApiName": action_api_name,
                "criteria": [{"id": "unknown_action", "name": "未知 Action", "result": "fail", "message": action_api_name}],
                "edits": [], "sideEffects": {}, "error": "unknown_action"}
    criteria: list[dict[str, Any]] = []
    edits: list[dict[str, Any]] = []
    side_effects: dict[str, Any] = {}
    run_rid = make_rid("ActionRun")

    if action_api_name == "AdoptObject":
        rid = str(parameters.get("rid") or "")
        mode = str(parameters.get("mode") or "strong")
        if not rid:
            criteria.append({"id": "param_rid", "name": "rid", "result": "fail", "message": "缺少 rid"})
        else:
            criteria.append({"id": "param_rid", "name": "rid", "result": "pass", "message": rid})
            edits.append(
                {
                    "op": "update",
                    "rid": rid,
                    "properties": {
                        "status": "adopted" if mode == "strong" else "draft",
                        "adoptedAt": datetime.now(timezone.utc).isoformat(),
                        "adoptMode": mode,
                    },
                }
            )
            side_effects["adoptMode"] = mode
    elif action_api_name == "UpsertStoryGraph":
        props = parameters.get("graph") or parameters.get("properties") or {}
        rid = parameters.get("rid")
        edits.append(
            {
                "op": "update" if rid else "create",
                "rid": rid,
                "typeApiName": "StoryGraph",
                "properties": {**props, "kind": "story_graph"},
            }
        )
        side_effects["regenerateMermaid"] = True
        side_effects["materialize"] = True
    elif action_api_name == "MergeEpisodeGraph":
        edits.append(
            {
                "op": "merge_episode",
                "storyRid": parameters.get("storyRid"),
                "episodeRid": parameters.get("episodeRid"),
            }
        )
    elif action_api_name == "UpsertForeshadow":
        rid = parameters.get("rid")
        edits.append(
            {
                "op": "update" if rid else "create",
                "rid": rid,
                "typeApiName": "ForeshadowEntry",
                "properties": parameters.get("entry") or parameters.get("properties") or {},
            }
        )
        side_effects["materialize"] = True
    elif action_api_name == "LogicAck":
        side_effects["logicAck"] = {"projectId": project_id, "note": parameters.get("note") or ""}
        criteria.append(
            {
                "id": "LogicAck",
                "name": "逻辑终审",
                "result": "pass",
                "message": "人工 LogicAck 已记录",
            }
        )
    elif action_api_name == "AckStage":
        side_effects["ackStage"] = {"stage": parameters.get("stage")}
    elif action_api_name == "AdvanceStage":
        side_effects["advanceStage"] = {"to": parameters.get("to"), "force": bool(parameters.get("force"))}
    elif action_api_name == "ForceJump":
        side_effects["forceJump"] = {"to": parameters.get("to"), "reason": parameters.get("reason") or ""}
    elif action_api_name == "LinkExpectationToGraph":
        side_effects["createLink"] = {
            "fromRid": parameters.get("fromRid"),
            "toRid": parameters.get("toRid"),
            "linkType": parameters.get("linkType") or "payoff",
            "properties": parameters.get("linkProperties") or {},
        }
    elif action_api_name == "CreateScenario":
        side_effects["createScenario"] = {
            "label": parameters.get("label") or "分支",
            "baseRids": parameters.get("baseRids") or [],
        }
    elif action_api_name == "UpdateScenario":
        side_effects["updateScenario"] = {
            "scenarioRid": parameters.get("scenarioRid"),
            "forkedProperties": parameters.get("forkedProperties"),
            "expectedBranchHash": parameters.get("expectedBranchHash"),
        }
    elif action_api_name == "MergeScenario":
        confirmed = parameters.get("confirmed") is True
        criteria.append(
            {
                "id": "HumanConfirm",
                "name": "人工确认合并",
                "result": "pass" if confirmed else "fail",
                "message": "已确认" if confirmed else "需要 confirmed=true",
            }
        )
        side_effects["mergeScenario"] = {"scenarioRid": parameters.get("scenarioRid")}
    elif action_api_name == "MarkPayoffPaid":
        edits.append(
            {
                "op": "update",
                "rid": parameters.get("rid"),
                "properties": {
                    "status": "paid",
                    "payoffEp": parameters.get("payoffEp"),
                    "payoffAt": datetime.now(timezone.utc).isoformat(),
                },
            }
        )
    elif action_api_name == "ProposeObjectEdits":
        side_effects["proposalOnly"] = True
        side_effects["proposedEdits"] = parameters.get("edits") or []
        criteria.append(
            {"id": "proposal", "name": "仅提案", "result": "pass", "message": "未落库；须调用具体写 Action"}
        )
    elif action_api_name == "UpsertObject":
        type_api_name = str(parameters.get("typeApiName") or "")
        if not type_api_name:
            criteria.append(
                {"id": "typeApiName", "name": "typeApiName", "result": "fail", "message": "缺少 typeApiName"}
            )
        else:
            rid = parameters.get("rid")
            edits.append(
                {
                    "op": "update" if rid else "create",
                    "rid": rid,
                    "typeApiName": type_api_name,
                    "properties": parameters.get("properties") or parameters.get("bodyJson") or {},
                }
            )
            side_effects["materialize"] = True
    else:
        if parameters.get("typeApiName") and (parameters.get("properties") or parameters.get("bodyJson")):
            rid = parameters.get("rid")
            edits.append(
                {
                    "op": "update" if rid else "create",
                    "rid": rid,
                    "typeApiName": parameters.get("typeApiName"),
                    "properties": parameters.get("properties") or parameters.get("bodyJson") or {},
                }
            )
            side_effects["materialize"] = True
        side_effects["accepted"] = True

    failed = any(c.get("result") in ("fail", "inconclusive") for c in criteria)
    return {
        "ok": not failed,
        "runRid": run_rid,
        "actionApiName": action_api_name,
        "criteria": criteria,
        "edits": edits,
        "sideEffects": side_effects,
        "error": "criteria_failed" if failed else None,
    }


def scenario_branch_hash(scenario: OntoScenario) -> str:
    return content_hash({rid: props for rid, props in scenario.forked_properties.items() if rid != "__baseline__"})


class ScenarioConflict(ValueError):
    def __init__(self, conflicts: list[dict[str, Any]]):
        super().__init__("scenario_conflict")
        self.conflicts = conflicts


def _validate_references(session: Session, project_id: str, value: Any) -> None:
    """RID references, including nested provenance, cannot cross project boundaries."""
    if isinstance(value, dict):
        for nested in value.values():
            _validate_references(session, project_id, nested)
    elif isinstance(value, list):
        for nested in value:
            _validate_references(session, project_id, nested)
    elif isinstance(value, str) and value.startswith("ri.writing."):
        obj = session.get(OntoObject, value) or session.get(OntoScenario, value)
        if not obj:
            raise ValueError(f"reference_not_found:{value}")
        if obj.project_id != project_id:
            raise ValueError(f"project_boundary:{value}")


def execute_action(session: Session, **kwargs: Any) -> dict[str, Any]:
    try:
        result = execute_action_in_transaction(session, **kwargs)
        session.commit()
        return result
    except Exception:
        session.rollback()
        raise


def execute_action_in_transaction(
    session: Session,
    *,
    action_api_name: str,
    project_id: str,
    actor: str = "user",
    parameters: dict[str, Any] | None = None,
    job_id: str | None = None,
    user_id: str = "",
    expected_hash: str | None = None,
) -> dict[str, Any]:
    from ..routers.projects import _set_stage

    parameters = dict(parameters or {})
    project = session.get(Project, project_id)
    if not project:
        raise ValueError("project_not_found")

    _validate_references(session, project_id, parameters)
    generation_run_id = parameters.get("createdByRunId") if actor == "agent" else None
    if parameters.get("createdByRunId") and actor != "agent":
        raise ValueError("invalid_generation_actor")
    snapshot_actor = "user" if actor == "user" or actor.startswith("user:") else "system"
    started = utcnow()
    plan = _plan_action(action_api_name, parameters, project_id)
    run = OntoActionRun(
        run_rid=plan["runRid"],
        action_api_name=action_api_name,
        project_id=project_id,
        actor=actor,
        job_id=job_id,
        parameters=parameters,
        criteria=plan["criteria"],
        edits=plan["edits"],
        side_effects=plan["sideEffects"],
        ok=False,
        error=plan.get("error"),
        started_at=started,
    )
    session.add(run)
    session.flush()

    if not plan["ok"]:
        run.finished_at = utcnow()
        session.add(run)
        session.flush()
        session.refresh(run)
        return {"ok": False, "run": run, "plan": plan}

    applied: list[dict[str, Any]] = []
    side = dict(plan["sideEffects"] or {})

    # merge episode into story
    for edit in plan["edits"]:
        materialized = None
        if edit.get("op") == "merge_episode":
            story = session.get(OntoObject, str(edit.get("storyRid") or ""))
            episode = session.get(OntoObject, str(edit.get("episodeRid") or ""))
            if story and episode:
                from copy import deepcopy

                sprops = deepcopy(story.properties or {})
                eprops = episode.properties or {}
                node_map = {n["id"]: n for n in (sprops.get("nodes") or []) if n.get("id")}
                for n in eprops.get("nodes") or []:
                    if n.get("id"):
                        node_map[n["id"]] = n
                edge_map = {}
                for e in sprops.get("edges") or []:
                    key = e.get("id") or f"{e.get('from')}->{e.get('to')}:{e.get('kind')}:{e.get('episode')}"
                    edge_map[key] = e
                for e in eprops.get("edges") or []:
                    key = e.get("id") or f"{e.get('from')}->{e.get('to')}:{e.get('kind')}:{e.get('episode')}"
                    edge_map[key] = e
                ep_no = eprops.get("episodeNo") or 0
                states = [s for s in (sprops.get("characterStates") or []) if s.get("episode") != ep_no]
                states.extend(eprops.get("characterStates") or [])
                sprops["nodes"] = list(node_map.values())
                sprops["edges"] = list(edge_map.values())
                sprops["characterStates"] = states
                obj = _upsert_object(
                    session,
                    project_id=project_id,
                    user_id=user_id or project.user_id,
                    type_api_name="StoryGraph",
                    properties=sprops,
                    rid=story.rid,
                    status=story.status,
                    action_run_id=run.id,
                    actor=actor,
                )
                materialized = _materialize_artifact(
                    session,
                    project_id=project_id,
                    type_api_name="StoryGraph",
                    properties=obj.properties,
                    title="story_graph",
                    obj=obj,
                    snapshot_actor=snapshot_actor,
                    created_by_run_id=generation_run_id,
                )
                applied.append({"rid": obj.rid, "op": "merge_episode", "artifactId": obj.backing_artifact_id,
                                **({"artifactVersion": materialized.version} if materialized else {})})
            continue

        op = edit.get("op")
        rid = edit.get("rid")
        type_api_name = edit.get("typeApiName")
        props = dict(edit.get("properties") or {})

        if op == "update" and rid and not type_api_name:
            obj = session.get(OntoObject, rid)
            if not obj:
                raise ValueError(f"object_not_found:{rid}")
            if "status" in props and len(props) <= 3:
                # adopt-style status patch: merge into existing properties
                new_props = dict(obj.properties or {})
                new_props.update({k: v for k, v in props.items() if k not in ("status",)})
                status = str(props.get("status") or obj.status)
            else:
                new_props = {**(obj.properties or {}), **props}
                status = str(props.get("status") or obj.status)
            obj = _upsert_object(
                session,
                project_id=project_id,
                user_id=user_id or project.user_id,
                type_api_name=obj.type_api_name,
                properties=new_props,
                rid=obj.rid,
                status=status,
                expected_hash=expected_hash or parameters.get("expectedHash"),
                action_run_id=run.id,
                actor=actor,
            )
            if side.get("materialize") or obj.type_api_name in _ARTIFACT_TO_OT.values():
                materialized = _materialize_artifact(
                    session,
                    project_id=project_id,
                    type_api_name=obj.type_api_name,
                    properties=obj.properties,
                    title=str(obj.properties.get("title") or obj.type_api_name),
                    obj=obj,
                    snapshot_actor=snapshot_actor,
                    adoption=action_api_name == "AdoptObject",
                    created_by_run_id=None if action_api_name == "AdoptObject" else generation_run_id,
                )
            # strong adopt core hook stage nudge
            if (
                action_api_name == "AdoptObject"
                and obj.type_api_name == "CoreHook"
                and obj.status == "adopted"
                and side.get("adoptMode") == "strong"
            ):
                project.progress = {**(project.progress or {}), "S2_HOOK_SELECT": 1}
                if project.format == "manju":
                    _set_stage(session, project, "S2_LOGLINE_100", actor=actor, reason="强采纳核心梗")
                elif project.format == "short_novel":
                    _set_stage(session, project, "S2_SWAP", actor=actor, reason="强采纳核心梗")
                project.updated_at = utcnow()
                session.add(project)
            applied.append({"rid": obj.rid, "op": "update", "artifactId": obj.backing_artifact_id,
                                **({"artifactVersion": materialized.version} if materialized else {})})
            continue

        if type_api_name:
            obj = _upsert_object(
                session,
                project_id=project_id,
                user_id=user_id or project.user_id,
                type_api_name=str(type_api_name),
                properties=props,
                rid=rid,
                status=str(props.get("status") or "candidate"),
                expected_hash=expected_hash or parameters.get("expectedHash"),
                action_run_id=run.id,
                actor=actor,
            )
            if side.get("materialize") is not False:
                materialized = _materialize_artifact(
                    session,
                    project_id=project_id,
                    type_api_name=obj.type_api_name,
                    properties=obj.properties,
                    title=str(props.get("title") or obj.type_api_name),
                    obj=obj,
                    snapshot_actor=snapshot_actor,
                    created_by_run_id=generation_run_id,
                )
            applied.append({"rid": obj.rid, "op": op or "upsert", "artifactId": obj.backing_artifact_id,
                                **({"artifactVersion": materialized.version} if materialized else {})})

    # links
    if side.get("createLink"):
        cl = side["createLink"]
        session.add(
            OntoLink(
                project_id=project_id,
                link_type=str(cl.get("linkType") or "payoff"),
                from_rid=str(cl.get("fromRid") or ""),
                to_rid=str(cl.get("toRid") or ""),
                properties=dict(cl.get("properties") or {}),
            )
        )

    if side.get("createScenario"):
        cs = side["createScenario"]
        base_rids = list(cs.get("baseRids") or [])
        forked: dict[str, Any] = {"__baseline__": {}}
        for brid in base_rids:
            o = session.get(OntoObject, brid)
            if o:
                from copy import deepcopy
                forked[brid] = deepcopy(o.properties or {})
                forked["__baseline__"][brid] = {"contentHash": o.content_hash, "version": o.version, "status": o.status}
        sc_rid = make_rid("Scenario")
        session.add(
            OntoScenario(
                rid=sc_rid,
                project_id=project_id,
                label=str(cs.get("label") or "分支"),
                status="open",
                base_rids=base_rids,
                forked_properties=forked,
            )
        )
        side["scenarioRid"] = sc_rid

    if side.get("updateScenario"):
        update_sc = side["updateScenario"]
        sc = session.get(OntoScenario, str(update_sc.get("scenarioRid") or ""))
        if not sc or sc.status != "open":
            raise ValueError("scenario_not_open")
        if sc.project_id != project_id:
            raise ValueError("project_boundary:scenario")
        if not update_sc.get("expectedBranchHash") or update_sc["expectedBranchHash"] != scenario_branch_hash(sc):
            raise ValueError("scenario_branch_conflict")
        patches = update_sc.get("forkedProperties")
        if not isinstance(patches, dict) or any(rid not in sc.base_rids or not isinstance(props, dict) for rid, props in patches.items()):
            raise ValueError("invalid_scenario_patches")
        from copy import deepcopy
        properties = deepcopy(sc.forked_properties)
        for rid, patch in patches.items():
            properties[rid] = {**properties[rid], **patch}
        updated = session.execute(update(OntoScenario).where(
            OntoScenario.rid == sc.rid, OntoScenario.updated_at == sc.updated_at,
            OntoScenario.status == "open",
        ).values(forked_properties=properties, updated_at=utcnow()).execution_options(synchronize_session=False))
        if updated.rowcount != 1:
            raise ValueError("scenario_branch_conflict")
        session.refresh(sc)
        side["scenarioContentHash"] = scenario_branch_hash(sc)

    if side.get("mergeScenario"):
        scenario_rid = str(side["mergeScenario"].get("scenarioRid") or "")
        sc = session.get(OntoScenario, scenario_rid)
        if not sc:
            raise ValueError("scenario_not_found")
        if sc.project_id != project_id:
            raise ValueError("project_boundary:scenario")
        if sc.status == "merged":
            side["alreadyMerged"] = True
        elif sc.status != "open":
            raise ValueError("scenario_not_open")
        else:
            claimed = session.execute(update(OntoScenario).where(
                OntoScenario.rid == sc.rid, OntoScenario.status == "open",
                OntoScenario.updated_at == sc.updated_at,
            ).values(status="merging").execution_options(synchronize_session=False))
            if claimed.rowcount != 1:
                raise ValueError("scenario_branch_conflict")
            baselines = (sc.forked_properties or {}).get("__baseline__", {})
            conflicts = []
            for brid in sc.base_rids:
                o = session.get(OntoObject, brid)
                baseline = baselines.get(brid)
                if o and o.project_id != project_id:
                    raise ValueError(f"project_boundary:{brid}")
                if not o or not baseline or any([
                    baseline.get("contentHash") != o.content_hash,
                    baseline.get("version") != o.version,
                    baseline.get("status") != o.status,
                ]):
                    conflicts.append({"rid": brid, "expected": baseline,
                                      "actual": {"contentHash": o.content_hash, "version": o.version, "status": o.status} if o else None})
                if brid not in sc.forked_properties:
                    conflicts.append({"rid": brid, "reason": "missing_branch_properties"})
            if set(sc.forked_properties) - set(sc.base_rids) - {"__baseline__"}:
                raise ValueError("scenario_unknown_objects")
            if conflicts:
                raise ScenarioConflict(conflicts)
            for brid in sc.base_rids:
                props = dict(sc.forked_properties[brid])
                _validate_references(session, project_id, props)
            for brid in sc.base_rids:
                o = session.get(OntoObject, brid)
                props = dict(sc.forked_properties[brid])
                if props == o.properties:
                    continue
                obj = _upsert_object(
                    session, project_id=project_id, user_id=user_id or project.user_id,
                    type_api_name=o.type_api_name, properties=props, rid=o.rid,
                    status=o.status, expected_hash=baselines[brid]["contentHash"],
                    action_run_id=run.id, actor=actor,
                )
                materialized = _materialize_artifact(
                    session, project_id=project_id, type_api_name=obj.type_api_name,
                    properties=obj.properties, title=str(props.get("title") or obj.type_api_name), obj=obj,
                    snapshot_actor=snapshot_actor,
                    created_by_run_id=generation_run_id,
                )
                applied.append({"rid": obj.rid, "op": "merge_scenario", "artifactId": obj.backing_artifact_id,
                                **({"artifactVersion": materialized.version} if materialized else {})})
            sc.status = "merged"
            sc.updated_at = utcnow()
            session.add(sc)

    if side.get("logicAck"):
        acked_at = utcnow().isoformat()
        versions = {artifact.id: artifact.version for artifact in
                    session.exec(select(Artifact).where(Artifact.project_id == project_id))}
        project.progress = {**(project.progress or {}), "logic_ack": 1, "logic_ack_at": acked_at,
                            "logicAck": True, "logicAckAt": acked_at, "logicAckVersions": versions,
                            "artifactReviewRequired": {}}
        project.updated_at = utcnow()
        session.add(project)

    if side.get("ackStage") and side["ackStage"].get("stage"):
        st = str(side["ackStage"]["stage"])
        project.progress = {**(project.progress or {}), st: 1, f"{st}__ack": 1}
        project.updated_at = utcnow()
        session.add(project)

    if side.get("advanceStage") and side["advanceStage"].get("to"):
        _set_stage(session, project, str(side["advanceStage"]["to"]), actor=actor, reason="AdvanceStage")
        project.updated_at = utcnow()
        session.add(project)

    if side.get("forceJump") and side["forceJump"].get("to"):
        fj = list((project.progress or {}).get("forceJumps") or [])
        fj.append(
            {
                "from": project.stage,
                "to": side["forceJump"]["to"],
                "at": datetime.now(timezone.utc).isoformat(),
                "reason": side["forceJump"].get("reason") or "",
                "actionRunId": run.id,
            }
        )
        project.progress = {**(project.progress or {}), "forceJumps": fj}
        _set_stage(session, project, str(side["forceJump"]["to"]), actor=actor, reason="ForceJump")
        project.updated_at = utcnow()
        session.add(project)

    session.add(
        ActivityLog(
            actor=actor,
            action="ontology_action",
            summary=f"Ontology Action {action_api_name}",
            project_id=project_id,
            detail={"runId": run.id, "runRid": run.run_rid, "applied": applied, "ok": True},
        )
    )

    run.ok = True
    run.error = None
    run.edits = applied or plan["edits"]
    run.side_effects = side
    run.finished_at = utcnow()
    session.add(run)
    session.flush()
    session.refresh(run)
    return {"ok": True, "run": run, "plan": plan, "applied": applied}


def sync_artifact_to_object(
    session: Session,
    *,
    artifact: Artifact,
    user_id: str = "",
    via_action: bool = True,
) -> OntoObject | None:
    """Dual-write helper: Artifact → OntoObject (transition period)."""
    if not via_action:
        return None
    type_api = _ARTIFACT_TO_OT.get(artifact.type)
    if not type_api:
        return None
    props = dict(artifact.body_json or {})
    props.setdefault("title", artifact.title)
    props.setdefault("bodyMarkdown", artifact.body_markdown)
    # find existing by backing id
    existing = session.exec(
        select(OntoObject).where(OntoObject.backing_artifact_id == artifact.id)
    ).first()
    return _upsert_object(
        session,
        project_id=artifact.project_id,
        user_id=user_id,
        type_api_name=type_api,
        properties=props,
        rid=existing.rid if existing else None,
        status=artifact.status,
        backing_artifact_id=artifact.id,
        actor="system",
    )
