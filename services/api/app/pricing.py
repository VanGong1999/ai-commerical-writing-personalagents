"""模型计价：默认单价表 + 按用量估算成本（元）。"""

from __future__ import annotations

from typing import Any

from sqlmodel import Session, select


# 元 / 每百万 tokens。仅作本地估算默认值，可在「设置 → AI 服务商」逐模型覆盖。
# DeepSeek flash / v4-pro：按官方「高峰时段」价表估算（缓存命中 / 未命中 / 输出）。
DEFAULT_MODEL_PRICING: dict[str, dict[str, float]] = {
    # MiniMax（占位默认，可编辑）
    "MiniMax-M3.1-Flash": {"input": 1.0, "cachedInput": 0.5, "output": 4.0},
    "MiniMax-Text-01": {"input": 1.0, "cachedInput": 0.5, "output": 4.0},
    # DeepSeek（legacy 别名仍保留可编辑占位；主力型号按高峰）
    "deepseek-chat": {"input": 2.0, "cachedInput": 0.5, "output": 8.0},
    "deepseek-reasoner": {"input": 4.0, "cachedInput": 1.0, "output": 16.0},
    "deepseek-flash": {"input": 2.0, "cachedInput": 0.04, "output": 8.0},
    "deepseek-v4-pro": {"input": 9.0, "cachedInput": 0.30, "output": 27.0},
}

# 历史 seed / 默认表里写死的旧价；仅当配置仍等于这些值时才自动升到高峰价，不覆盖用户自定义。
_STALE_DEEPSEEK_PRICING: dict[str, tuple[dict[str, float], ...]] = {
    "deepseek-flash": (
        {"input": 1.0, "cachedInput": 0.3, "output": 4.0},
        {"input": 1.0, "cachedInput": 0.30, "output": 4.0},
    ),
    "deepseek-v4-pro": (
        {"input": 2.0, "cachedInput": 0.5, "output": 8.0},
        {"input": 2.0, "cachedInput": 0.50, "output": 8.0},
    ),
}


def _pricing_triplet(value: dict[str, Any] | None) -> dict[str, float] | None:
    if not isinstance(value, dict):
        return None
    out: dict[str, float] = {}
    for field in ("input", "cachedInput", "output"):
        raw = value.get(field)
        if not isinstance(raw, (int, float)):
            return None
        out[field] = float(raw)
    return out


def _pricing_equal(left: dict[str, float], right: dict[str, float]) -> bool:
    return all(abs(left[k] - right[k]) < 1e-9 for k in ("input", "cachedInput", "output"))


def upgrade_stale_deepseek_pricing(
    pricing: dict[str, Any] | None,
) -> dict[str, dict[str, float]]:
    """把仍等于旧默认的 deepseek-flash / v4-pro 单价升到官方高峰价；其它模型原样保留。"""
    if not isinstance(pricing, dict):
        return {}
    out: dict[str, dict[str, float]] = {}
    for key, value in pricing.items():
        cleaned = _pricing_triplet(value)
        if cleaned is None:
            continue
        model = str(key)
        stale_list = _STALE_DEEPSEEK_PRICING.get(model)
        if stale_list and any(_pricing_equal(cleaned, stale) for stale in stale_list):
            out[model] = dict(DEFAULT_MODEL_PRICING[model])
        else:
            out[model] = cleaned
    return out


def resolve_model_pricing(
    session: Session | None,
    model: str,
) -> dict[str, float] | None:
    """返回某模型的 {input, cachedInput, output} 单价（元/百万 tokens），未知返回 None。"""
    model = str(model or "").strip()
    if not model:
        return None
    merged: dict[str, dict[str, float]] = {}
    if session is not None:
        try:
            from .models import ProviderConfig

            for row in session.exec(select(ProviderConfig)).all():
                pricing = getattr(row, "pricing", None) or {}
                if not isinstance(pricing, dict):
                    continue
                for key, value in pricing.items():
                    if isinstance(value, dict):
                        cleaned = {
                            k: float(v)
                            for k, v in value.items()
                            if k in {"input", "cachedInput", "output"}
                            and isinstance(v, (int, float))
                        }
                        if cleaned:
                            merged.setdefault(str(key), cleaned)
        except Exception:  # noqa: BLE001
            pass
    merged.setdefault(model, DEFAULT_MODEL_PRICING.get(model, {}))
    merged.setdefault("*", DEFAULT_MODEL_PRICING.get("*", {}))
    if merged.get(model):
        return merged[model]
    if merged.get("*"):
        return merged["*"]
    return None


def estimate_cost(
    pricing: dict[str, float] | None,
    prompt_tokens: int,
    completion_tokens: int,
    cache_hit_tokens: int = 0,
    cache_miss_tokens: int = 0,
) -> float | None:
    """按单价估算成本；无单价返回 None（前端显示「未配置单价」）。"""
    if not pricing:
        return None
    input_price = float(pricing.get("input") or 0)
    output_price = float(pricing.get("output") or 0)
    cached_price = float(pricing.get("cachedInput", input_price) or 0)
    prompt = int(prompt_tokens or 0)
    completion = int(completion_tokens or 0)
    hit = int(cache_hit_tokens or 0)
    miss = int(cache_miss_tokens or 0)
    # 未细分缓存时按全价输入计；有细分时命中部分按缓存价。
    if hit or miss:
        billed_input = hit * cached_price + max(0, prompt - hit) * input_price
    else:
        billed_input = prompt * input_price
    cost = (billed_input + completion * output_price) / 1_000_000.0
    return round(cost, 6)


def cost_for_model(
    session: Session,
    pricing_map: dict[str, dict[str, float]],
    model: str,
    prompt_tokens: int,
    completion_tokens: int,
    cache_hit_tokens: int = 0,
    cache_miss_tokens: int = 0,
) -> float | None:
    """请求级便捷入口：先查 map，再回退 provider 配置。"""
    pricing = pricing_map.get(str(model)) or resolve_model_pricing(session, model)
    return estimate_cost(pricing, prompt_tokens, completion_tokens, cache_hit_tokens, cache_miss_tokens)


def build_pricing_map(session: Session) -> dict[str, dict[str, float]]:
    """把默认单价 + 所有 Provider 的自定义单价合并为 model → 单价。"""
    merged: dict[str, dict[str, float]] = {}
    for key, value in DEFAULT_MODEL_PRICING.items():
        merged[key] = dict(value)
    try:
        from .models import ProviderConfig

        for row in session.exec(select(ProviderConfig)).all():
            pricing = getattr(row, "pricing", None) or {}
            if not isinstance(pricing, dict):
                continue
            for key, value in pricing.items():
                if not isinstance(value, dict):
                    continue
                cleaned = {
                    k: float(v)
                    for k, v in value.items()
                    if k in {"input", "cachedInput", "output"}
                    and isinstance(v, (int, float, str))
                }
                if cleaned:
                    merged[str(key)] = cleaned
    except Exception:  # noqa: BLE001
        pass
    return merged


def sanitize_pricing(value: Any) -> dict[str, dict[str, float]]:
    """只保留合法计价字段，其余丢弃。"""
    if not isinstance(value, dict):
        return {}
    out: dict[str, dict[str, float]] = {}
    for key, item in value.items():
        if not isinstance(item, dict):
            continue
        cleaned: dict[str, float] = {}
        for field in ("input", "cachedInput", "output"):
            raw = item.get(field)
            if raw is None or raw == "":
                continue
            try:
                num = float(raw)
            except (TypeError, ValueError):
                continue
            if num >= 0:
                cleaned[field] = round(num, 6)
        if cleaned:
            out[str(key)] = cleaned
    return out
