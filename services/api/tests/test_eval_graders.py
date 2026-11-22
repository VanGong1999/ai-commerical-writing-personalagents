import asyncio

from app.db import init_db
from app.eval.graders.code import grade_code
from app.eval.graders.llm_judge import _evidence_ok, _extract_json_array, _normalize_verdict
from app.eval.seed import ensure_eval_seeds
from app.models import EvalRubric
from sqlmodel import Session, select

from app.db import engine


def test_evidence_substring():
    assert _evidence_ok("她垂着头", "她垂着头，肩膀微微耷拉。")
    assert not _evidence_ok("编造的句子", "她垂着头，肩膀微微耷拉。")
    assert _evidence_ok("", "anything")


def test_normalize_and_parse_json():
    assert _normalize_verdict("通过") == "pass"
    assert _normalize_verdict("否") == "fail"
    arr = _extract_json_array(
        '```json\n[{"rubric_key":"a","verdict":"pass","evidence_quote":"x","reason":"ok"}]\n```'
    )
    assert arr[0]["rubric_key"] == "a"


def test_code_grader_deai_simile():
    init_db()
    with Session(engine) as session:
        ensure_eval_seeds(session)
        rubric = session.exec(
            select(EvalRubric).where(EvalRubric.key == "common.deai.no_simile")
        ).first()
        assert rubric is not None
        bad = asyncio.run(grade_code(rubric, "她像一朵凋零的牡丹，肩膀微微耷拉。"))
        assert bad.verdict == "unknown"
        good = asyncio.run(grade_code(rubric, "她垂着头，肩膀微微耷拉。"))
        assert good.verdict == "pass"


def test_code_grader_summary_banned():
    init_db()
    with Session(engine) as session:
        ensure_eval_seeds(session)
        rubric = session.exec(
            select(EvalRubric).where(EvalRubric.key == "common.deai.no_summary")
        ).first()
        j = asyncio.run(grade_code(rubric, "综上所述，他决定离开。"))
        assert j.verdict == "unknown"
