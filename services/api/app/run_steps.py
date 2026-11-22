"""Allocate ledger positions inside the transaction that publishes each step."""

from sqlalchemy import text
from sqlmodel import Session, select

from .models import RunStep


def next_step_seq(session: Session, conversation_id: str) -> int:
    # Flush pending business writes before taking the counter row lock. Neither
    # this number nor later numbers for the same key become visible early.
    session.flush()
    params = {"cid": conversation_id}
    value = session.execute(text("""
        UPDATE runstepcounter SET last_seq = last_seq + 1
        WHERE conversation_id = :cid RETURNING last_seq
    """), params).scalar_one_or_none()
    if value is not None:
        return value
    # Concurrent first inserts converge on one row even if both UPDATEs missed.
    return session.execute(text("""
        INSERT INTO runstepcounter (conversation_id, last_seq)
        VALUES (:cid, (SELECT COALESCE(MAX(seq), 0) + 1 FROM runstep
                       WHERE conversation_id = :cid AND seq > 0))
        ON CONFLICT (conversation_id) DO UPDATE SET last_seq = runstepcounter.last_seq + 1
        RETURNING last_seq
    """), params).scalar_one()


def conversation_steps(conversation_id: str, after_seq: int, after_id: str | None):
    stmt = select(RunStep).where(RunStep.conversation_id == conversation_id, RunStep.kind != "thinking")
    if after_id is not None:
        stmt = stmt.where((RunStep.seq > after_seq) |
                          ((RunStep.seq == after_seq) & (RunStep.id > after_id)))
    elif after_seq:
        stmt = stmt.where(RunStep.seq > after_seq)
    return stmt.order_by(RunStep.seq, RunStep.id)


def overview_payload(step):
    """Project timelines and model-accessible task inspection have a wider audience."""
    payload = step.payload or {}
    if step.kind == "model_call" and "manifest" in payload:
        ctx = payload["manifest"]
        return {"messages": ctx.get("count"), "mode": ctx.get("mode")}
    return payload
