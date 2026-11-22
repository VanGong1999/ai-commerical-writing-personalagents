"""GRPO 程序化奖励：复用代码闸 / deAI 规则，不引入 LLM 评委。

奖励只覆盖“可验证、便宜、确定”的合规项（显式篇幅范围）。
主观质量（爽点、情绪、剧情）不在这里打分，应走 DPO 偏好数据。

给 TRL GRPOTrainer 用法示例（训练在云端 GPU 上做）：

    from app.eval.reward import make_trl_reward_funcs
    trainer = GRPOTrainer(
        model=...,
        reward_funcs=make_trl_reward_funcs(format="manju", min_chars=800, max_chars=1200),
        train_dataset=...,   # 列 prompt
    )

约定：pass=1.0，unknown=0.5，fail=0.0；总分为各项均值，范围 [0, 1]。
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any, Callable

from ..gates import run_gate_battery
from .graders.code import _build_gate_kwargs, _gate_result_to_verdict, _special_deai_rubric

# (rubric_key, code_gate)；与 seeds/rubrics.json 中的 key 对齐
DEFAULT_REWARD_RUBRICS: list[tuple[str, str]] = [
    ("common.length_band_manju", "LengthBand"),
]

VERDICT_SCORE = {"pass": 1.0, "unknown": 0.5, "fail": 0.0}


def _check_one(
    key: str,
    gate: str,
    text: str,
    *,
    format: str,
    context: dict[str, Any],
) -> tuple[str, str]:
    """返回 (verdict, reasoning)。同步执行，不访问数据库。"""
    rubric = SimpleNamespace(key=key, code_gate=gate, format=format)
    if key.startswith("common.deai.") and gate == "DeAIChecklist":
        verdict, _evidence, reasoning = _special_deai_rubric(rubric, text)  # type: ignore[arg-type]
        return verdict, reasoning
    try:
        kwargs = _build_gate_kwargs(rubric, text, context)  # type: ignore[arg-type]
        checks = run_gate_battery(gate, **kwargs)
        verdict, _evidence, reasoning = _gate_result_to_verdict(checks)
        return verdict, reasoning
    except Exception as exc:  # noqa: BLE001
        return "unknown", f"gate error: {exc}"


def score_completion(
    text: str,
    *,
    format: str = "manju",
    min_chars: int = 800,
    max_chars: int = 1200,
    rubrics: list[tuple[str, str]] | None = None,
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """对一条输出计算程序化奖励。"""
    ctx = dict(context or {})
    ctx.setdefault("min_chars", min_chars)
    ctx.setdefault("max_chars", max_chars)
    ctx.setdefault("format", format)
    items = rubrics or DEFAULT_REWARD_RUBRICS

    breakdown: dict[str, float] = {}
    verdicts: dict[str, str] = {}
    notes: list[str] = []
    for key, gate in items:
        verdict, reasoning = _check_one(key, gate, text or "", format=format, context=ctx)
        verdicts[key] = verdict
        breakdown[key] = VERDICT_SCORE.get(verdict, 0.5)
        if verdict != "pass":
            notes.append(f"{key}: {reasoning}")

    total = sum(breakdown.values()) / len(breakdown) if breakdown else 0.0
    return {
        "total": round(total, 4),
        "complete": all(v != "unknown" for v in verdicts.values()),
        "unknownRate": sum(v == "unknown" for v in verdicts.values()) / len(verdicts) if verdicts else 1.0,
        "scope": "deterministic_compliance_only",
        "breakdown": breakdown,
        "verdicts": verdicts,
        "notes": notes,
    }


def _completion_text(c: Any) -> str:
    """兼容纯字符串与 conversational 格式（[{role, content}, ...]）。"""
    if isinstance(c, str):
        return c
    if isinstance(c, list) and c:
        last = c[-1]
        if isinstance(last, dict):
            return str(last.get("content") or "")
    return str(c or "")


def _pick(kwargs: dict[str, Any], name: str, i: int, default: Any) -> Any:
    """TRL 会把数据集额外列以 list 形式传入 kwargs，这里按下标取值。"""
    v = kwargs.get(name)
    if isinstance(v, list) and i < len(v) and v[i] is not None:
        return v[i]
    if v is not None and not isinstance(v, list):
        return v
    return default


def make_trl_reward_funcs(
    *,
    format: str = "manju",
    min_chars: int = 800,
    max_chars: int = 1200,
) -> list[Callable[..., list[float]]]:
    """返回 TRL reward_funcs 列表（每个函数输出 float 列表）。"""

    def code_gate_reward(completions: list[Any], **kwargs: Any) -> list[float]:
        out: list[float] = []
        for i, c in enumerate(completions):
            res = score_completion(
                _completion_text(c),
                format=str(_pick(kwargs, "format", i, format)),
                min_chars=int(_pick(kwargs, "min_chars", i, min_chars)),
                max_chars=int(_pick(kwargs, "max_chars", i, max_chars)),
            )
            out.append(float(res["total"]))
        return out

    return [code_gate_reward]


def reward_agreement(
    pairs: list[tuple[str, str]],
    *,
    format: str = "manju",
    min_chars: int = 800,
    max_chars: int = 1200,
) -> dict[str, Any]:
    """校验奖励与人工偏好是否一致：pairs 为 (chosen, rejected)。

    一致的定义：奖励 chosen > rejected。平局单独计数，不算一致。
    若一致率很低，说明程序化奖励与人工口味冲突，不应直接用于训练。
    """
    agree = tie = disagree = 0
    for chosen, rejected in pairs:
        rc = score_completion(chosen, format=format, min_chars=min_chars, max_chars=max_chars)["total"]
        rr = score_completion(rejected, format=format, min_chars=min_chars, max_chars=max_chars)["total"]
        if rc > rr:
            agree += 1
        elif rc == rr:
            tie += 1
        else:
            disagree += 1
    n = len(pairs)
    return {
        "n": n,
        "agree": agree,
        "tie": tie,
        "disagree": disagree,
        "agreementRate": round(agree / n, 4) if n else None,
    }
