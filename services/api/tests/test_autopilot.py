"""POST /autopilot/start 建任务组 + 同项目并发锁。"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.db import engine, init_db
from app.main import app
from app.models import AgentRun, Artifact, ArtifactFeedback, AsyncTaskGroup, MemoryFile, Project
from app.seed import DEMO_USER
from app import task_daemon as daemon


def setup_module() -> None:
    init_db()


client = TestClient(app)


@pytest.fixture()
def project_id() -> str:
    with Session(engine) as session:
        p = Project(
            title="补全测试书",
            format="manju",
            user_id=DEMO_USER,
            stage="S0_SETUP",
        )
        session.add(p)
        session.commit()
        session.refresh(p)
        return p.id


PLAN = {
    "mode": "auto",
    "steps": [
        {
            "id": "hook",
            "agentId": "topic.core_hook_batch",
            "label": "核心梗",
            "adoptType": "core_hook",
            "adoptMode": "strong",
        },
        {
            "id": "body",
            "agentId": "prose.episode_body",
            "label": "正文",
            "adoptType": "manuscript",
            "adoptMode": "strong",
            "dependsOn": ["hook"],
        },
    ],
}


STEP_PLAN = {
    "mode": "step",
    "steps": [
        {
            "id": "hook",
            "agentId": "topic.core_hook_batch",
            "label": "核心梗",
            "adoptType": "core_hook",
            "adoptMode": "strong",
        },
        {
            "id": "body",
            "agentId": "prose.episode_body",
            "label": "正文",
            "adoptType": "manuscript",
            "adoptMode": "strong",
            "dependsOn": ["hook"],
        },
    ],
}


def test_start_creates_task_group_and_runs(project_id: str) -> None:
    r = client.post(f"/api/v1/autopilot/start?project_id={project_id}", json=PLAN)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["taskGroupId"]
    assert len(body["runIds"]) == 2

    with Session(engine) as session:
        group = session.get(AsyncTaskGroup, body["taskGroupId"])
        assert group is not None
        assert group.kind == "multi_agent"
        assert group.plan_json.get("pipeline") == "autopilot"
        assert group.plan_json.get("projectId") == project_id

        runs = list(
            session.exec(select(AgentRun).where(AgentRun.task_group_id == group.id))
        )
        assert len(runs) == 2
        by_label = {r.label: r for r in runs}
        assert by_label["核心梗"].input_json.get("adoptType") == "core_hook"
        assert by_label["核心梗"].input_json.get("adoptMode") == "strong"
        assert by_label["正文"].input_json.get("adoptType") == "manuscript"
        # dependsOn 本地 id 解析为依赖 run_id
        assert by_label["核心梗"].id in by_label["正文"].depends_on_run_ids


def test_start_same_project_conflict_returns_409(project_id: str) -> None:
    # 用例自足：先建组，再对同项目重复提交触发 409，不依赖前序用例的副作用。
    first = client.post(f"/api/v1/autopilot/start?project_id={project_id}", json=PLAN)
    assert first.status_code == 200, first.text

    second = client.post(f"/api/v1/autopilot/start?project_id={project_id}", json=PLAN)
    assert second.status_code == 409
    assert "该项目已有进行中的补全" in second.json()["detail"]


def test_daemon_adopts_only_run_artifacts() -> None:
    from datetime import datetime, timezone

    with Session(engine) as session:
        p = Project(title="采纳测试书", format="manju", user_id=DEMO_USER, stage="S0_SETUP")
        session.add(p)
        session.commit()
        session.refresh(p)

        run = AgentRun(
            project_id=p.id,
            agent_id="topic.core_hook_batch",
            status="succeeded",
            input_json={"adoptType": "core_hook", "adoptMode": "strong"},
        )
        session.add(run)
        session.commit()
        session.refresh(run)

        # 项目已有 1 条 adopted 的旧产物（与本次 run 无关）
        old_adopted_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
        old = Artifact(
            project_id=p.id,
            type="core_hook",
            title="旧核心梗",
            status="adopted",
            body_json={"motivation": "旧动机", "openingStructure": "旧开篇"},
            created_by_run_id=None,
            adopted_at=old_adopted_at,
        )
        # run 新产出 1 条 core_hook
        fresh = Artifact(
            project_id=p.id,
            type="core_hook",
            title="新核心梗",
            status="draft",
            body_json={"motivation": "复仇逆袭", "openingStructure": "开局即高潮"},
            created_by_run_id=run.id,
        )
        session.add(old)
        session.add(fresh)
        session.commit()
        session.refresh(old)
        session.refresh(fresh)

        adopted = daemon.adopt_post_run(session, run)
        assert adopted == 1

        session.refresh(fresh)
        session.refresh(old)
        # created_by_run_id == run.id 的那条被采纳
        assert fresh.status == "adopted"
        assert fresh.adopted_at is not None
        assert fresh.version == 2
        # 旧产物保持原样、不被改动
        assert old.status == "adopted"
        assert old.version == 1
        assert old.adopted_at == old_adopted_at

        # 幂等：已采纳的不重复计入
        again = daemon.adopt_post_run(session, run)
        assert again == 0
        session.refresh(fresh)
        assert fresh.version == 2


def test_daemon_adopts_core_hook_strong_gate_falls_back_to_draft() -> None:
    with Session(engine) as session:
        p = Project(title="回退测试书", format="manju", user_id=DEMO_USER, stage="S0_SETUP")
        session.add(p)
        session.commit()
        session.refresh(p)

        run = AgentRun(
            project_id=p.id,
            agent_id="topic.core_hook_batch",
            status="succeeded",
            input_json={"adoptType": "core_hook", "adoptMode": "strong"},
        )
        session.add(run)
        session.commit()
        session.refresh(run)

        # 缺动机/开篇：strong 门禁应 fail，回退 draft
        art = Artifact(
            project_id=p.id,
            type="core_hook",
            title="不完整核心梗",
            status="candidate",
            body_json={"titleHook": "无动机无开篇"},
            created_by_run_id=run.id,
        )
        session.add(art)
        session.commit()
        session.refresh(art)

        adopted = daemon.adopt_post_run(session, run)
        assert adopted == 1
        session.refresh(art)
        assert art.status == "draft"
        assert art.adopted_at is not None
        assert art.version == 2


def test_daemon_adopts_core_hook_strong_advances_project_stage() -> None:
    cases = [
        ("manju", "S2_LOGLINE_100"),
        ("short_novel", "S2_SWAP"),
    ]
    for fmt, expected_stage in cases:
        with Session(engine) as session:
            p = Project(title=f"推进阶段书-{fmt}", format=fmt, user_id=DEMO_USER, stage="S0_SETUP")
            session.add(p)
            session.commit()
            session.refresh(p)

            run = AgentRun(
                project_id=p.id,
                agent_id="topic.core_hook_batch",
                status="succeeded",
                input_json={"adoptType": "core_hook", "adoptMode": "strong"},
            )
            session.add(run)
            session.commit()
            session.refresh(run)

            art = Artifact(
                project_id=p.id,
                type="core_hook",
                title="完整核心梗",
                status="draft",
                body_json={"motivation": "复仇", "openingStructure": "开局即高潮"},
                created_by_run_id=run.id,
            )
            session.add(art)
            session.commit()
            session.refresh(art)

            assert daemon.adopt_post_run(session, run) == 1

            session.refresh(p)
            assert p.progress.get("S2_HOOK_SELECT") == 1
            assert p.stage == expected_stage


def test_daemon_adopts_skips_without_adopt_type() -> None:
    with Session(engine) as session:
        p = Project(title="无采纳配置书", format="manju", user_id=DEMO_USER, stage="S0_SETUP")
        session.add(p)
        session.commit()
        session.refresh(p)

        run = AgentRun(
            project_id=p.id,
            agent_id="topic.core_hook_batch",
            status="succeeded",
            input_json={"assistantPrompt": "无 adoptType"},
        )
        session.add(run)
        session.commit()
        session.refresh(run)

        art = Artifact(
            project_id=p.id,
            type="core_hook",
            title="不应被采纳",
            status="candidate",
            body_json={"motivation": "动机", "openingStructure": "开篇"},
            created_by_run_id=run.id,
        )
        session.add(art)
        session.commit()
        session.refresh(art)

        assert daemon.adopt_post_run(session, run) == 0
        session.refresh(art)
        assert art.status == "candidate"
        assert art.version == 1
        assert art.adopted_at is None


def _new_project(session: Session, title: str) -> Project:
    p = Project(title=title, format="manju", user_id=DEMO_USER, stage="S0_SETUP")
    session.add(p)
    session.commit()
    session.refresh(p)
    return p


def test_enqueue_injects_upstream_context() -> None:
    with Session(engine) as session:
        p = _new_project(session, "上游上下文测试书")

        session.add(
            Artifact(
                project_id=p.id,
                type="core_hook",
                title="核心梗",
                status="adopted",
                body_markdown="钩子文本",
                body_json={"coreHook": "备选钩子", "titleHook": "标题钩"},
            )
        )
        session.add(Artifact(project_id=p.id, type="character", title="主角", body_markdown="主角小传"))
        session.add(Artifact(project_id=p.id, type="character", title="反派", body_markdown="反派小传"))
        session.add(
            Artifact(project_id=p.id, type="episode_outline", title="EP01", body_markdown="第1集 大纲")
        )
        session.commit()

        run = AgentRun(
            project_id=p.id,
            agent_id="prose.episode_body",
            status="pending_deps",
            input_json={"format": "manju", "adoptType": "manuscript", "adoptMode": "strong"},
        )
        session.add(run)
        session.commit()
        session.refresh(run)

        daemon._enqueue_run(session, run)

        session.refresh(run)
        assert run.input_json.get("hook") == "钩子文本"
        assert "主角小传" in (run.input_json.get("bio") or "")
        assert (run.input_json.get("outline") or "").strip()
        assert run.input_json.get("count") == 3
        assert run.input_json.get("wordTarget") == {"min": 800, "max": 1200, "target": 1000}

        job = daemon._find_job_for_run(session, run.id)
        assert job is not None
        payload_input = (job.payload or {}).get("input") or {}
        assert payload_input.get("hook") == "钩子文本"
        assert "主角小传" in (payload_input.get("bio") or "")


def test_enqueue_injects_char_and_outline_upstream() -> None:
    with Session(engine) as session:
        p = _new_project(session, "角色大纲测试书")

        session.add(
            Artifact(project_id=p.id, type="core_hook", title="核心梗", status="adopted", body_markdown="钩子文本")
        )
        session.add(Artifact(project_id=p.id, type="character", title="主角", body_markdown="主角小传"))
        session.commit()

        char_run = AgentRun(
            project_id=p.id, agent_id="char.bio_manju", status="pending_deps", input_json={"format": "manju"}
        )
        outline_run = AgentRun(
            project_id=p.id, agent_id="struct.episode_outline", status="pending_deps", input_json={"format": "manju"}
        )
        session.add(char_run)
        session.add(outline_run)
        session.commit()
        session.refresh(char_run)
        session.refresh(outline_run)

        daemon._enqueue_run(session, char_run)
        daemon._enqueue_run(session, outline_run)

        session.refresh(char_run)
        session.refresh(outline_run)
        assert char_run.input_json.get("hook") == "钩子文本"
        assert "bio" not in char_run.input_json
        assert outline_run.input_json.get("hook") == "钩子文本"
        assert "主角小传" in (outline_run.input_json.get("bio") or "")


def test_enqueue_injects_qc_text() -> None:
    with Session(engine) as session:
        p = _new_project(session, "质检文本测试书")

        session.add(
            Artifact(project_id=p.id, type="manuscript", title="EP01 正文", body_markdown="第1集正文内容")
        )
        session.commit()

        run = AgentRun(
            project_id=p.id,
            agent_id="qc.de_ai",
            status="pending_deps",
            input_json={"format": "manju", "adoptType": "qc_report", "adoptMode": "strong"},
        )
        session.add(run)
        session.commit()
        session.refresh(run)

        daemon._enqueue_run(session, run)

        session.refresh(run)
        assert (run.input_json.get("text") or "").startswith("第1集正文内容")


def test_enqueue_injects_memory_upstream() -> None:
    with Session(engine) as session:
        p = _new_project(session, "记忆上下文测试书")

        session.add(
            MemoryFile(
                path=f"/memories/projects/{p.id}/bible.md",
                user_id=DEMO_USER,
                project_id=p.id,
                content="# 圣经\n世界设定",
            )
        )
        session.add(
            MemoryFile(
                path=f"/memories/projects/{p.id}/journal-ep1.md",
                user_id=DEMO_USER,
                project_id=p.id,
                content="第1集剧情",
            )
        )
        session.add(
            Artifact(project_id=p.id, type="world_setting", title="世界观", body_markdown="这是世界观设定")
        )
        session.commit()

        run = AgentRun(
            project_id=p.id, agent_id="char.bio_manju", status="pending_deps", input_json={"format": "manju"}
        )
        session.add(run)
        session.commit()
        session.refresh(run)

        daemon._enqueue_run(session, run)

        session.refresh(run)
        assert "圣经" in (run.input_json.get("bible") or "")
        assert "第1集剧情" in (run.input_json.get("journal") or "")
        assert (run.input_json.get("setting") or "").startswith("这是世界观设定")


def test_enqueue_injects_memory_upstream_with_path_fallback() -> None:
    """MemoryFile.project_id 为空、仅 path 携带项目 id 的记录，也应被 bible/journal 命中。"""
    with Session(engine) as session:
        p = _new_project(session, "路径回退记忆测试书")

        session.add(
            MemoryFile(
                path=f"/memories/projects/{p.id}/bible.md",
                user_id=DEMO_USER,
                project_id=None,
                content="# 圣经\n世界设定",
            )
        )
        session.commit()

        run = AgentRun(
            project_id=p.id, agent_id="char.bio_manju", status="pending_deps", input_json={"format": "manju"}
        )
        session.add(run)
        session.commit()
        session.refresh(run)

        daemon._enqueue_run(session, run)

        session.refresh(run)
        assert "圣经" in (run.input_json.get("bible") or "")


def test_enqueue_uses_project_format_short_novel() -> None:
    """非脚本格式：format 应从 Project 读取（而非 input_json 默认 manju），outline 用 chapter_outline、wordTarget 2000-3000、count=1。"""
    with Session(engine) as session:
        p = Project(title="短篇格式测试书", format="short_novel", user_id=DEMO_USER, stage="S0_SETUP")
        session.add(p)
        session.commit()
        session.refresh(p)

        session.add(
            Artifact(project_id=p.id, type="core_hook", title="核心梗", status="adopted", body_markdown="钩子文本")
        )
        session.add(Artifact(project_id=p.id, type="character", title="主角", body_markdown="主角小传"))
        session.add(
            Artifact(project_id=p.id, type="chapter_outline", title="章纲", body_markdown="第1章 大纲")
        )
        session.commit()

        run = AgentRun(
            project_id=p.id,
            agent_id="prose.novel_body",
            status="pending_deps",
            # 故意不带 format：应回退到 Project.format
            input_json={"adoptType": "manuscript", "adoptMode": "strong"},
        )
        session.add(run)
        session.commit()
        session.refresh(run)

        daemon._enqueue_run(session, run)

        session.refresh(run)
        assert run.input_json.get("wordTarget") == {"min": 2000, "max": 3000, "target": 2000}
        assert run.input_json.get("count") == 1
        assert (run.input_json.get("outline") or "").startswith("第1章 大纲")


def test_enqueue_uses_project_format_duanju() -> None:
    """duanju：正文产物为 scene（script_body），outline 用 episode_outline，wordTarget 脚本口径、count=3。"""
    with Session(engine) as session:
        p = Project(title="短剧格式测试书", format="duanju", user_id=DEMO_USER, stage="S0_SETUP")
        session.add(p)
        session.commit()
        session.refresh(p)

        session.add(
            Artifact(project_id=p.id, type="episode_outline", title="EP01", body_markdown="第1集 大纲")
        )
        session.add(
            Artifact(project_id=p.id, type="scene", title="场1", body_json={"script_body": "场1正文"})
        )
        session.commit()

        body_run = AgentRun(
            project_id=p.id,
            agent_id="orch.batch_writer",
            status="pending_deps",
            input_json={"adoptType": "scene"},
        )
        session.add(body_run)
        session.commit()
        session.refresh(body_run)

        daemon._enqueue_run(session, body_run)
        session.refresh(body_run)
        assert body_run.input_json.get("wordTarget") == {"min": 800, "max": 1200, "target": 1000}
        assert body_run.input_json.get("count") == 3
        assert (body_run.input_json.get("outline") or "").startswith("第1集 大纲")

        qc_run = AgentRun(
            project_id=p.id,
            agent_id="qc.revise20",
            status="pending_deps",
            input_json={"adoptType": "qc_report"},
        )
        session.add(qc_run)
        session.commit()
        session.refresh(qc_run)

        daemon._enqueue_run(session, qc_run)
        session.refresh(qc_run)
        assert (qc_run.input_json.get("text") or "").startswith("场1正文")


def test_enqueue_skips_non_autopilot_runs() -> None:
    """非补全 run（无 adoptType、非 char/outline agent）不应被注入 hook/bio/memory 上下文。"""
    with Session(engine) as session:
        p = _new_project(session, "非补全任务测试书")

        session.add(
            Artifact(project_id=p.id, type="core_hook", title="核心梗", status="adopted", body_markdown="钩子文本")
        )
        session.add(Artifact(project_id=p.id, type="character", title="主角", body_markdown="主角小传"))
        session.add(
            MemoryFile(
                path=f"/memories/projects/{p.id}/bible.md",
                user_id=DEMO_USER,
                project_id=p.id,
                content="# 圣经\n世界设定",
            )
        )
        session.commit()

        run = AgentRun(
            project_id=p.id,
            agent_id="topic.core_hook_batch",
            status="pending_deps",
            input_json={"assistantPrompt": "写核心梗", "label": "核心梗"},
        )
        session.add(run)
        session.commit()
        session.refresh(run)

        daemon._enqueue_run(session, run)

        session.refresh(run)
        assert "hook" not in run.input_json
        assert "bio" not in run.input_json
        assert "bible" not in run.input_json


def test_step_mode_waits_approval_and_reject_blocks_next(project_id: str) -> None:
    """mode="step"（checkpoint_gate + 每步 checkpoint）应停等审批；驳回第 1 步不解锁第 2 步。"""
    r = client.post(f"/api/v1/autopilot/start?project_id={project_id}", json=STEP_PLAN)
    assert r.status_code == 200, r.text
    run_ids = r.json()["runIds"]
    assert len(run_ids) == 2
    run1_id, run2_id = run_ids

    # 触发 daemon tick 后：第 1 步进入 waiting，第 2 步仍 pending_deps
    with Session(engine) as session:
        daemon.tick(session)

        run1 = session.get(AgentRun, run1_id)
        run2 = session.get(AgentRun, run2_id)
        assert run1 is not None and run2 is not None
        assert run1.approval_state == "waiting"
        assert run1.status == "pending_deps"
        assert run1.checkpoint is True
        assert run2.status == "pending_deps"
        assert run1.id in (run2.depends_on_run_ids or [])

    # 驳回第 1 步：第 2 步不得被解锁进入 queued
    res = client.post(f"/api/v1/tasks/runs/{run1_id}/approve", json={"approve": False})
    assert res.status_code == 200, res.text

    with Session(engine) as session:
        run1 = session.get(AgentRun, run1_id)
        run2 = session.get(AgentRun, run2_id)
        assert run1 is not None and run2 is not None
        assert run1.status == "cancelled"
        assert run1.approval_state == "rejected"
        assert run2.status == "pending_deps"


def test_auto_mode_first_step_body_gets_upstream() -> None:
    """Critical 1：项目已有 hook/人设/大纲、只差正文时，首步就是 body。

    adoptType 必须在 run 创建时（input_extra）就已入 input_json，create_task_group 末尾的
    首次 tick 才能给正文注入 hook/bio/outline，而不是以空上游入队。
    """
    with Session(engine) as session:
        p = _new_project(session, "首步正文补全测试书")
        session.add(
            Artifact(project_id=p.id, type="core_hook", title="核心梗", status="adopted", body_markdown="钩子文本")
        )
        session.add(Artifact(project_id=p.id, type="character", title="主角", body_markdown="主角小传"))
        session.add(Artifact(project_id=p.id, type="episode_outline", title="EP01", body_markdown="第1集 大纲"))
        session.commit()
        pid = p.id

    plan = {
        "mode": "auto",
        "steps": [
            {
                "id": "body",
                "agentId": "prose.episode_body",
                "label": "正文",
                "adoptType": "manuscript",
                "adoptMode": "strong",
            },
        ],
    }
    r = client.post(f"/api/v1/autopilot/start?project_id={pid}", json=plan)
    assert r.status_code == 200, r.text
    run_id = r.json()["runIds"][0]

    with Session(engine) as session:
        run = session.get(AgentRun, run_id)
        assert run is not None
        assert run.input_json.get("adoptType") == "manuscript"
        assert run.input_json.get("hook") == "钩子文本"
        assert "主角小传" in (run.input_json.get("bio") or "")
        assert (run.input_json.get("outline") or "").startswith("第1集 大纲")

        job = daemon._find_job_for_run(session, run.id)
        assert job is not None
        payload_input = (job.payload or {}).get("input") or {}
        assert payload_input.get("hook") == "钩子文本"
        assert (payload_input.get("outline") or "").startswith("第1集 大纲")


def test_autopilot_payload_uses_project_format_duanju() -> None:
    """Important 2：非 manju 格式的项目，payload/input_json 的 format 应为项目真实格式。"""
    with Session(engine) as session:
        p = Project(title="短剧补全测试书", format="duanju", user_id=DEMO_USER, stage="S0_SETUP")
        session.add(p)
        session.commit()
        session.refresh(p)
        pid = p.id

    plan = {
        "mode": "auto",
        "steps": [
            {
                "id": "topic",
                "agentId": "topic.want_how",
                "label": "选题三问",
                "adoptType": "topic_card",
                "adoptMode": "strong",
            },
        ],
    }
    r = client.post(f"/api/v1/autopilot/start?project_id={pid}", json=plan)
    assert r.status_code == 200, r.text
    run_id = r.json()["runIds"][0]

    with Session(engine) as session:
        run = session.get(AgentRun, run_id)
        assert run is not None
        assert run.input_json.get("format") == "duanju"
        job = daemon._find_job_for_run(session, run.id)
        payload_input = (job.payload or {}).get("input") or {}
        assert payload_input.get("format") == "duanju"


def test_autopilot_plan_carries_adopt_types_for_aux_steps() -> None:
    """Important 4：char/outline/选题/金手指/卷纲/四件套 等辅助步骤补 adoptType 后，
    建组时应把 adoptType 带进 run.input_json（供 daemon 采纳写回原处）。"""
    with Session(engine) as session:
        p = _new_project(session, "辅助步骤采纳测试书")
        pid = p.id

    plan = {
        "mode": "auto",
        "steps": [
            {
                "id": "char",
                "agentId": "char.bio_manju",
                "label": "人物小传",
                "adoptType": "character",
                "adoptMode": "strong",
            },
            {
                "id": "outline",
                "agentId": "struct.episode_outline",
                "label": "大纲",
                "adoptType": "episode_outline",
                "adoptMode": "strong",
                "dependsOn": ["char"],
            },
            {
                "id": "pitch",
                "agentId": "deliver.pitch_pack",
                "label": "四件套",
                "adoptType": "other",
                "adoptMode": "strong",
                "dependsOn": ["outline"],
            },
        ],
    }
    r = client.post(f"/api/v1/autopilot/start?project_id={pid}", json=plan)
    assert r.status_code == 200, r.text
    run_ids = r.json()["runIds"]
    assert len(run_ids) == 3

    with Session(engine) as session:
        runs = [session.get(AgentRun, rid) for rid in run_ids]
        by_label = {r.label: r for r in runs}
        assert by_label["人物小传"].input_json.get("adoptType") == "character"
        assert by_label["大纲"].input_json.get("adoptType") == "episode_outline"
        assert by_label["四件套"].input_json.get("adoptType") == "other"


def test_adopt_post_run_aux_artifact_types() -> None:
    """Important 4：adopt_post_run 对 character/episode_outline/other 等类型也采纳写回。"""
    cases = [
        ("char.bio_manju", "character", "人物小传"),
        ("struct.episode_outline", "episode_outline", "大纲"),
        ("deliver.pitch_pack", "other", "四件套"),
        ("topic.want_how", "topic_card", "选题卡"),
    ]
    for agent_id, art_type, title in cases:
        with Session(engine) as session:
            p = _new_project(session, f"{title}-采纳测试书")
            run = AgentRun(
                project_id=p.id,
                agent_id=agent_id,
                status="succeeded",
                input_json={"adoptType": art_type, "adoptMode": "strong"},
            )
            session.add(run)
            session.commit()
            session.refresh(run)

            art = Artifact(
                project_id=p.id,
                type=art_type,
                title=title,
                status="draft",
                body_markdown="正文内容",
                created_by_run_id=run.id,
            )
            session.add(art)
            session.commit()
            session.refresh(art)

            assert daemon.adopt_post_run(session, run) == 1
            session.refresh(art)
            assert art.status == "adopted"
            assert art.adopted_at is not None


def test_enqueue_injects_exemplars_for_body() -> None:
    """Important 5：正文步骤入队时注入人工偏好好坏例（对齐前端 GET /eval/exemplars）。"""
    with Session(engine) as session:
        p = _new_project(session, "好坏例注入测试书")
        session.add(
            ArtifactFeedback(
                artifact_id="art-x",
                project_id=p.id,
                format="manju",
                artifact_type="manuscript",
                span_text="好例文本片段",
                polarity="good",
            )
        )
        session.commit()

        run = AgentRun(
            project_id=p.id,
            agent_id="prose.episode_body",
            status="pending_deps",
            input_json={"format": "manju", "adoptType": "manuscript", "adoptMode": "strong"},
        )
        session.add(run)
        session.commit()
        session.refresh(run)

        daemon._enqueue_run(session, run)

        session.refresh(run)
        exemplars = run.input_json.get("exemplars")
        assert exemplars is not None
        assert "好例文本片段" in exemplars["text"]

        job = daemon._find_job_for_run(session, run.id)
        payload_input = (job.payload or {}).get("input") or {}
        assert "好例文本片段" in (payload_input.get("exemplars") or {}).get("text", "")
