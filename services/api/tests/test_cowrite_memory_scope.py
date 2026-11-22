import asyncio
from types import SimpleNamespace
from sqlmodel import Session
from app.models import MemoryFile, Project
from app.routers import assistant
from test_llm_provider_routing import _routing_engine


def test_cowrite_context_uses_shared_project_memory(monkeypatch):
    captured = []
    async def capture(messages, **kwargs):
        captured.append(messages[-1]["content"])
        return SimpleNamespace(content="测试正文", model="mock", raw={})
    monkeypatch.setattr(assistant, "chat_completion", capture)
    monkeypatch.setattr(assistant, "record_model_usage", lambda *args, **kwargs: None)
    with Session(_routing_engine()) as session:
        project = Project(title="上下文", user_id="writer", format="manju", stage="S0_SETUP")
        session.add(project)
        for path, user, marker in [("world.md","writer","WORLD"), ("journal/ep1.md","writer","JOURNAL"),
                ("procedural/other/secret.md","writer","PRIVATE"), ("foreign.md","other","FOREIGN"), ("timeline.md","writer","FLAGGED"), ("hypothesis:ending.md","writer","LEGACY")]:
            session.add(MemoryFile(path=f"/memories/projects/{project.id}/{path}",
                user_id=user, project_id=project.id, content=marker, is_hypothesis=marker=="FLAGGED"))
        session.commit()
        asyncio.run(assistant.cowrite_impl(session, assistant.CowriteIn(text="原文",project_id=project.id)))
    assert "WORLD" in captured[0] and "JOURNAL" in captured[0]
    assert "PRIVATE" not in captured[0] and "FOREIGN" not in captured[0]
    assert "FLAGGED" not in captured[0] and "LEGACY" not in captured[0]
