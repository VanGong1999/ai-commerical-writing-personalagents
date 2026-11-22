"""Run 决策摘要把 run 的产物/记忆变更/门禁/遗留拼成结构化 digest。"""

from __future__ import annotations

from typing import Any


def compose_run_digest(
    *,
    artifacts: list[dict[str, Any]],
    memory_changes: list[dict[str, Any]],
    gates: list[dict[str, Any]],
    exit_reason: str,
) -> dict[str, Any]:
    """确定性拼装结构化摘要；LLM 叙述由调用方覆盖 narrative（此处给 narrative_hint 兜底）。"""
    artifacts = artifacts or []
    memory_changes = memory_changes or []
    gates = gates or []

    def _is(result: Any, *vals: str) -> bool:
        if result is True:
            return "pass" in vals or "passed" in vals
        return result in vals

    # 过滤 receipt/worker_error 等非 gate 元数据条目（无 result/passed），避免污染计数
    real_gates = [g for g in gates if g.get("result") is not None or g.get("passed") is not None]
    passed = sum(1 for g in real_gates if _is(g.get("result"), "pass", "passed", "ok") or g.get("passed") is True)
    warned = sum(1 for g in real_gates if _is(g.get("result"), "warn", "warning"))
    failed = sum(1 for g in real_gates if _is(g.get("result"), "fail", "failed", "error"))

    narrative_hint = (
        f"本 run 结束（{exit_reason}）：产出 {len(artifacts)} 个产物，"
        f"改动 {len(memory_changes)} 处记忆，跑 {len(real_gates)} 个 gate"
        f"（{passed} 过 / {warned} 警告 / {failed} 失败）。"
    )
    leftover = "" if exit_reason in ("done_contract_pass", "model_stop", "succeeded") else f"未完全收口（{exit_reason}）"

    return {
        "artifacts": artifacts,
        "memory_changes": memory_changes,
        "gates": real_gates,
        "leftover": leftover,
        "narrative_hint": narrative_hint,
    }
