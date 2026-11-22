"""去 AI 味检测网关：本地启发式提供者（默认）+ 可插拔第三方 HTTP 提供者。"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx

from .settings import get_settings

AI_PHRASES = [
    "综上所述",
    "总而言之",
    "值得注意的是",
    "不难发现",
    "宛如",
    "犹如",
    "不禁",
    "涌上心头",
    "嘴角微微上扬",
    "心中一凛",
    "仿佛在诉说",
    "delve",
    "tapestry",
    "game changer",
    "it's important to note",
]


@dataclass
class DeAIDetectResult:
    provider: str
    score: float
    hits: list[str]
    verdict: str  # pass | warn | fail (third-party); local signals are advisory
    reasons: list[str] = field(default_factory=list)
    density: float = 0.0  # flagged occurrences per 1000 non-space characters
    advisory: bool = True

    def to_dict(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "score": self.score,
            "hits": self.hits,
            "verdict": self.verdict,
            "reasons": self.reasons,
            "density": self.density,
            "advisory": self.advisory,
        }


class DeAIDetector(Protocol):
    name: str

    async def detect(self, text: str) -> DeAIDetectResult: ...


class LocalHeuristicDetector:
    """局部风格线索，不能判定作者身份，也不作为发布/生成硬门禁。"""

    name = "local-heuristic"

    async def detect(self, text: str) -> DeAIDetectResult:
        t = text or ""
        # 对话、引文和代码中的词语不代表叙述风格；分镜/角色台词允许短句和冒号。
        prose = re.sub(r'```[\s\S]*?```|“[^”]*”|「[^」]*」|"[^"\n]*"', "", t)
        lines = prose.splitlines()
        prose = "\n".join(
            ln for ln in lines
            if not re.match(r"^\s*(?:分镜\s*\d+|镜头\s*\d+|旁白|[\u4e00-\u9fffA-Za-z]{1,8})[：:]", ln)
        )
        lowered = prose.lower()
        hits: list[str] = []
        reasons: list[str] = []
        occurrences = 0
        repeated = 0
        for phrase in AI_PHRASES:
            # 英文词按词边界匹配，避免把 delver / tapestries 之类当命中。
            pattern = re.escape(phrase.lower())
            if phrase.isascii():
                pattern = r"\b" + pattern + r"\b"
            count = len(re.findall(pattern, lowered))
            if count:
                hits.append(phrase)
                occurrences += count
                repeated += max(0, count - 1)
                reasons.append(f"叙述中出现“{phrase}”{count}次；结合人物语气与具体意象复核，单次使用不判错。")

        chars = max(1, len(re.sub(r"\s", "", t)))
        density = round(occurrences * 1000 / chars, 2)
        # 单个比喻、动作或多个不同表达均不构成自动否决。
        score = min(0.65, repeated * 0.08 + (0.15 if occurrences >= 3 and density >= 5 else 0))
        em_dash = len(re.findall(r"—+|–+", prose))
        if em_dash >= 6 and em_dash * 1000 / chars >= 8:
            hits.append(f"破折号×{em_dash}")
            reasons.append("叙述中破折号密集；检查是否重复解释同一信息，保留有节奏作用的停顿。")
            score += 0.15
        sentences = [s.strip() for s in re.split(r"[。！？!?]", prose) if s.strip()]
        starts = [re.sub(r"^\W+", "", sentence)[:2] for sentence in sentences if len(sentence) >= 2]
        if len(starts) >= 6:
            dup = max(starts.count(start) for start in set(starts))
            if dup >= 4 and dup / len(starts) >= 0.6:
                hits.append(f"句首重复×{dup}")
                reasons.append("叙述句首集中重复；若为排比或人物刻意强调可保留，否则尝试调整句式。")
                score += 0.15
        short = [sentence for sentence in sentences if 2 <= len(sentence) <= 6]
        if len(short) >= 6 and len(short) / max(1, len(sentences)) >= 0.7:
            hits.append(f"短促断奏×{len(short)}")
            reasons.append("连续短句占比较高；动作场景可保留，平静叙述可检查节奏是否单一。")
            score += 0.1
        score = round(min(1.0, score), 2)
        return DeAIDetectResult(self.name, score, hits, "warn" if score >= 0.15 else "pass", reasons, density)


class HttpThirdPartyDetector:
    """配置驱动的第三方检测：POST JSON {text} → 期望 {score, hits, verdict}。"""

    name = "http-third-party"

    def __init__(self, url: str, token: str | None = None) -> None:
        self.url = url
        self.token = token

    async def detect(self, text: str) -> DeAIDetectResult:
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        try:
            async with httpx.AsyncClient(timeout=20.0, trust_env=False) as client:
                resp = await client.post(self.url, json={"text": text}, headers=headers)
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPError as exc:
            # 第三方不可用时不阻断主流程，回退本地启发式
            local = LocalHeuristicDetector()
            result = await local.detect(text)
            result.provider = f"{self.name}:fallback:{exc.__class__.__name__}"
            return result
        return DeAIDetectResult(
            self.name,
            float(data.get("score") or 0),
            [str(h) for h in data.get("hits") or []],
            str(data.get("verdict") or "warn"),
        )


def get_detector() -> DeAIDetector:
    settings = get_settings()
    url = getattr(settings, "deai_detect_url", "") or ""
    if url:
        return HttpThirdPartyDetector(url, getattr(settings, "deai_detect_token", None) or None)
    return LocalHeuristicDetector()
