from __future__ import annotations

from typing import Any

from sqlmodel import Session, select

from ..models import CrawlReport, CrawlerSource, Hotspot, new_id, utcnow
from ..settings import get_settings
from .fetchers import fetch_source
from .report import build_report
from .types import FetchResult


def cookie_for(source_id: str, override: str | None = None) -> str | None:
    if override and override.strip():
        return override.strip()
    settings = get_settings()
    mapping = {
        "fanqie": getattr(settings, "crawler_cookie_fanqie", "") or "",
        "jinjiang": getattr(settings, "crawler_cookie_jinjiang", "") or "",
        "feilu": getattr(settings, "crawler_cookie_feilu", "") or "",
        "qimao": getattr(settings, "crawler_cookie_qimao", "") or "",
        "qidian": getattr(settings, "crawler_cookie_qidian", "") or "",
        "hongguo": getattr(settings, "crawler_cookie_hongguo", "") or "",
    }
    key = "manual" if source_id.startswith("manual") else source_id
    val = mapping.get(key) or ""
    return val.strip() or None


async def run_and_persist(
    session: Session,
    source: CrawlerSource,
    *,
    cookie: str | None = None,
) -> tuple[CrawlerSource, CrawlReport | None, FetchResult]:
    source.status = "running"
    source.last_run_at = utcnow()
    session.add(source)
    session.commit()
    session.refresh(source)

    result = await fetch_source(source.id, cookie_for(source.id, cookie))
    report_payload = build_report(result)

    report: CrawlReport | None = None
    if result.items or result.error:
        report = CrawlReport(
            id=new_id(),
            source_id=source.id,
            platform=result.platform,
            board_name=result.board_name,
            title=report_payload["title"],
            body_markdown=report_payload["markdown"],
            body_json=report_payload,
            item_count=len(result.items),
            needs_cookie=result.needs_cookie,
            cookie_hint=result.cookie_hint,
            status="ok" if result.items else "failed",
            error=result.error,
        )
        session.add(report)

        # 热点：每条榜单一条 + 一条题材聚合
        for it in result.items[:20]:
            session.add(
                Hotspot(
                    title=f"[{result.platform}#{it.rank}] {it.title}",
                    genre=it.genre or "综合",
                    source=source.id,
                    summary=(
                        f"作者：{it.author or '未知'}。"
                        f"{it.abstract or '公开榜摘要'}。"
                        f"{' '.join(it.tags)}"
                    )[:500],
                    status="ok",
                    meta={
                        "rank": it.rank,
                        "author": it.author,
                        "url": it.url,
                        "bookId": it.book_id,
                        "tags": it.tags,
                        "platform": result.platform,
                        "boardName": result.board_name,
                        "reportId": report.id,
                    },
                )
            )

        genres = report_payload.get("stats", {}).get("genres") or []
        if genres:
            top = "、".join(f"{g['name']}×{g['count']}" for g in genres[:5])
            session.add(
                Hotspot(
                    title=f"{result.platform}题材波动 · {genres[0]['name']}领先",
                    genre=genres[0]["name"],
                    source=source.id,
                    summary=(
                        f"{result.board_name} 本轮题材分布：{top}。"
                        f"建议按平台气质选题，详见扫榜报告。"
                    ),
                    status="ok",
                    meta={
                        "kind": "genre_trend",
                        "genres": genres,
                        "keywords": report_payload.get("stats", {}).get("keywords"),
                        "reportId": report.id,
                        "platform": result.platform,
                    },
                )
            )

    if result.items:
        source.status = "ok"
        source.last_error = None
        source.last_item_count = len(result.items)
        source.needs_cookie = result.needs_cookie
    else:
        source.status = "failed"
        source.last_error = result.error or "无数据"
        source.last_item_count = 0
        source.needs_cookie = result.needs_cookie

    source.last_run_at = utcnow()
    session.add(source)
    session.commit()
    session.refresh(source)
    if report:
        session.refresh(report)
    return source, report, result


def list_reports(session: Session, source_id: str | None = None, limit: int = 30) -> list[CrawlReport]:
    stmt = select(CrawlReport).order_by(CrawlReport.created_at.desc()).limit(limit)
    if source_id:
        stmt = (
            select(CrawlReport)
            .where(CrawlReport.source_id == source_id)
            .order_by(CrawlReport.created_at.desc())
            .limit(limit)
        )
    return list(session.exec(stmt))
