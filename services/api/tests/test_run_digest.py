from app.run_digest import compose_run_digest


def test_empty_inputs():
    out = compose_run_digest(artifacts=[], memory_changes=[], gates=[], exit_reason="model_stop")
    assert out["artifacts"] == []
    assert out["memory_changes"] == []
    assert out["gates"] == []
    assert "model_stop" in out["narrative_hint"]


def test_gates_preserve_all_results():
    gates = [
        {"id": "LengthBand", "result": "pass", "message": "ok"},
        {"id": "HookPresence", "result": "warn", "message": "偏弱"},
        {"id": "Format", "result": "fail", "message": "缺格式"},
    ]
    out = compose_run_digest(artifacts=[], memory_changes=[], gates=gates, exit_reason="done_contract_pass")
    assert [g["result"] for g in out["gates"]] == ["pass", "warn", "fail"]


def test_narrative_counts():
    out = compose_run_digest(
        artifacts=[{"type": "manuscript", "title": "第3集", "id": "a1"}],
        memory_changes=[{"path": "/memories/p/bible/x.md", "actor": "agent", "summary": "改人设"}],
        gates=[{"id": "G", "result": "pass", "message": ""}],
        exit_reason="done_contract_pass",
    )
    assert "1 个产物" in out["narrative_hint"]
    assert "1 处记忆" in out["narrative_hint"]
    assert out["leftover"] == ""


def test_leftover_when_not_done():
    out = compose_run_digest(artifacts=[], memory_changes=[], gates=[], exit_reason="max_turns")
    assert out["leftover"] != ""
    assert "max_turns" in out["leftover"]


def test_succeeded_is_clean():
    out = compose_run_digest(artifacts=[], memory_changes=[], gates=[], exit_reason="succeeded")
    assert out["leftover"] == ""


def test_filters_non_gate_metadata():
    gates = [
        {"id": "LengthBand", "result": "pass"},
        {"type": "receipt", "receipt": {"runId": "x"}},
        {"type": "worker_error", "message": "boom"},
    ]
    out = compose_run_digest(artifacts=[], memory_changes=[], gates=gates, exit_reason="succeeded")
    assert len(out["gates"]) == 1
    assert "1 个 gate" in out["narrative_hint"]
