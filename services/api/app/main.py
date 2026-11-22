from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlmodel import Session

from .db import engine, init_db
from .local_access import LocalAccessMiddleware
from .gate_bridge import GateEngineError, close_gate_engine
from .routers import (
    agents_catalog,
    feedback_loop,
    assistant,
    autopilot,
    bots,
    crawler,
    context,
    eval as eval_router,
    export,
    fs,
    jobs,
    kb,
    llm,
    memory_ext,
    misc,
    ontology,
    personal_agent,
    projects,
    quality,
    tasks,
    workbench,
)
from .seed import ensure_reference_data, seed_if_empty
from .settings import get_settings


class CamelJSONResponse(JSONResponse):
    def render(self, content: Any) -> bytes:
        def convert(obj: Any) -> Any:
            if isinstance(obj, BaseModel):
                return obj.model_dump(by_alias=True, mode="json")
            if isinstance(obj, list):
                return [convert(i) for i in obj]
            if isinstance(obj, dict):
                return {k: convert(v) for k, v in obj.items()}
            return obj

        return super().render(convert(content))


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    settings = get_settings()
    if settings.seed_on_start:
        with Session(engine) as session:
            seed_if_empty(session)
            ensure_reference_data(session)
    from .inbox_pump import start_inbox_pump, stop_inbox_pump
    from .confirm_autoresponder import start_confirm_autoresponder, stop_confirm_autoresponder

    start_inbox_pump()
    start_confirm_autoresponder()
    try:
        yield
    finally:
        await stop_confirm_autoresponder()
        await stop_inbox_pump()
        close_gate_engine()


settings = get_settings()

app = FastAPI(
    title="AI 商业写作台 API",
    version="0.2.0",
    lifespan=lifespan,
    default_response_class=CamelJSONResponse,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(LocalAccessMiddleware, settings=settings)

api = FastAPI(default_response_class=CamelJSONResponse)


@api.exception_handler(GateEngineError)
async def gate_engine_unavailable(_request, _error: GateEngineError):
    return CamelJSONResponse(status_code=503, content={"detail": {
        "code": "gate_engine_unavailable",
        "message": "共享 Gate 引擎不可用，未批准本次操作；请检查 Node.js 与规则文件后重试。",
    }})


api.include_router(feedback_loop.router)
api.include_router(context.router)
api.include_router(projects.router)
api.include_router(ontology.router)
api.include_router(export.router)
api.include_router(jobs.router)
api.include_router(kb.router)
api.include_router(misc.router)
api.include_router(memory_ext.router)
api.include_router(workbench.inspirations_router)
api.include_router(workbench.swap_plans_router)
api.include_router(workbench.analytics_router)
api.include_router(quality.router)
api.include_router(eval_router.router)
api.include_router(crawler.router)
api.include_router(llm.router)
api.include_router(agents_catalog.router)
api.include_router(assistant.router)
api.include_router(autopilot.router)
api.include_router(personal_agent.router)
api.include_router(bots.router)
api.include_router(tasks.router)
api.include_router(fs.router)
app.mount("/api/v1", api)


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "database": "sqlite" if settings.is_sqlite else "postgres",
        "version": "0.2.0",
    }
