from app.routers.agents_catalog import (
    DoneCheckBody,
    _compile_done_contract,
    done_check,
)


def test_done_check_gate_pass_resolves_case_insensitive():
    body = DoneCheckBody(
        contract=[{"type": "gate_pass", "gates": ["FormatSelected"]}],
        gate_results=[{"id": "formatselected", "result": "pass"}],
    )
    out = done_check(body)
    assert out["ok"] is True


def test_done_check_gate_pass_resolves_name():
    body = DoneCheckBody(
        contract=[{"type": "gate_pass", "gates": ["FormatSelected"]}],
        gate_results=[{"name": "FormatSelected", "id": "other", "result": "pass"}],
    )
    assert done_check(body)["ok"] is True


def test_done_check_gate_pass_detects_fail():
    body = DoneCheckBody(
        contract=[{"type": "gate_pass", "gates": ["FormatSelected"]}],
        gate_results=[{"id": "formatselected", "result": "fail"}],
    )
    out = done_check(body)
    assert out["ok"] is False
    assert "失败=['FormatSelected']" in out["checks"][0]["message"]


def test_compile_done_contract_parses_goal():
    clauses = _compile_done_contract(
        "至少 10 个核心梗，必须通过 FormatSelected/LengthBand，需人工确认 human_qc_min"
    )
    assert {"type": "artifact_count", "artifact": "核心梗", "min": 10} in clauses
    assert {"type": "gate_pass", "gates": ["FormatSelected", "LengthBand"]} in clauses
    assert {"type": "user_ack", "checklist": "human_qc_min"} in clauses
