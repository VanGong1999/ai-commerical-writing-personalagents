from __future__ import annotations

import asyncio

from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine
import pytest

from app.db import get_session
from app.main import api, app
from app.models import Artifact, Conversation, MemoryFile, Project, TaskProposal, new_id
from app.routers.personal_agent import _execute_supervisor_tool, _parse_tool_args, _requires_confirm
from app.seed import DEMO_USER

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
SQLModel.metadata.create_all(engine)


def override_session():
    with Session(engine) as session:
        yield session


@pytest.fixture(autouse=True)
def _use_test_session():
    api.dependency_overrides[get_session] = override_session
    yield
    api.dependency_overrides.pop(get_session, None)


def test_requires_confirm():
    assert _requires_confirm("adopt_artifact", {}) is not None
    assert _requires_confirm("create_fleet", {}) is not None
    assert _requires_confirm("run_agent", {"instruction": "写正文"}) is not None
    assert _requires_confirm("run_agent", {"instruction": "生成核心梗"}) is None
    assert _requires_confirm("search_knowledge", {}) is None


def test_supervisor_channels_keep_historical_status_below_current_approval():
    from app.routers.personal_agent import FEISHU_IM_HINT, SUPERVISOR_SYSTEM

    for system in (SUPERVISOR_SYSTEM, SUPERVISOR_SYSTEM + FEISHU_IM_HINT):
        assert "状态仅反映记录时点" in system
        assert "持久化审批或 QA 签阅凭据" in system
        assert "项目、审批类型和来源版本" in system
        assert "查不到、范围或版本不匹配时仍为待确认" in system
        assert "无权读取时说明无法核实" in system


def test_get_project_reads_only_requested_qa_and_current_source_versions():
    with Session(engine) as session:
        project = Project(user_id=DEMO_USER, title="审批依据", format="manju", stage="S10_HUMAN_QC")
        session.add(project)
        session.commit()
        body = Artifact(project_id=project.id, type="manuscript", title="旧文档", body_markdown="待确认", version=1)
        report = Artifact(project_id=project.id, type="qc_report", title="六检", version=1)
        session.add_all([body, report])
        session.commit()
        approval = {"runId": "qa-current", "projectId": project.id,
                    "sources": {body.id: 1}, "reports": {report.id: 1}}
        project.progress = {"pipelineQaApprovals": {"qa-current": approval, "qa-other": {"private": "不加载"}}}
        session.add(project)
        session.commit()
        conv = Conversation(user_id=DEMO_USER, project_id=project.id)
        _, overview = asyncio.run(_execute_supervisor_tool("get_project", {}, session, conv))
        assert "approvalEvidence" not in overview
        _, detail = asyncio.run(_execute_supervisor_tool("get_project", {"qa_run_id": "qa-current"}, session, conv))
        evidence = detail["approvalEvidence"]
        assert evidence["recordedApproval"] == approval
        assert evidence["currentVersions"] == {body.id: 1, report.id: 1}
        assert "qa-other" not in str(detail)
        assert body.body_markdown == "待确认"
        body.version = 2
        session.add(body)
        session.commit()
        _, changed = asyncio.run(_execute_supervisor_tool("get_project", {"qa_run_id": "qa-current"}, session, conv))
        assert changed["approvalEvidence"]["recordedApproval"]["sources"][body.id] == 1
        assert changed["approvalEvidence"]["currentVersions"][body.id] == 2
        _, missing = asyncio.run(_execute_supervisor_tool("get_project", {"qa_run_id": "not-signed"}, session, conv))
        assert missing["approvalEvidence"]["recordedApproval"] is None
        assert missing["approvalEvidence"]["currentVersions"] == {}


def test_get_project_does_not_expose_foreign_owner_approvals():
    with Session(engine) as session:
        project = Project(user_id="another-user", title="其他用户", format="manju", stage="S10_HUMAN_QC", progress={"pipelineQaApprovals": {"secret": {}}})
        session.add(project)
        session.commit()
        conv = Conversation(user_id=DEMO_USER)
        _, detail = asyncio.run(_execute_supervisor_tool("get_project", {"project_id": project.id, "qa_run_id": "secret"}, session, conv))
        assert "project" not in detail
        assert "approvalEvidence" not in detail


def test_search_tools_and_invoke():
    from app.routers.personal_agent import CORE_SUPERVISOR_TOOLS, _TOOL_INDEX

    names = {(t.get("function") or {}).get("name") for t in CORE_SUPERVISOR_TOOLS}
    assert "tool_search" in names
    assert "search_tools" in _TOOL_INDEX  # 旧名别名
    assert "invoke_tool" in _TOOL_INDEX
    assert "create_fleet" in _TOOL_INDEX


def test_parse_tool_args():
    assert _parse_tool_args({"function": {"arguments": '{"query": "换元"}'}}) == {"query": "换元"}
    assert _parse_tool_args({"function": {"arguments": {"query": "换元"}}}) == {"query": "换元"}
    bad = _parse_tool_args({"function": {"arguments": "bad json"}})
    assert bad.get("_parse_error")


def test_execute_list_and_adopt():
    with Session(engine) as session:
        project = Project(
            user_id=DEMO_USER,
            title="测试项目",
            format="manju",
            genre_tags=[],
            market="cn",
            stage="S0_SETUP",
            status="draft",
        )
        session.add(project)
        session.commit()
        session.refresh(project)

        conv = Conversation(user_id=DEMO_USER, source="assistant", title="t", project_id=project.id)
        session.add(conv)
        session.commit()
        session.refresh(conv)

        art = Artifact(project_id=project.id, type="core_hook", title="核心梗", status="candidate")
        session.add(art)
        session.commit()
        session.refresh(art)

        text, detail = asyncio.run(_execute_supervisor_tool("list_projects", {}, session, conv))
        assert "测试项目" in text

        text, detail = asyncio.run(
            _execute_supervisor_tool(
                "adopt_artifact",
                {"project_id": project.id, "artifact_id": art.id, "mode": "strong", "expectedVersion": art.version},
                session,
                conv,
            )
        )
        assert detail["artifact"]["status"] == "adopted"
        session.refresh(art)
        assert art.status == "adopted"


def test_execute_list_proposals_uses_message_field():
    with Session(engine) as session:
        project = Project(user_id=DEMO_USER, title="P", format="manju", stage="S0_SETUP")
        session.add(project)
        session.commit()
        session.refresh(project)
        conv = Conversation(user_id=DEMO_USER, source="assistant", title="t", project_id=project.id)
        session.add(conv)
        session.commit()
        session.refresh(conv)
        session.add(TaskProposal(type="colleague.proactive", message="写正文", project_id=project.id))
        session.commit()

        text, detail = asyncio.run(_execute_supervisor_tool("list_proposals", {"project_id": project.id}, session, conv))
        assert "写正文" in text


def test_execute_create_project_and_write_memory():
    with Session(engine) as session:
        conv = Conversation(user_id=DEMO_USER, source="assistant", title="t")
        session.add(conv)
        session.commit()
        session.refresh(conv)

        text, detail = asyncio.run(
            _execute_supervisor_tool("create_project", {"title": "新书", "format": "manju"}, session, conv)
        )
        assert "已新建项目" in text
        pid = detail["project"]["id"]
        # stage 必须已设置（修复前会因缺 stage 报错）
        assert detail["project"]["stage"] == "S0_SETUP"

        text, detail = asyncio.run(
            _execute_supervisor_tool("write_memory", {"project_id": pid, "name": "人物", "content": "主角是侦探"}, session, conv)
        )
        assert "已写入记忆" in text
        mem = session.get(MemoryFile, f"/memories/projects/{pid}/人物.md")
        assert mem is not None and "侦探" in mem.content


def test_write_memory_requires_hash_to_overwrite_existing():
    with Session(engine) as session:
        conv = Conversation(user_id=DEMO_USER, source="assistant", title="t2")
        session.add(conv)
        session.commit()
        session.refresh(conv)
        args = {"project_id": "pg1", "name": "decisions", "content": "v1"}
        text, _ = asyncio.run(_execute_supervisor_tool("write_memory", args, session, conv))
        assert "已写入记忆" in text
        # 覆盖已存在且内容不同：无 hash → 拒绝，并返回当前 hash
        text, detail = asyncio.run(
            _execute_supervisor_tool("write_memory", {**args, "content": "v2"}, session, conv)
        )
        assert detail.get("needs_hash") is True
        mem = session.get(MemoryFile, "/memories/projects/pg1/decisions.md")
        assert mem.content == "v1"
        # 带正确 hash → 通过
        text, _ = asyncio.run(
            _execute_supervisor_tool(
                "write_memory", {**args, "content": "v2", "expected_hash": mem.hash}, session, conv
            )
        )
        assert "已写入记忆" in text
        session.refresh(mem)
        assert mem.content == "v2"
