from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, Field

from ..deai_detector import get_detector

router = APIRouter(tags=["quality"])


class DeAIDetectIn(BaseModel):
    text: str


@router.post("/quality/deai-detect")
async def deai_detect(body: DeAIDetectIn) -> dict:
    """去 AI 味检测：本地启发式或配置的第三方提供者。"""
    detector = get_detector()
    result = await detector.detect(body.text)
    return result.to_dict()
