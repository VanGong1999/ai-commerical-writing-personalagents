"""爬虫 / 榜单热点合规配置与真实抓取。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..crawler.service import list_reports, run_and_persist
from ..crypto import decrypt_secret, encrypt_secret
from ..db import get_session
from ..models import CrawlReport, CrawlerSource, utcnow
from ..schemas import (
    CrawlReportOut,
    CrawlerRunIn,
    CrawlerSourceOut,
    CrawlerSourcePatchIn,
    CreateCrawlerSourceIn,
)

router = APIRouter(prefix="/crawler-sources", tags=["crawler"])


def _decrypt_cookie(row: CrawlerSource) -> str:
    raw = getattr(row, "cookie", None) or ""
    if not raw:
        return ""
    dec = decrypt_secret(raw)
    return dec if dec else raw  # 兼容历史明文


def _out(row: CrawlerSource) -> CrawlerSourceOut:
    return CrawlerSourceOut(
        id=row.id,
        name=row.name,
        scope=row.scope,
        interval=row.interval,
        enabled=row.enabled,
        robots_ack=row.robots_ack,
        last_run_at=row.last_run_at,
        status=row.status,
        needs_cookie=bool(getattr(row, "needs_cookie", False)),
        last_error=getattr(row, "last_error", None),
        last_item_count=int(getattr(row, "last_item_count", 0) or 0),
        has_cookie=bool(_decrypt_cookie(row)),
    )


def _report_out(row: CrawlReport) -> CrawlReportOut:
    return CrawlReportOut(
        id=row.id,
        source_id=row.source_id,
        platform=row.platform,
        board_name=row.board_name,
        title=row.title,
        body_markdown=row.body_markdown,
        body_json=row.body_json or {},
        item_count=row.item_count,
        needs_cookie=row.needs_cookie,
        cookie_hint=row.cookie_hint or "",
        status=row.status,
        error=row.error,
        created_at=row.created_at,
    )


@router.post("", response_model=CrawlerSourceOut)
def create_source(
    body: CreateCrawlerSourceIn,
    session: Session = Depends(get_session),
) -> CrawlerSourceOut:
    existing = session.get(CrawlerSource, body.id)
    if existing:
        return _out(existing)
    row = CrawlerSource(**body.model_dump())
    session.add(row)
    session.commit()
    session.refresh(row)
    return _out(row)


@router.get("", response_model=list[CrawlerSourceOut])
def list_sources(session: Session = Depends(get_session)) -> list[CrawlerSourceOut]:
    rows = list(session.exec(select(CrawlerSource).order_by(CrawlerSource.id)))
    return [_out(r) for r in rows]


@router.patch("/{source_id}", response_model=CrawlerSourceOut)
def patch_source(
    source_id: str,
    body: CrawlerSourcePatchIn,
    session: Session = Depends(get_session),
) -> CrawlerSourceOut:
    row = session.get(CrawlerSource, source_id)
    if not row:
        raise HTTPException(404, "crawler source not found")
    data = body.model_dump(exclude_unset=True)
    if "cookie" in data:
        cookie = str(data["cookie"] or "")
        data["cookie"] = encrypt_secret(cookie) if cookie else ""
    for k, v in data.items():
        setattr(row, k, v)
    session.add(row)
    session.commit()
    session.refresh(row)
    return _out(row)


@router.delete("/{source_id}")
def delete_source(source_id: str, session: Session = Depends(get_session)) -> dict:
    row = session.get(CrawlerSource, source_id)
    if not row:
        raise HTTPException(404, "crawler source not found")
    session.delete(row)
    session.commit()
    return {"status": "deleted"}


@router.post("/{source_id}/run", response_model=CrawlerSourceOut)
async def run_source(
    source_id: str,
    body: CrawlerRunIn | None = None,
    session: Session = Depends(get_session),
) -> CrawlerSourceOut:
    row = session.get(CrawlerSource, source_id)
    if not row:
        raise HTTPException(404, "crawler source not found")
    if not row.robots_ack or not row.enabled:
        raise HTTPException(400, "robots/service terms not acknowledged or source disabled")
    cookie = (body.cookie if body else None) or _decrypt_cookie(row)
    if cookie and not getattr(row, "cookie", None):
        row.cookie = encrypt_secret(cookie)
        session.add(row)
        session.commit()
        session.refresh(row)
    try:
        row, _report, result = await run_and_persist(session, row, cookie=cookie)
    except Exception as e:  # noqa: BLE001
        row.status = "failed"
        row.last_error = str(e)
        row.last_run_at = utcnow()
        session.add(row)
        session.commit()
        session.refresh(row)
        raise HTTPException(502, f"抓取失败：{e}") from e
    if not result.items and result.needs_cookie:
        # 仍返回 200，让前端展示 Cookie 提示与报告
        return _out(row)
    return _out(row)


@router.get("/{source_id}/reports", response_model=list[CrawlReportOut])
def source_reports(
    source_id: str,
    session: Session = Depends(get_session),
) -> list[CrawlReportOut]:
    if not session.get(CrawlerSource, source_id):
        raise HTTPException(404, "crawler source not found")
    return [_report_out(r) for r in list_reports(session, source_id=source_id)]


@router.get("/reports/all", response_model=list[CrawlReportOut])
def all_reports(session: Session = Depends(get_session)) -> list[CrawlReportOut]:
    return [_report_out(r) for r in list_reports(session)]


@router.get("/reports/{report_id}", response_model=CrawlReportOut)
def get_report(
    report_id: str,
    session: Session = Depends(get_session),
) -> CrawlReportOut:
    row = session.get(CrawlReport, report_id)
    if not row:
        raise HTTPException(404, "report not found")
    return _report_out(row)
