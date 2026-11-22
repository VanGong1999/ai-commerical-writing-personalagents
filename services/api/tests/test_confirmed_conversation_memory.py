from sqlmodel import Session, SQLModel, create_engine

from app.agent_inbox import inbox_event_actions
from app.memory_service import hybrid_search_memory
from app.models import AgentEvent, Conversation, MemoryFile, Message, Project
from app.routers.memory_ext import create_dream, merge_dream, patch_dream_change
from app.schemas import DreamChangePatchIn, DreamCreateIn
from app.seed import DEMO_USER


def test_confirmed_conversation_memory():
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        project = Project(title="样稿", stage="S0", format="manju", user_id=DEMO_USER)
        source = Conversation(project_id=project.id, user_id=DEMO_USER, bot_id="chief")
        fresh = Conversation(project_id=project.id, user_id=DEMO_USER, bot_id="chief")
        quote = "本项目的正式代号是山海旧稿。"
        text = quote + "请只回复“收到”，不调用工具。"
        event = AgentEvent(conversation_id=source.id, source="web", status="done", target_bot_id="chief",
                           payload={"message": text, "project_id": project.id})
        msg = Message(conversation_id=source.id, content=text, actions=inbox_event_actions([event]))
        session.add_all([project, source, fresh, event, msg])
        for question in ("本项目的正式代号是什么", "本项目的主角是小明吗"):
            asked = AgentEvent(conversation_id=source.id, source="web", status="done", target_bot_id="chief",
                               payload={"message": question, "project_id": project.id})
            session.add_all([asked, Message(conversation_id=source.id, content=question,
                                            actions=inbox_event_actions([asked]))])
        session.commit()

        dream = create_dream(DreamCreateIn(project_id=project.id, session_ids=[source.id]), session)
        assert dream.status == "ready", dream.error
        candidate, = dream.changes
        assert candidate.provenance["messageId"] == msg.id
        assert candidate.provenance["quote"] == candidate.after_content == quote
        assert candidate.status == "pending"
        assert merge_dream(dream.id, session)["merged"] == 0
        assert hybrid_search_memory(session, "山海旧稿", store_id=dream.store_id, project_id=fresh.project_id) == []

        patch_dream_change(dream.id, candidate.id, DreamChangePatchIn(status="accepted"), session)
        assert session.get(MemoryFile, candidate.path) is None
        assert merge_dream(dream.id, session)["merged"] == 1
        found, = hybrid_search_memory(session, "山海旧稿", store_id=dream.store_id, project_id=fresh.project_id)
        assert (found.content, found.source_conversation_id) == (quote, source.id)
