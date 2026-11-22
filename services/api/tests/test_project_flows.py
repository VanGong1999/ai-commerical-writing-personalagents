from __future__ import annotations

from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine
from starlette.testclient import TestClient
import pytest

from app.db import get_session
from app.main import api, app
from app.models import AnalysisReport, KnowledgeDoc, Project, new_id

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
SQLModel.metadata.create_all(engine)


def override_session():
    with Session(engine) as session:
        yield session


client = TestClient(app)


@pytest.fixture(autouse=True)
def _use_test_session():
    api.dependency_overrides[get_session] = override_session
    yield
    api.dependency_overrides.pop(get_session, None)


def test_default_prompt_pack_ids():
    expected = {
        "manju": "pack.manju.default",
        "duanju": "pack.duanju.default",
        "short_novel": "pack.short.default",
        "male_long": "pack.male.default",
        "female_long": "pack.female.default",
        "ip_adapt": "pack.ip.default",
    }
    for fmt, pack in expected.items():
        res = client.post(
            "/api/v1/projects",
            json={"title": f"test-{fmt}", "format": fmt},
        )
        assert res.status_code == 200, res.text
        assert res.json()["promptPackId"] == pack


def test_core_hook_strong_adopt_stays_before_bio():
    res = client.post(
        "/api/v1/projects",
        json={"title": "核心梗采纳流", "format": "manju"},
    )
    project = res.json()
    hook = client.post(
        f"/api/v1/projects/{project['id']}/artifacts",
        json={
            "type": "core_hook",
            "title": "候选梗",
            "status": "candidate",
            "viaOntologyAction": True,
            "bodyJson": {
                "coreHook": "测试核心梗",
                "motivation": "复仇",
                "crisis": "危机",
                "openingStructure": "开篇结构",
                "tags": ["都市"],
            },
        },
    ).json()
    adopted = client.post(
        f"/api/v1/projects/{project['id']}/artifacts/{hook['id']}/adopt",
        json={"mode": "strong"},
    )
    assert adopted.status_code == 200, adopted.text
    fresh = client.get(f"/api/v1/projects/{project['id']}").json()
    assert fresh["stage"] == "S2_LOGLINE_100"
    assert fresh["progress"].get("S2_HOOK_SELECT") == 1


def test_push_to_project_creates_dissect_artifact():
    with Session(engine) as session:
        doc = KnowledgeDoc(
            id=new_id(),
            title="对标书",
            doc_type="novel",
            status="ready",
            user_id="00000000-0000-4000-8000-000000000001",
        )
        session.add(doc)
        report = AnalysisReport(
            id=new_id(),
            doc_id=doc.id,
            report_type="dissect_params",
            title="拆书参数报告",
            body_markdown="# 拆书参数\n设定/脉络/情绪",
        )
        session.add(report)
        project = Project(
            id=new_id(),
            user_id="00000000-0000-4000-8000-000000000001",
            title="短篇项目",
            format="short_novel",
            stage="S0_SETUP",
            prompt_pack_id="pack.short.default",
        )
        session.add(project)
        session.commit()
        doc_id, project_id = doc.id, project.id

    res = client.post(
        f"/api/v1/kb/docs/{doc_id}/push-to-project",
        json={"projectId": project_id, "mode": "dissect"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["targetType"] == "artifact"
    arts = client.get(f"/api/v1/projects/{project_id}/artifacts").json()
    assert any(a["type"] == "dissect_params" for a in arts)


def test_compose_swap_auto_sources():
    with Session(engine) as session:
        base = KnowledgeDoc(
            id=new_id(),
            title="基准书",
            doc_type="novel",
            status="ready",
            user_id="00000000-0000-4000-8000-000000000001",
        )
        combo = KnowledgeDoc(
            id=new_id(),
            title="来源书",
            doc_type="novel",
            status="ready",
            user_id="00000000-0000-4000-8000-000000000001",
        )
        session.add(base)
        session.add(combo)
        session.add(
            AnalysisReport(
                id=new_id(),
                doc_id=base.id,
                report_type="dissect_params",
                title="拆书参数",
                body_markdown="",
                body_json={
                    "setting": {"protagonist": "原主角", "background": "古代", "goldFinger": "原作系统"},
                    "basic": {"genre": "都市"},
                    "conflicts": ["原作核心冲突"],
                },
            )
        )
        session.add(
            AnalysisReport(
                id=new_id(),
                doc_id=combo.id,
                report_type="dissect_params",
                title="拆书参数",
                body_markdown="",
                body_json={
                    "setting": {"protagonist": "来源主角", "background": "星际", "goldFinger": "来源金手指"},
                    "basic": {"genre": "科幻"},
                    "conflicts": ["来源核心冲突"],
                },
            )
        )
        session.commit()
        base_id, combo_id = base.id, combo.id

    res = client.post(
        f"/api/v1/kb/docs/{base_id}/compose",
        json={"comboDocIds": [combo_id], "degree": "one"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["base"]["docId"] == base_id
    prop = next(r for r in body["mapping"] if r["key"] == "prop")
    assert prop["target"]
    assert prop["sourceDocId"] == combo_id


def test_dashboard_summary_shape():
    client.post(
        "/api/v1/projects",
        json={"title": "看板项目", "format": "manju"},
    )
    res = client.get("/api/v1/dashboard/summary")
    assert res.status_code == 200, res.text
    body = res.json()
    assert {"totals", "byFormat", "byStatus", "usageTrend"} <= set(body)
    assert body["totals"]["projects"] >= 1


