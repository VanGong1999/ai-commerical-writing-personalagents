from pathlib import Path

from starlette.testclient import TestClient

from app.main import app

FIXTURE = Path(__file__).parent / "fixtures" / "xiyou_sample.docx"


def test_upload_docx_creates_doc_and_job():
    assert FIXTURE.exists(), "missing xiyou_sample.docx fixture"
    client = TestClient(app)
    with FIXTURE.open("rb") as f:
        res = client.post(
            "/api/v1/kb/docs?title=西游测试&doc_type=novel",
            files={"file": ("xiyou_sample.docx", f, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
        )
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["title"] == "西游测试"
    assert data["id"]
    # analyze enqueue
    res2 = client.post(f"/api/v1/kb/docs/{data['id']}/analyze")
    assert res2.status_code == 200
    assert res2.json()["jobId"]


def test_search_partition_shape():
    client = TestClient(app)
    res = client.get("/api/v1/kb/search", params={"q": "玉帝"})
    assert res.status_code == 200
    body = res.json()
    assert "docs" in body
    assert "local" in body
    assert "answer" in body
