"""Agent Eval：写作质量评测体系。"""

from __future__ import annotations

DEFAULT_EVAL_CONFIG: dict = {
    "judge_model": None,  # None → 跟随 AGENT_MODEL_CRITIC / 默认模型
    "monthly_budget_tokens": 500_000,
    "online_sample_rate": 0.2,
    "auto_revise_enabled": False,
    "auto_revise_threshold": 0.7,
    "regression_tolerance": 0.02,
    # 人工偏好 / 本地模型
    "exemplar_inject_enabled": True,
    "exemplar_max_chars": 1200,
    "best_of_n": 2,
    "preference_export_authorized": False,  # 用户作品导出需显式授权
}
