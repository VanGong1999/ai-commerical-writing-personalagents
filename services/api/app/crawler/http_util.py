from __future__ import annotations

import asyncio
import re
import time
from typing import Any

import httpx

DEFAULT_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)

# 合规护栏：正文/章节级 URL 一律拒绝，仅允许榜单/摘要级公开页
FULLTEXT_PATTERNS = [
    re.compile(r"/read/", re.IGNORECASE),
    re.compile(r"/chapter/", re.IGNORECASE),
    re.compile(r"/content/", re.IGNORECASE),
    re.compile(r"chapterId=", re.IGNORECASE),
    re.compile(r"readId=", re.IGNORECASE),
    re.compile(r"/p/\d+/", re.IGNORECASE),
]

_rate_lock = asyncio.Lock()
_last_request_ts = 0.0
MIN_REQUEST_INTERVAL = 0.5


def is_fulltext_url(url: str) -> bool:
    return any(p.search(url) for p in FULLTEXT_PATTERNS)


async def _respect_rate_limit() -> None:
    global _last_request_ts
    async with _rate_lock:
        now = time.monotonic()
        wait = MIN_REQUEST_INTERVAL - (now - _last_request_ts)
        if wait > 0:
            await asyncio.sleep(wait)
        _last_request_ts = time.monotonic()


def build_headers(
    cookie: str | None = None,
    referer: str | None = None,
    user_agent: str | None = None,
) -> dict[str, str]:
    headers = {
        "User-Agent": user_agent or DEFAULT_UA,
        "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    }
    if referer:
        headers["Referer"] = referer
    if cookie:
        headers["Cookie"] = cookie.strip()
    return headers


async def fetch_bytes(
    url: str,
    *,
    cookie: str | None = None,
    referer: str | None = None,
    user_agent: str | None = None,
    timeout: float = 20.0,
) -> tuple[int, bytes, dict[str, Any]]:
    if is_fulltext_url(url):
        return 451, b"", {"x-error": "fulltext crawl disabled: chapter/content URL refused"}
    await _respect_rate_limit()
    try:
        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=timeout,
            trust_env=False,  # 避免本机错误代理导致 403/连不上
        ) as client:
            resp = await client.get(
                url,
                headers=build_headers(cookie, referer, user_agent),
            )
            return resp.status_code, resp.content, dict(resp.headers)
    except httpx.HTTPError as e:
        return 0, b"", {"x-error": str(e)}


async def fetch_json(
    url: str,
    *,
    cookie: str | None = None,
    referer: str | None = None,
    user_agent: str | None = None,
    timeout: float = 20.0,
) -> tuple[int, Any]:
    if is_fulltext_url(url):
        return 451, {"error": "fulltext crawl disabled: chapter/content URL refused"}
    await _respect_rate_limit()
    try:
        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=timeout,
            trust_env=False,
        ) as client:
            resp = await client.get(
                url,
                headers=build_headers(cookie, referer, user_agent),
            )
            try:
                return resp.status_code, resp.json()
            except Exception:
                return resp.status_code, None
    except httpx.HTTPError as e:
        return 0, {"error": str(e)}


def decode_html(raw: bytes, preferred: tuple[str, ...] = ("utf-8", "gb18030", "gbk")) -> str:
    for enc in preferred:
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="ignore")
