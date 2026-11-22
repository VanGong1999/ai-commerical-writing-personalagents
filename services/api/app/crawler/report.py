"""把榜单摘要蒸馏成对作者有用的扫榜报告（九格 9/11 课）。"""
from __future__ import annotations

from collections import Counter
from typing import Any

from .types import FetchResult, RankItem

# 课内常提的题材红黑参考（方法论提示，非实时官方名单）
GENRE_HINTS = {
    "末世": "课内提示：末世/诡异类曾提示饱和，需极强差异化再碰。",
    "重生": "信息差打脸仍常见；注意平台气质与开篇冲突密度。",
    "系统": "男频新人友好壳，但需避免同质金手指。",
    "战神赘婿": "番茄向快节奏爽文常见；注意审核与套路疲劳。",
    "玄幻修仙": "漫剧侧仍有窗口，强调国运/创新设定更稳。",
    "言情": "晋江向重情感细腻；勿用番茄战神节奏硬投。",
    "甜宠": "女频窗口期需看平台口味，甜度与虐点配比要可落地。",
    "综漫": "飞卢同人综漫热，版权与原创边界需自查。",
}


def _keyword_counter(items: list[RankItem]) -> Counter[str]:
    keys = [
        "重生",
        "穿越",
        "系统",
        "修仙",
        "仙侠",
        "玄幻",
        "都市",
        "战神",
        "赘婿",
        "末世",
        "宫斗",
        "甜宠",
        "虐",
        "同人",
        "综漫",
        "游戏",
        "悬疑",
        "科幻",
        "历史",
        "签",
        "闪婚",
        "退婚",
        "离婚",
        "总裁",
    ]
    c: Counter[str] = Counter()
    for it in items:
        blob = f"{it.title} {it.abstract} {it.genre} {' '.join(it.tags)}"
        for k in keys:
            if k in blob:
                c[k] += 1
    return c


def build_report(result: FetchResult) -> dict[str, Any]:
    items = result.items
    genres = Counter((it.genre or "综合") for it in items)
    keywords = _keyword_counter(items)
    top_genres = genres.most_common(8)
    top_keywords = keywords.most_common(12)

    advice: list[str] = []
    advice.append(
        "扫榜顺序（课内）：先认平台气质 → 只看自然榜/公开榜 → 记书名规律 → 读简介冲突 → 再对标开头。"
    )
    advice.append(
        "禁止：空蹭社会热点、先写开头再补书名、把 A 平台节奏硬投 B 平台。"
    )
    if top_keywords:
        head = "、".join(f"{k}×{v}" for k, v in top_keywords[:5])
        advice.append(f"本榜高频词：{head}。可用来做「可写变种」清单，而不是抄前三名设定。")
    for g, _n in top_genres[:3]:
        for key, tip in GENRE_HINTS.items():
            if key in g:
                advice.append(f"「{g}」参考：{tip}")
                break
    if result.platform in {"番茄小说", "飞卢小说"}:
        advice.append("番茄/飞卢气质偏快节奏、强冲突、爽点密；开篇三章要迅速立住金手指与对手。")
    if result.platform == "晋江文学城":
        advice.append("晋江气质偏情感细腻与人物关系；冲突要落到人物动机，而非纯打脸堆叠。")
    if result.platform == "起点中文网":
        advice.append("起点偏长线男频与世界观厚度；注意长线主线与升级循环，而非短剧式集卡点。")
    if result.needs_cookie:
        advice.append(f"Cookie 提示：{result.cookie_hint}")

    hook_seeds: list[str] = []
    for it in items[:8]:
        conflict = it.abstract or it.genre or "强冲突待补"
        hook_seeds.append(
            f"对标《{it.title}》：保留「{it.genre or '综合'}」情绪壳，置换身份/场景 → 提炼一句核心梗（人物+欲望+阻力）。"
            f" 简介线索：{conflict[:60]}"
        )

    md_lines = [
        f"# 扫榜写作报告 · {result.platform} · {result.board_name}",
        "",
        f"> 抓取源：`{result.source_id}` · {result.raw_note or '公开榜摘要'}",
        "",
        "## 一句话结论",
        (
            f"本榜共解析 **{len(items)}** 条公开元数据；"
            f"题材头部：{' / '.join(f'{g}({n})' for g, n in top_genres[:3]) or '暂无'}。"
        ),
        "",
        "## 榜单明细（书名 / 作者 / 题材 / 简介摘要）",
        "",
        "| 排名 | 书名 | 作者 | 题材 | 状态 | 摘要 |",
        "| ---: | --- | --- | --- | --- | --- |",
    ]
    for it in items:
        md_lines.append(
            f"| {it.rank} | {it.title} | {it.author or '—'} | {it.genre or '—'} | "
            f"{it.status or '—'} | {(it.abstract or '—').replace('|', '/')} |"
        )

    md_lines += [
        "",
        "## 题材与关键词热度",
        "",
        "### 题材分布",
    ]
    for g, n in top_genres:
        md_lines.append(f"- **{g}**：{n} 本")
    md_lines += ["", "### 关键词命中"]
    if top_keywords:
        for k, n in top_keywords:
            md_lines.append(f"- `{k}` × {n}")
    else:
        md_lines.append("- （标题摘要中未命中常用题材词，可人工补标）")

    md_lines += ["", "## 给作者的行动建议", ""]
    for a in advice:
        md_lines.append(f"- {a}")

    md_lines += ["", "## 可转化的核心梗种子", ""]
    for s in hook_seeds:
        md_lines.append(f"- {s}")

    md_lines += [
        "",
        "## 合规说明",
        "",
        "- 仅保留公开榜单的书名、排名、作者、题材、简介摘要级信息。",
        "- 不抓取整本正文、付费章节，不绕过登录墙。",
        "- 报告用于选题调研与对标学习，禁止抄袭文面。",
    ]

    return {
        "title": f"{result.platform}·{result.board_name} 扫榜写作报告",
        "markdown": "\n".join(md_lines),
        "stats": {
            "itemCount": len(items),
            "genres": [{"name": g, "count": n} for g, n in top_genres],
            "keywords": [{"name": k, "count": n} for k, n in top_keywords],
            "platform": result.platform,
            "boardName": result.board_name,
            "needsCookie": result.needs_cookie,
            "cookieHint": result.cookie_hint,
            "error": result.error,
        },
        "items": [
            {
                "rank": it.rank,
                "title": it.title,
                "author": it.author,
                "genre": it.genre,
                "abstract": it.abstract,
                "status": it.status,
                "url": it.url,
                "bookId": it.book_id,
                "tags": it.tags,
            }
            for it in items
        ],
        "advice": advice,
        "hookSeeds": hook_seeds,
    }
