"""评测指标：pass@k / pass^k / kappa / unknown 率 / 过程指标。"""

from __future__ import annotations

import math
from collections import Counter, defaultdict
from typing import Any, Iterable


def pass_at_k(trial_passed: list[bool], k: int | None = None) -> float:
    """至少一个成功的概率估计（无偏估计简化：用经验频率）。

    对单个 Case 的 n 次 trial：pass@k = 1 - C(n-c, k)/C(n,k)（若 n>=k），
    否则退化为 any(passed)。
    """
    n = len(trial_passed)
    if n == 0:
        return 0.0
    k = k or n
    k = min(k, n)
    c = sum(1 for p in trial_passed if p)
    if k == 1:
        return c / n
    if n - c < k:
        return 1.0
    # 1 - C(n-c, k) / C(n, k)
    def comb(a: int, b: int) -> float:
        if b < 0 or b > a:
            return 0.0
        return math.comb(a, b)

    denom = comb(n, k)
    if denom == 0:
        return 0.0
    return 1.0 - comb(n - c, k) / denom


def pass_hat_k(trial_passed: list[bool], k: int | None = None) -> float:
    """全部成功的概率：经验上用 (c/n)^k。"""
    n = len(trial_passed)
    if n == 0:
        return 0.0
    k = k or n
    rate = sum(1 for p in trial_passed if p) / n
    return float(rate**k)


def unknown_rate(verdicts: Iterable[str]) -> float:
    vs = list(verdicts)
    if not vs:
        return 0.0
    return sum(1 for v in vs if v == "unknown") / len(vs)


def pass_rate(verdicts: Iterable[str], *, ignore_unknown: bool = True) -> float:
    vs = [v for v in verdicts if (not ignore_unknown) or v != "unknown"]
    if not vs:
        return 0.0
    return sum(1 for v in vs if v == "pass") / len(vs)


def raw_agreement(a: list[str], b: list[str]) -> float:
    if not a or len(a) != len(b):
        return 0.0
    return sum(1 for x, y in zip(a, b) if x == y) / len(a)


def cohens_kappa(a: list[str], b: list[str]) -> float:
    """Cohen's kappa for categorical labels."""
    if not a or len(a) != len(b):
        return 0.0
    n = len(a)
    po = raw_agreement(a, b)
    labels = set(a) | set(b)
    pa = Counter(a)
    pb = Counter(b)
    pe = sum((pa[l] / n) * (pb[l] / n) for l in labels)
    if abs(1 - pe) < 1e-9:
        return 1.0 if po == 1.0 else 0.0
    return (po - pe) / (1 - pe)


SCORING_POLICY = "mandatory-subset-v1"


def aggregate_trial_score(
    judgments: list[dict[str, Any]],
    *,
    severities: dict[str, str] | None = None,
) -> tuple[bool, float, dict[str, Any]]:
    """综合多条 Rubric 判定 → (passed, score, detail)。

    veto 任一 fail → 整 trial 失败；score = 加权 pass 比例（unknown 不计分母时按 0.5）。
    """
    severities = severities or {}
    advisory = {}

    veto_hits = 0
    weight_sum = 0.0
    score_sum = 0.0
    by_rubric: dict[str, str] = {}
    for j in judgments:
        key = j.get("rubric_key") or j.get("rubricKey") or ""
        verdict = j.get("verdict") or "unknown"
        sev = severities.get(key) or j.get("severity") or "major"
        if sev == "advisory":
            advisory[key] = verdict
            continue
        by_rubric[key] = verdict
        w = float(j.get("weight") or 1.0)
        if sev == "veto" and verdict == "fail":
            veto_hits += 1
        weight_sum += w
        if verdict == "pass":
            score_sum += w
        elif verdict == "unknown":
            score_sum += 0.5 * w
    score = (score_sum / weight_sum) if weight_sum else 0.0
    unk = unknown_rate(by_rubric.values())
    passed = veto_hits == 0 and score >= 0.7 and unk == 0
    decided_advice = [v for v in advisory.values() if v in {"pass", "fail"}]
    return passed, score, {
        "vetoHits": veto_hits,
        "unknownRate": unk,
        "byRubric": by_rubric,
        "advisoryByRubric": advisory,
        "advisoryPassRate": pass_rate(decided_advice) if decided_advice else None,
        "scoringPolicy": SCORING_POLICY,
        "assessment": ("not_assessed" if not by_rubric else "blocked" if veto_hits else
                       "needs_review" if unk else "pass" if passed else "blocked"),
        "score": score,
    }


def aggregate_run_metrics(
    case_trials: dict[str, list[bool]],
    all_verdicts: list[str],
    *,
    k: int = 3,
    veto_hits: int = 0,
    w_codes: list[str] | None = None,
    process: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """跨 Case 汇总。"""
    per_case_pass_at = []
    per_case_pass_hat = []
    for _cid, passed_list in case_trials.items():
        per_case_pass_at.append(pass_at_k(passed_list, k=min(k, len(passed_list) or 1)))
        per_case_pass_hat.append(pass_hat_k(passed_list, k=min(k, len(passed_list) or 1)))
    return {
        "passRate": pass_rate(all_verdicts, ignore_unknown=False),
        "assessedPassRate": pass_rate(all_verdicts),
        "judgmentCount": len(all_verdicts),
        "coverageRate": 1 - unknown_rate(all_verdicts) if all_verdicts else 0.0,
        "unknownRate": unknown_rate(all_verdicts),
        "passAtK": sum(per_case_pass_at) / len(per_case_pass_at) if per_case_pass_at else 0.0,
        "passHatK": sum(per_case_pass_hat) / len(per_case_pass_hat) if per_case_pass_hat else 0.0,
        "k": k,
        "caseCount": len(case_trials),
        "vetoHits": veto_hits,
        "wCodeDistribution": dict(Counter(w_codes or [])),
        "process": process or {},
    }


def rubric_failure_ranking(verdicts_by_key: dict[str, list[str]], top_n: int = 10) -> list[dict[str, Any]]:
    rows = []
    for key, vs in verdicts_by_key.items():
        fails = sum(1 for v in vs if v == "fail")
        total = len(vs) or 1
        rows.append(
            {
                "rubricKey": key,
                "failRate": fails / total,
                "fails": fails,
                "total": total,
                "unknownRate": unknown_rate(vs),
            }
        )
    rows.sort(key=lambda r: r["failRate"], reverse=True)
    return rows[:top_n]


def maturity_self_check(
    *,
    has_rubrics: bool,
    has_suites: bool,
    has_runs: bool,
    has_case_pool: bool,
    has_online_sample: bool,
    agreement_rate: float | None,
    has_patrol: bool,
) -> dict[str, Any]:
    """美团 L0–L3 简化自查。"""

    def level(ok_l1: bool, ok_l2: bool, ok_l3: bool) -> int:
        if ok_l3:
            return 3
        if ok_l2:
            return 2
        if ok_l1:
            return 1
        return 0

    dims = {
        "observation": level(True, has_runs, has_online_sample),  # 本项目已有 Trace
        "rubrics": level(has_rubrics, has_rubrics and (agreement_rate or 0) >= 0.7, (agreement_rate or 0) >= 0.85),
        "suites": level(has_suites, has_runs, has_patrol),
        "caseMining": level(has_case_pool, has_case_pool and has_online_sample, has_patrol),
        "regressionGate": level(has_runs, has_runs, has_patrol),
    }
    shortest = min(dims, key=lambda k: dims[k])
    return {"dimensions": dims, "shortestBoard": shortest, "hint": "体系上限由最短板决定"}


def gate_verdict_from_metrics(
    metrics: dict[str, Any],
    thresholds: dict[str, Any],
) -> str:
    if metrics.get("judgmentCount") == 0:
        return "not_assessed"
    if thresholds.get("expectFail"):
        # bad_case suite: we don't block releases on it
        return "pass"
    if thresholds.get("vetoBlocks") and int(metrics.get("vetoHits") or 0) > 0:
        return "blocked"
    min_rate = float(thresholds.get("minPassRate") or 0.0)
    if metrics.get("passRate", 1.0) + 1e-9 < min_rate:
        return "blocked"
    min_hat = thresholds.get("minPassHatK")
    hat_key = "scorerPassHatK" if metrics.get("evaluationMode") == "scorer_regression" else "passHatK"
    if min_hat is not None and float(metrics.get(hat_key) or 0) + 1e-9 < float(min_hat):
        return "blocked"
    return "pass"


def compare_runs(baseline: dict[str, Any], candidate: dict[str, Any], tolerance: float = 0.02) -> dict[str, Any]:
    """对比两次运行指标，标出退化。"""
    for metrics in (baseline, candidate):
        if metrics.get("judgmentCount") == 0 or (metrics.get("detail") or {}).get("assessment") == "not_assessed":
            return {"comparable": False, "reason": "至少一方无必评项，无法比较",
                    "regressions": [], "improved": False, "gateVerdict": "not_comparable"}
    incompatible = [key for key in ("scoringPolicy", "evaluationMode", "suiteId", "evaluationSpecHash")
                    if (key in baseline or key in candidate) and baseline.get(key) != candidate.get(key)]
    if "scoringPolicy" in incompatible:
        return {"comparable": False, "reason": "计分口径不同，请重新评测基线",
                "regressions": [], "improved": False, "gateVerdict": "not_comparable"}
    if incompatible:
        return {"comparable": False, "reason": "评测协议不一致: " + ", ".join(incompatible),
                "regressions": [], "improved": False, "gateVerdict": "blocked"}
    regressions = []
    if float(candidate.get("unknownRate") or 0) > float(baseline.get("unknownRate") or 0) + tolerance:
        regressions.append({"metric": "unknownRate", "baseline": baseline.get("unknownRate", 0),
                            "candidate": candidate.get("unknownRate", 0)})
    for key in ("passRate", "passAtK", "passHatK", "scorerPassAtK", "scorerPassHatK"):
        b = float(baseline.get(key) or 0)
        c = float(candidate.get(key) or 0)
        if c + tolerance < b:
            regressions.append({"metric": key, "baseline": b, "candidate": c, "delta": c - b})
    b_veto = int(baseline.get("vetoHits") or 0)
    c_veto = int(candidate.get("vetoHits") or 0)
    if c_veto > b_veto:
        regressions.append({"metric": "vetoHits", "baseline": b_veto, "candidate": c_veto, "delta": c_veto - b_veto})
    return {
        "comparable": True,
        "regressions": regressions,
        "improved": not regressions and float(candidate.get("passRate") or 0) > float(baseline.get("passRate") or 0),
        "gateVerdict": "blocked" if regressions else "pass",
    }


def process_metrics_from_run(
    *,
    gate_results: list[dict[str, Any]] | None = None,
    token_prompt: int = 0,
    token_completion: int = 0,
    step_count: int = 0,
    tool_error_count: int = 0,
    repair_rounds: int = 0,
    duration_ms: int | None = None,
) -> dict[str, Any]:
    gates = gate_results or []
    gate_fail = sum(1 for g in gates if (g.get("result") or "").lower() == "fail")
    return {
        "tokenPrompt": token_prompt,
        "tokenCompletion": token_completion,
        "tokenTotal": token_prompt + token_completion,
        "stepCount": step_count,
        "toolErrorCount": tool_error_count,
        "repairRounds": repair_rounds,
        "gateFailCount": gate_fail,
        "durationMs": duration_ms,
    }
