"""SQLite 并发连接回归：NullPool + WAL 下并发请求不得出现连接池 502。"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient
from sqlalchemy.pool import NullPool

from app.db import engine, init_db
from app.main import app


def test_sqlite_engine_uses_nullpool():
    init_db()
    # 根因回归：QueuePool(5+10) 溢出是 502「connection timed out」的来源。
    assert isinstance(engine.pool, NullPool)


def test_concurrent_requests_no_pool_exhaustion():
    init_db()
    client = TestClient(app)

    def create_hotspot(i: int) -> int:
        resp = client.post(
            "/api/v1/kb/hotspots",
            json={
                "title": f"并发热点-{i}",
                "genre": "重生",
                "source": "并发测试",
                "summary": f"summary-{i}",
            },
        )
        assert resp.status_code == 200, resp.text
        return resp.json()["id"]

    def read_usage(i: int) -> int:
        resp = client.get("/api/v1/usage")
        assert resp.status_code == 200, resp.text
        return len(resp.json())

    # 24 个并发请求混读写（旧 QueuePool 会在此场景 30s 超时报 502）。
    with ThreadPoolExecutor(max_workers=24) as pool:
        futures = [pool.submit(create_hotspot, i) for i in range(12)]
        futures += [pool.submit(read_usage, i) for i in range(12)]
        results = [f.result(timeout=60) for f in futures]
    ids = results[:12]
    assert len(set(ids)) == 12

    # 清理测试数据
    for hotspot_id in ids:
        resp = client.delete(f"/api/v1/kb/hotspots/{hotspot_id}")
        assert resp.status_code == 200
