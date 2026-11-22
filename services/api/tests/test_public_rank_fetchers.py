from __future__ import annotations

import json

from app.crawler.fetchers import (
    _parse_hongguo_rank_html,
    _parse_qidian_rank_html,
    _parse_qimao_rank_html,
)


def test_parse_qimao_public_rank_html() -> None:
    html = """
    <ul class="rank-list">
      <li class="rank-list-item">
        <span class="rank-number first">1</span>
        <a href="https://www.qimao.com/shuku/195958/" class="s-book-title">盖世神医</a>
        <span class="s-book-info clearfix">
          <a href="/zuozhe/author_14/">狐颜乱语</a>
          <a href="https://www.qimao.com/shuku/a-203-a-a-a-a-a-click-1/">都市</a>
          <a href="https://www.qimao.com/shuku/a-203-219-a-a-a-a-click-1/">都市高武</a>
          <em>连载中</em>
        </span>
        <span class="s-book-intro">医武双绝的都市故事。</span>
      </li>
    </ul>
    """

    items = _parse_qimao_rank_html(html, "男", "大热榜")

    assert len(items) == 1
    assert items[0].rank == 1
    assert items[0].title == "盖世神医"
    assert items[0].author == "狐颜乱语"
    assert items[0].genre == "都市高武"
    assert items[0].book_id == "195958"
    assert items[0].status == "连载中"


def test_parse_qidian_mobile_ssr_rank() -> None:
    context = {
        "pageContext": {
            "pageProps": {
                "pageData": {
                    "records": [
                        {
                            "rankNum": 1,
                            "bName": "神宠供应商",
                            "bid": "1050460263",
                            "bAuth": "轻泉流响",
                            "cat": "轻小说",
                            "subCat": "原生幻想",
                            "desc": "海洋纪元，人类与变异海兽共存。",
                            "rankCnt": "5.17万月票",
                            "cnt": "80.21万字",
                        }
                    ]
                }
            }
        }
    }
    html = (
        '<script id="vite-plugin-ssr_pageContext" type="application/json">'
        f"{json.dumps(context, ensure_ascii=False)}"
        "</script>"
    )

    items = _parse_qidian_rank_html(html)

    assert len(items) == 1
    assert items[0].rank == 1
    assert items[0].title == "神宠供应商"
    assert items[0].author == "轻泉流响"
    assert items[0].genre == "轻小说"
    assert items[0].book_id == "1050460263"
    assert items[0].extra["rankMetric"] == "5.17万月票"


def test_parse_hongguo_structured_rank() -> None:
    payload = {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "itemListElement": [
            {
                "@type": "ListItem",
                "position": 1,
                "name": "全球死考：刚下刑场你让我去考试一季",
                "url": (
                    "https://hongguoduanju.com/detail?"
                    "series_id=7697459724635098174"
                ),
            }
        ],
    }
    html = (
        '<script type="application/ld+json">'
        f"{json.dumps(payload, ensure_ascii=False)}"
        "</script>"
    )

    items = _parse_hongguo_rank_html(html)

    assert len(items) == 1
    assert items[0].rank == 1
    assert items[0].title == "全球死考：刚下刑场你让我去考试一季"
    assert items[0].genre == "漫剧"
    assert items[0].book_id == "7697459724635098174"
