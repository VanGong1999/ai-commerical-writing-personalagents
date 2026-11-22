from app.routers.personal_agent import _TOOL_INDEX
from app.trust_policy import READONLY_TOOLS, requires_confirm


import asyncio
import pytest
from sqlmodel import Session, SQLModel, create_engine, select
from app.models import Artifact, Project, Conversation, AsyncTaskGroup, AgentRun
from app.routers.personal_agent import _execute_supervisor_tool
from app.seed import DEMO_USER


def test_studio_discovery_and_trust():
    assert {"read_artifact", "list_artifact_versions"} <= READONLY_TOOLS
    assert {"read_artifact", "save_artifact", "list_artifact_versions",
            "rollback_artifact", "start_studio_batch"} <= _TOOL_INDEX.keys()
    assert "expectedVersion" in _TOOL_INDEX["adopt_artifact"]["function"]["parameters"]["required"]
    for name in ("start_studio_batch", "rollback_artifact", "save_artifact"):
        assert requires_confirm(tool_name=name, trust_level=1)[0]


@pytest.fixture
def context():
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as s:
        p = Project(user_id=DEMO_USER, format="manju", title="稿", stage="S0_SETUP")
        conv = Conversation(user_id=DEMO_USER, project_id=p.id)
        art = Artifact(project_id=p.id, type="manuscript", title="稿", body_markdown="初稿", created_by_run_id="source")
        s.add_all([p, art, conv])
        s.commit()
        def call(name, **args):
            return asyncio.run(_execute_supervisor_tool(name, {"artifact_id": art.id, **args}, s, conv))[1]
        yield s, art, conv, call
    engine.dispose()


def test_version_chain(context):
    s, art, conv, call = context
    assert call("tool_search", query="save_artifact")["load"] == ["save_artifact"]
    first = call("read_artifact")
    assert first["artifact"]["createdByRunId"] == "source"
    assert first["bodyMarkdown"] == "初稿"
    assert call("save_artifact", expectedVersion=True, bodyMarkdown="无效")["error"]
    assert call("save_artifact", expectedVersion=1, bodyMarkdown="修改")["versionAfter"] == 2
    assert call("adopt_artifact", expectedVersion=1)["error"]["code"] == "version_conflict"
    assert art.status == "draft"
    assert call("list_artifact_versions", project_id="other")["error"]
    versions = call("list_artifact_versions")["versions"]
    assert len(versions) == 2
    assert call("rollback_artifact", expectedVersion=2, version_id=versions[-1]["id"])["versionAfter"] == 3
    assert art.body_markdown == "初稿"
    art.type, art.body_json = "core_hook", {"candidate": {}}
    s.add(art)
    s.commit()
    assert call("adopt_artifact", expectedVersion=3)["error"]["gates"]
    assert art.version == 3


def test_batch_conversation(context):
    s, art, conv, call = context
    steps = [{"id": "one", "agentId": "prose.episode_body", "episodeNo": 3,
              "adoptType": "manuscript", "adoptMode": "draft"}]
    assert call("start_studio_batch", steps=[{**steps[0], "dependsOn": ["missing"]}])["error"]
    result = call("start_studio_batch", mode="step", steps=steps)
    group = s.get(AsyncTaskGroup, result["taskGroupId"])
    assert group.conversation_id == conv.id and group.approval_mode == "checkpoint_gate"
    run = s.get(AgentRun, result["runIds"][0])
    assert run.conversation_id == conv.id and run.checkpoint
    assert run.input_json["episodeNo"] == 3 and run.input_json["adoptMode"] == "draft"
    assert call("start_studio_batch", steps=steps)["error"]


def test_batch_preserves_existing_episode(context):
    s, art, conv, call = context
    art.body_json = {"scene_header": " 3 日 内"}
    s.add(art)
    s.commit()
    result = call("start_studio_batch", steps=[{"id": "body", "agentId": "prose.episode_body", "episodeNo": 3}])
    assert "已有稿件" in result["error"]
    assert not s.exec(select(AsyncTaskGroup)).all()


def test_scene_and_structured_edits(context):
    from app.context_refs import artifact_text
    s, art, conv, call = context
    art.type = "scene"
    art.body_json = {"scene_header": "1-1", "script_body": "台词", "wordCount": 2}
    s.add(art)
    s.commit()
    assert call("read_artifact")["bodyMarkdown"] == "台词"
    assert call("save_artifact", expectedVersion=1, bodyMarkdown="新 台词")["versionAfter"] == 2
    assert art.body_json == {"scene_header": "1-1", "script_body": "新 台词", "wordCount": 3}
    assert artifact_text(art) == "新 台词"
    assert call("save_artifact", expectedVersion=1, bodyJson={"scene_header": "2-1"})["error"]
    art.version += 1
    art.type = "character"
    art.body_json = {"name": "旧", "role": "主角"}
    s.add(art)
    s.commit()
    assert call("save_artifact", expectedVersion=3, bodyJson={"name": "新"})["versionAfter"] == 4
    assert art.body_json == {"name": "新", "role": "主角"}


@pytest.mark.parametrize("wrapper", [None, "tool_invoke"])
def test_model_receives_exact_pages(context, wrapper):
    import json
    from app.routers.personal_agent import _compact_history
    s, art, conv, call = context
    art.body_markdown = ('\x01\n正文\\' * 2500)
    s.add(art)
    s.commit()
    offset = 0
    content = ""
    while offset is not None:
        args = {"artifact_id": art.id, "offset": offset}
        target = wrapper or "read_artifact"
        supplied = {"name": "read_artifact", "args": args} if wrapper else args
        text, detail = asyncio.run(_execute_supervisor_tool(target, supplied, s, conv))
        fn = {"name": wrapper or "read_artifact", "arguments": json.dumps(
            {"name": "read_artifact", "args": args} if wrapper else args)}
        result = _compact_history([{"role": "user", "content": "查看正文"}, {"role": "assistant", "tool_calls": [{"id": "r", "function": fn}]},
                                        {"role": "tool", "tool_call_id": "r", "content": text}])
        assert len(text) <= 6000
        page = json.loads(result[-1]["content"])
        content += page["bodyMarkdown"]
        offset = page["nextOffset"]
    assert content == art.body_markdown


def test_paginated_artifact_discovery(context):
    s, art, conv, call = context
    s.add_all(Artifact(project_id=conv.project_id, type="manuscript", title=str(i)) for i in range(51))
    s.commit()
    ids = []
    cursor = None
    while True:
        page = call("list_artifacts", cursor=cursor)
        ids.extend(row["id"] for row in page["artifacts"])
        cursor = page["nextCursor"]
        if cursor is None:
            break
    assert len(ids) == len(set(ids)) == 52


def test_default_checkpoint_and_singleton(context):
    s, art, conv, call = context
    s.delete(art)
    project = s.get(Project, conv.project_id)
    project.format = "short_novel"
    s.add(project)
    s.commit()
    step = {"id": "first", "agentId": "prose.novel_body", "episodeNo": 1}
    assert call("start_studio_batch", steps=[step, {**step, "id": "next", "episodeNo": 2}])["error"]
    result = call("start_studio_batch", steps=[step])
    assert s.get(AsyncTaskGroup, result["taskGroupId"]).approval_mode == "checkpoint_gate"


@pytest.mark.parametrize("mode,expected", [(None, "step"), ("auto", "auto")])
@pytest.mark.parametrize("wrapper", [False, True])
def test_confirmation_receives_effective_batch_mode(mode, expected, wrapper):
    import json
    from app.routers.personal_agent import _route_collaboration_calls
    args = {"steps": []}
    if mode:
        args["mode"] = mode
    fn = {"name": "start_studio_batch", "arguments": json.dumps(args)}
    if wrapper:
        fn = {"name": "invoke_tool", "arguments": json.dumps({"name": "start_studio_batch", "args": args})}
    calls = [{"function": fn}]
    _route_collaboration_calls(calls, [], "p")
    fn = calls[0]["function"]
    normalized = json.loads(fn["arguments"])
    if fn["name"] == "invoke_tool":
        normalized = normalized["args"]
    assert normalized["mode"] == expected


def test_read_typical_chapter_in_one_page(context):
    s, art, conv, call = context
    art.body_markdown = '正文' * 1000
    s.add(art)
    s.commit()
    page = call('read_artifact')
    assert page['bodyMarkdown'] == art.body_markdown
    assert page['nextOffset'] is None
