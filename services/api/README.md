# services/api

FastAPI + SQLite 开发骨架。

```bash
cd services/api
uv sync
uv run uvicorn app.main:app --reload --port 8000
# OpenAPI: http://127.0.0.1:8000/docs
uv run pytest
```
