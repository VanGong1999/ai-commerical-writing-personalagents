from app.eval.metrics import (
    aggregate_trial_score,
    compare_runs,
    cohens_kappa,
    gate_verdict_from_metrics,
    pass_at_k,
    pass_hat_k,
    pass_rate,
    raw_agreement,
    unknown_rate,
)


def test_pass_at_k_and_hat():
    trials = [True, False, True, True]
    assert pass_at_k(trials, k=1) == 0.75
    assert pass_at_k(trials, k=2) == 1.0
    assert abs(pass_hat_k(trials, k=2) - (0.75**2)) < 1e-9


def test_unknown_and_pass_rate():
    vs = ["pass", "fail", "unknown", "pass"]
    assert unknown_rate(vs) == 0.25
    assert abs(pass_rate(vs) - (2 / 3)) < 1e-9


def test_kappa_perfect_and_partial():
    a = ["pass", "fail", "pass"]
    assert cohens_kappa(a, a) == 1.0
    assert raw_agreement(a, ["pass", "fail", "fail"]) == 2 / 3


def test_aggregate_veto():
    judgments = [
        {"rubric_key": "a", "verdict": "pass", "weight": 1, "severity": "major"},
        {"rubric_key": "b", "verdict": "fail", "weight": 1, "severity": "veto"},
    ]
    passed, score, detail = aggregate_trial_score(
        judgments, severities={"a": "major", "b": "veto"}
    )
    assert passed is False
    assert detail["vetoHits"] == 1
    assert score < 1


def test_gate_verdict_and_compare():
    metrics = {"passRate": 0.5, "passHatK": 0.2, "vetoHits": 0}
    assert gate_verdict_from_metrics(metrics, {"minPassRate": 0.9}) == "blocked"
    assert gate_verdict_from_metrics(metrics, {"minPassRate": 0.4}) == "pass"
    cmp = compare_runs({"passRate": 0.9, "vetoHits": 0}, {"passRate": 0.7, "vetoHits": 1}, tolerance=0.02)
    assert cmp["gateVerdict"] == "blocked"
    assert any(r["metric"] == "passRate" for r in cmp["regressions"])
