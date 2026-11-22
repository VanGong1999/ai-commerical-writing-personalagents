"""合规公开榜摘要抓取：仅书名/排名/作者/题材/简介级字段。"""
from __future__ import annotations

import json
import re
from collections.abc import Awaitable, Callable
from html import unescape
from typing import Any
from urllib.parse import urljoin

from .http_util import DEFAULT_UA, decode_html, fetch_bytes, fetch_json
from .types import FetchResult, RankItem

Fetcher = Callable[[str | None], Awaitable[FetchResult]]

MOBILE_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 "
    "Mobile/15E148 Safari/604.1"
)

COOKIE_HINTS = {
    "qidian": (
        "起点有反爬。请在浏览器登录 www.qidian.com 后，打开开发者工具 → Network，"
        "复制任意请求的 Cookie（含 _csrfToken / newstatisticUUID 等），粘贴到本源 Cookie。"
    ),
    "hongguo": (
        "红果/抖音侧榜单通常需登录态。请提供可用的 Cookie；"
        "当前仅保留公开元数据摘要，不抓剧集正文。"
    ),
    "douyin": (
        "抖音网页端强校验。如需漫剧热榜信号，请提供 Cookie，或改用手动录入热榜标题。"
    ),
}


def _clean(text: str) -> str:
    text = unescape(re.sub(r"<[^>]+>", "", text or ""))
    return re.sub(r"\s+", " ", text).strip()


def _genre_from_text(*parts: str) -> str:
    blob = " ".join(p for p in parts if p)
    keywords = [
        ("重生", "重生"),
        ("系统", "系统"),
        ("修仙", "玄幻修仙"),
        ("仙侠", "仙侠"),
        ("玄幻", "玄幻"),
        ("都市", "都市"),
        ("战神", "战神赘婿"),
        ("赘婿", "战神赘婿"),
        ("末世", "末世"),
        ("穿越", "穿越"),
        ("言情", "言情"),
        ("甜宠", "甜宠"),
        ("虐", "虐恋"),
        ("宫斗", "宫斗"),
        ("悬疑", "悬疑"),
        ("科幻", "科幻"),
        ("历史", "历史"),
        ("同人", "同人"),
        ("综漫", "综漫"),
        ("游戏", "游戏"),
    ]
    for key, label in keywords:
        if key in blob:
            return label
    return "综合"


def _parse_qimao_rank_html(html: str, channel: str, board: str) -> list[RankItem]:
    """解析七猫 `/paihang/{channel}/{board}/date/` 的公开 SSR HTML。"""
    items: list[RankItem] = []
    blocks = re.findall(r'<li class="rank-list-item".*?</li>', html, re.DOTALL)
    for fallback_rank, block in enumerate(blocks, start=1):
        title_match = re.search(
            r'<a\s+href="([^"]+)"[^>]*class="s-book-title"[^>]*>(.*?)</a>',
            block,
            re.DOTALL,
        )
        if not title_match:
            continue
        title = _clean(title_match.group(2))
        if not title:
            continue
        href = urljoin("https://www.qimao.com", title_match.group(1))
        info_match = re.search(
            r'<span class="s-book-info[^"]*"[^>]*>(.*?)</span>',
            block,
            re.DOTALL,
        )
        info_html = info_match.group(1) if info_match else ""
        info_texts = [_clean(v) for v in re.findall(r">([^<>]+)<", info_html)]
        info_texts = [v for v in info_texts if v]
        author = info_texts[0] if info_texts else ""
        categories = [
            _clean(v)
            for v in re.findall(
                r'<a[^>]+href="https://www\.qimao\.com/shuku/a-[^"]+"[^>]*>(.*?)</a>',
                info_html,
                re.DOTALL,
            )
        ]
        intro_match = re.search(
            r'<span class="s-book-intro"[^>]*>(.*?)</span>',
            block,
            re.DOTALL,
        )
        abstract = _clean(intro_match.group(1)) if intro_match else ""
        rank_match = re.search(
            r'<span class="rank-number[^"]*"[^>]*>\s*(\d+)\s*</span>',
            block,
        )
        rank = int(rank_match.group(1)) if rank_match else fallback_rank
        status_match = re.search(r">\s*(连载中|已完结|完结)\s*<", info_html)
        book_id_match = re.search(r"/shuku/(\d+)/", href)
        tags = ["七猫", f"{channel}频", board]
        if categories:
            tags.extend(categories[:2])
        items.append(
            RankItem(
                rank=rank,
                title=title,
                author=author,
                genre=(categories[-1] if categories else _genre_from_text(title, abstract)),
                abstract=abstract[:180],
                status=_clean(status_match.group(1)) if status_match else "",
                url=href,
                book_id=book_id_match.group(1) if book_id_match else "",
                tags=tags,
            )
        )
    return items


def _extract_script_json(html: str, script_id: str) -> dict[str, Any] | None:
    match = re.search(
        rf'<script[^>]+id="{re.escape(script_id)}"[^>]*>(.*?)</script>',
        html,
        re.DOTALL,
    )
    if not match:
        return None
    try:
        data = json.loads(unescape(match.group(1)).strip())
    except (json.JSONDecodeError, TypeError):
        return None
    return data if isinstance(data, dict) else None


def _parse_qidian_rank_html(html: str) -> list[RankItem]:
    """解析起点移动端公开榜单页内嵌的 Vite SSR pageContext。"""
    context = _extract_script_json(html, "vite-plugin-ssr_pageContext")
    page_data = (
        ((context or {}).get("pageContext") or {}).get("pageProps") or {}
    ).get("pageData") or {}
    records = page_data.get("records") if isinstance(page_data, dict) else None
    if not isinstance(records, list):
        return []
    items: list[RankItem] = []
    for fallback_rank, row in enumerate(records, start=1):
        if not isinstance(row, dict):
            continue
        title = _clean(str(row.get("bName") or ""))
        if not title:
            continue
        bid = str(row.get("bid") or "")
        category = _clean(str(row.get("cat") or ""))
        subcategory = _clean(str(row.get("subCat") or ""))
        rank_value = row.get("rankNum")
        try:
            rank = int(rank_value)
        except (TypeError, ValueError):
            rank = fallback_rank
        items.append(
            RankItem(
                rank=rank,
                title=title,
                author=_clean(str(row.get("bAuth") or "")),
                genre=category or _genre_from_text(title, str(row.get("desc") or "")),
                abstract=_clean(str(row.get("desc") or ""))[:180],
                url=f"https://www.qidian.com/book/{bid}/" if bid else "",
                book_id=bid,
                tags=[
                    tag
                    for tag in ["起点", "月票榜", subcategory]
                    if tag
                ],
                extra={
                    "rankMetric": _clean(str(row.get("rankCnt") or "")),
                    "wordCount": _clean(str(row.get("cnt") or "")),
                },
            )
        )
    return items


def _parse_hongguo_rank_html(html: str) -> list[RankItem]:
    """解析红果官网榜单中的 schema.org ItemList 结构化数据。"""
    payloads = re.findall(
        r'<script[^>]+type="application/ld\+json"[^>]*>(.*?)</script>',
        html,
        re.DOTALL,
    )
    item_list: dict[str, Any] | None = None
    for payload in payloads:
        try:
            data = json.loads(unescape(payload).strip())
        except json.JSONDecodeError:
            continue
        candidates = data.get("@graph", []) if isinstance(data, dict) else []
        for candidate in [data, *candidates]:
            if isinstance(candidate, dict) and candidate.get("@type") == "ItemList":
                item_list = candidate
                break
        if item_list:
            break
    if not item_list:
        return []
    items: list[RankItem] = []
    rows = item_list.get("itemListElement") or []
    for fallback_rank, row in enumerate(rows, start=1):
        if not isinstance(row, dict):
            continue
        title = _clean(str(row.get("name") or ""))
        if not title:
            continue
        url = str(row.get("url") or "")
        series_match = re.search(r"[?&]series_id=(\d+)", url)
        try:
            rank = int(row.get("position"))
        except (TypeError, ValueError):
            rank = fallback_rank
        items.append(
            RankItem(
                rank=rank,
                title=title,
                genre="漫剧",
                abstract="红果短剧官网公开热播榜条目",
                status="",
                url=url,
                book_id=series_match.group(1) if series_match else "",
                tags=["红果短剧", "漫剧", "热播榜"],
                extra={"cover": str(row.get("image") or "")},
            )
        )
    return items


async def fetch_fanqie(cookie: str | None = None) -> FetchResult:
    url = "https://fanqienovel.com/api/rank/list?rank_type=1&page=1&page_size=30"
    code, data = await fetch_json(url, cookie=cookie, referer="https://fanqienovel.com/rank")
    if code != 200 or not isinstance(data, dict):
        return FetchResult(
            source_id="fanqie",
            platform="番茄小说",
            board_name="公开阅读榜",
            items=[],
            error=f"番茄接口 HTTP {code}，可稍后重试或补充 Cookie",
            needs_cookie=code in {401, 403, 202},
            cookie_hint="若持续失败，可粘贴 fanqienovel.com 的 Cookie 再试。",
        )
    rows = ((data.get("data") or {}).get("list")) or []
    items: list[RankItem] = []
    for i, row in enumerate(rows[:30], start=1):
        if not isinstance(row, dict):
            continue
        title = _clean(str(row.get("bookName") or row.get("title") or ""))
        if not title:
            continue
        abstract = _clean(str(row.get("abstract") or ""))
        author = _clean(str(row.get("author") or ""))
        book_id = str(row.get("bookId") or "")
        items.append(
            RankItem(
                rank=i,
                title=title,
                author=author,
                genre=_genre_from_text(title, abstract),
                abstract=abstract[:180],
                url=f"https://fanqienovel.com/page/{book_id}" if book_id else "",
                book_id=book_id,
                tags=[t for t in [author and "有作者", abstract and "有简介"] if t],
            )
        )
    return FetchResult(
        source_id="fanqie",
        platform="番茄小说",
        board_name="公开阅读榜",
        items=items,
        raw_note="来源：fanqienovel.com/api/rank/list（仅公开元数据）",
        error=None if items else "未解析到榜单条目",
    )


async def fetch_jinjiang(cookie: str | None = None) -> FetchResult:
    # orderstr=1 月排行常见入口；公开 HTML
    url = "https://www.jjwxc.net/topten.php?orderstr=1"
    code, raw, _ = await fetch_bytes(url, cookie=cookie, referer="https://www.jjwxc.net/")
    if code != 200 or not raw:
        return FetchResult(
            source_id="jinjiang",
            platform="晋江文学城",
            board_name="公开排行榜",
            items=[],
            error=f"晋江页面 HTTP {code}",
            needs_cookie=code in {401, 403},
            cookie_hint=COOKIE_HINTS.get("jinjiang", "可尝试粘贴 jjwxc.net Cookie。"),
        )
    html = decode_html(raw, ("gb18030", "gbk", "utf-8"))
    items: list[RankItem] = []
    for tr in re.findall(r"<tr[^>]*>([\s\S]*?)</tr>", html):
        novels = re.findall(r"onebook\.php\?novelid=(\d+)[^>]*>([^<]+)</a>", tr)
        if not novels:
            continue
        authors = re.findall(r"oneauthor\.php\?authorid=\d+[^>]*>([^<]+)</a>", tr)
        cells = [
            _clean(c)
            for c in re.findall(r"<td[^>]*>([\s\S]*?)</td>", tr)
            if _clean(c)
        ]
        genre = next((c for c in cells if "言情" in c or "纯爱" in c or "-" in c), "")
        status = next((c for c in cells if c in {"连载", "完结", "暂停"}), "")
        nid, title = novels[0]
        title = _clean(title)
        items.append(
            RankItem(
                rank=len(items) + 1,
                title=title,
                author=_clean(authors[0]) if authors else "",
                genre=genre or _genre_from_text(title),
                status=status,
                abstract=f"{genre} · {status}".strip(" ·"),
                url=f"https://www.jjwxc.net/onebook.php?novelid={nid}",
                book_id=nid,
                tags=[x for x in [genre, status] if x],
            )
        )
        if len(items) >= 30:
            break
    return FetchResult(
        source_id="jinjiang",
        platform="晋江文学城",
        board_name="公开排行榜",
        items=items,
        raw_note="来源：jjwxc.net/topten.php（公开页面摘要）",
        error=None if items else "未解析到晋江榜单条目",
    )


async def fetch_feilu(cookie: str | None = None) -> FetchResult:
    urls = [
        "https://b.faloo.com/y_0_1.html",
        "https://b.faloo.com/y_0_0.html",
        "https://b.faloo.com/y_0_2.html",
    ]
    items: list[RankItem] = []
    seen: set[str] = set()
    last_code = 0
    for url in urls:
        code, raw, _ = await fetch_bytes(url, cookie=cookie, referer="https://b.faloo.com/")
        last_code = code
        if code != 200 or not raw:
            continue
        html = decode_html(raw, ("gbk", "gb18030", "utf-8"))
        pairs = re.findall(
            r'<a[^>]+href="((?:https?:)?//b\.faloo\.com/(\d+)\.html)"[^>]*>([^<]{2,40})</a>',
            html,
        )
        for href, bid, title in pairs:
            title = _clean(title)
            if not title or title in seen or title.startswith("飞卢"):
                continue
            seen.add(title)
            full = href if href.startswith("http") else f"https:{href}"
            items.append(
                RankItem(
                    rank=len(items) + 1,
                    title=title,
                    genre=_genre_from_text(title),
                    abstract="飞卢公开榜书名摘要（课内扫榜常用男频/同人向信号）",
                    url=full,
                    book_id=bid,
                    tags=["飞卢", _genre_from_text(title)],
                )
            )
            if len(items) >= 40:
                break
        if len(items) >= 40:
            break
    if not items and last_code:
        return FetchResult(
            source_id="feilu",
            platform="飞卢小说",
            board_name="公开点击榜",
            items=[],
            error=f"飞卢页面 HTTP {last_code}",
        )
    return FetchResult(
        source_id="feilu",
        platform="飞卢小说",
        board_name="公开点击榜",
        items=items,
        raw_note="来源：b.faloo.com 公开榜页面（多页汇总）",
        error=None if items else "未解析到飞卢榜单条目",
    )


async def fetch_qimao(cookie: str | None = None) -> FetchResult:
    """抓取男女频大热榜公开 SSR 页面，无需登录 Cookie。"""
    channel_results: dict[str, list[RankItem]] = {}
    failures: list[str] = []
    for channel, label in (("boy", "男"), ("girl", "女")):
        url = f"https://www.qimao.com/paihang/{channel}/hot/date/"
        code, raw, _ = await fetch_bytes(
            url,
            referer="https://www.qimao.com/paihang/",
            user_agent=DEFAULT_UA,
        )
        if code != 200 or not raw:
            failures.append(f"{label}频 HTTP {code}")
            continue
        html = decode_html(raw)
        if "访问验证" in html and "滑动验证" in html:
            failures.append(f"{label}频触发访问验证")
            continue
        parsed = _parse_qimao_rank_html(html, label, "大热榜")
        if parsed:
            channel_results[channel] = parsed
        else:
            failures.append(f"{label}频未解析到榜单")

    # 男女频交错排列，避免下游只取前 20 条时丢掉其中一个频道。
    items: list[RankItem] = []
    boy = channel_results.get("boy", [])
    girl = channel_results.get("girl", [])
    for index in range(max(len(boy), len(girl))):
        if index < len(boy):
            items.append(boy[index])
        if index < len(girl):
            items.append(girl[index])
    for index, item in enumerate(items[:40], start=1):
        item.rank = index

    if not items:
        return FetchResult(
            source_id="qimao",
            platform="七猫小说",
            board_name="男女频大热榜",
            items=[],
            error="；".join(failures) or "七猫公开榜单暂无可解析条目",
        )
    return FetchResult(
        source_id="qimao",
        platform="七猫小说",
        board_name="男女频大热榜",
        items=items[:40],
        raw_note="来源：qimao.com/paihang 男女频公开 SSR 大热榜，无需登录 Cookie",
    )


async def fetch_qidian(cookie: str | None = None) -> FetchResult:
    """抓取起点移动端公开 SSR 榜单，无需 Cookie 或浏览器。"""
    url = "https://m.qidian.com/rank/yuepiao/"
    code, raw, _ = await fetch_bytes(
        url,
        referer="https://m.qidian.com/",
        user_agent=MOBILE_UA,
    )
    if code != 200 or not raw:
        return FetchResult(
            source_id="qidian",
            platform="起点中文网",
            board_name="月票榜",
            items=[],
            error=f"起点移动榜单返回异常（HTTP {code}）",
        )
    html = decode_html(raw)
    items = _parse_qidian_rank_html(html)
    if not items:
        error = (
            "起点移动榜单触发访问验证"
            if "访问验证" in html or "waf-captcha" in html
            else "起点公开榜单暂无可解析条目"
        )
        return FetchResult(
            source_id="qidian",
            platform="起点中文网",
            board_name="月票榜",
            items=[],
            error=error,
        )
    return FetchResult(
        source_id="qidian",
        platform="起点中文网",
        board_name="月票榜",
        items=items[:30],
        raw_note="来源：m.qidian.com/rank/yuepiao 公开 SSR 数据，无需登录 Cookie",
    )


async def fetch_hongguo(cookie: str | None = None) -> FetchResult:
    """抓取红果官网漫剧热播榜的结构化公开数据，无需登录 Cookie。"""
    url = "https://hongguoduanju.com/rank/hot-comic-drama"
    code, raw, _ = await fetch_bytes(
        url,
        referer="https://hongguoduanju.com/",
        user_agent=DEFAULT_UA,
    )
    if code != 200 or not raw:
        return FetchResult(
            source_id="hongguo",
            platform="红果短剧",
            board_name="漫剧热播榜",
            items=[],
            error=f"红果公开榜单返回异常（HTTP {code}）",
        )
    html = decode_html(raw)
    items = _parse_hongguo_rank_html(html)
    if not items:
        return FetchResult(
            source_id="hongguo",
            platform="红果短剧",
            board_name="漫剧热播榜",
            items=[],
            error="红果公开榜单暂无可解析条目",
        )
    return FetchResult(
        source_id="hongguo",
        platform="红果短剧",
        board_name="漫剧热播榜",
        items=items[:30],
        raw_note="来源：hongguoduanju.com/rank/hot-comic-drama 结构化榜单，无需登录 Cookie",
    )


async def fetch_manual(_cookie: str | None = None) -> FetchResult:
    return FetchResult(
        source_id="manual",
        platform="手动录入",
        board_name="本地",
        items=[
            RankItem(
                rank=1,
                title="（手动源）请在热点页或后续表单录入社会热点",
                genre="综合",
                abstract="按九格第 9/11 课：热点需绑定人物冲突与情绪深度，禁止空蹭。",
                tags=["手动"],
            )
        ],
        raw_note="手动源不发起外网请求",
    )


FETCHERS: dict[str, Fetcher] = {
    "fanqie": fetch_fanqie,
    "jinjiang": fetch_jinjiang,
    "feilu": fetch_feilu,
    "qimao": fetch_qimao,
    "qidian": fetch_qidian,
    "hongguo": fetch_hongguo,
    "manual": fetch_manual,
}


async def fetch_source(source_id: str, cookie: str | None = None) -> FetchResult:
    key = source_id.split("-")[0] if source_id.startswith("manual") else source_id
    if source_id.startswith("manual"):
        return await fetch_manual(cookie)
    fetcher = FETCHERS.get(key)
    if not fetcher:
        return FetchResult(
            source_id=source_id,
            platform=source_id,
            board_name="未知",
            items=[],
            error=f"未注册抓取器：{source_id}",
        )
    return await fetcher(cookie)
