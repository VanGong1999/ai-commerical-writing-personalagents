"""Shared schedule syntax and dispatch types. Wall-clock schedules use Shanghai."""
from __future__ import annotations

import calendar
import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

SCHEDULE_TIMEZONE = ZoneInfo("Asia/Shanghai")
_INTERVAL_RE = re.compile(r"^(\d+)\s*([smhdw])$", re.IGNORECASE)
_UNIT_SECONDS = {"s": 1, "m": 60, "h": 3600, "d": 86400, "w": 604800}

MAINTENANCE_NOOP = "maintenance.noop"
COLLEAGUE_SCAN = "colleague.scan"
_COLLEAGUE_SCAN_TYPES = {COLLEAGUE_SCAN, "colleague.scan_gaps", "colleague_scan"}

# Agent-run jobs belong to the independent agent worker.
WORKER_JOB_TYPES = frozenset({
    "kb.ingest", "kb.analyze", "kb.report", "kb.reindex_all",
    "knowledge.vector_ingest", "knowledge.reindex", "crawler.run", "hotspot.refresh",
    "analytics.review", "run.digest", "usage.rollup", "gap_scan.prioritize",
    "eval.run", "eval.score_artifact", "eval.patrol", MAINTENANCE_NOOP,
})

# The personal schedule_task tool supplies conversation context but no job payload.
SCHEDULE_TASK_JOB_TYPES = (WORKER_JOB_TYPES - {
    "kb.ingest", "kb.analyze", "kb.report", "analytics.review", "run.digest",
    "eval.run", "eval.score_artifact",
}) | {COLLEAGUE_SCAN, "assistant.follow_up"}


def scheduled_job_type(task_id: str, payload_type: str | None) -> str:
    """Resolve a template type and keep legacy scheduler IDs working."""
    job_type = str(payload_type or task_id or MAINTENANCE_NOOP)
    if task_id in {COLLEAGUE_SCAN, "colleague.scan_gaps"} or job_type in _COLLEAGUE_SCAN_TYPES:
        return COLLEAGUE_SCAN
    return job_type


def validate_schedule_job_type(value: str | None) -> str:
    job_type = MAINTENANCE_NOOP if value is None else value
    if isinstance(job_type, str) and job_type:
        canonical = scheduled_job_type("", job_type)
        if canonical in SCHEDULE_TASK_JOB_TYPES:
            return canonical
    supported = "、".join(sorted(SCHEDULE_TASK_JOB_TYPES))
    raise ValueError(f"不支持定时任务类型 {job_type!r}。可选类型：{supported}")


def parse_interval(spec: str) -> timedelta | None:
    match = _INTERVAL_RE.fullmatch((spec or "").strip())
    if not match:
        return None
    seconds = int(match[1]) * _UNIT_SECONDS[match[2].lower()]
    if seconds <= 0:
        raise ValueError("调度间隔必须大于零")
    try:
        return timedelta(seconds=seconds)
    except OverflowError as exc:
        raise ValueError("调度间隔过大") from exc


def parse_once(spec: str) -> datetime | None:
    if not (spec or "").strip().startswith("once:"):
        return None
    try:
        value = datetime.fromisoformat(spec.strip()[5:].strip().replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("一次性任务需要有效的 ISO8601 时间") from exc
    if value.tzinfo is None:
        value = value.replace(tzinfo=SCHEDULE_TIMEZONE)
    return value.astimezone(timezone.utc)


def cron_field(field: str, lo: int, hi: int) -> set[int]:
    values: set[int] = set()
    for part in field.split(","):
        if not part:
            raise ValueError("Cron 字段不能为空")
        base, slash, step_text = part.partition("/")
        step = int(step_text) if slash else 1
        if step <= 0:
            raise ValueError("Cron 步长必须大于零")
        if base == "*":
            start, end = lo, hi
        elif "-" in base:
            left, right = base.split("-", 1)
            start, end = int(left), int(right)
        else:
            start = int(base)
            end = hi if slash else start
        if not lo <= start <= end <= hi:
            raise ValueError(f"Cron 字段超出 {lo}–{hi} 范围")
        values.update(range(start, end + 1, step))
    if not values:
        raise ValueError("Cron 字段无有效值")
    return values


def parse_cron(spec: str) -> tuple[list[set[int]], list[str]]:
    fields = (spec or "").split()
    if len(fields) != 5:
        raise ValueError("Cron 必须有五个字段：分 时 日 月 星期")
    limits = [(0, 59), (0, 23), (1, 31), (1, 12), (0, 7)]
    values = [cron_field(field, lo, hi) for field, (lo, hi) in zip(fields, limits)]
    values[4] = {day % 7 for day in values[4]}
    if fields[4] == "*" and not any(day <= calendar.monthrange(2024, month)[1] for month in values[3] for day in values[2]):
        raise ValueError("Cron 日期不存在")
    return values, fields


def validate_schedule(spec: str) -> str:
    value = (spec or "").strip()
    if parse_once(value) is not None or parse_interval(value) is not None:
        return value
    parse_cron(value)
    return value


def next_cron(spec: str, after: datetime) -> datetime | None:
    (mins, hours, days, months, dows), fields = parse_cron(spec)
    aware = after if after.tzinfo else after.replace(tzinfo=timezone.utc)
    local = aware.astimezone(SCHEDULE_TIMEZONE)
    for offset in range(366 * 8):
        day = (local + timedelta(days=offset)).date()
        if day.month not in months:
            continue
        dom, dow = day.day in days, (day.weekday() + 1) % 7 in dows
        matches_day = (dom or dow) if fields[2] != "*" and fields[4] != "*" else (dom and dow)
        if not matches_day:
            continue
        for hour in sorted(hours):
            for minute in sorted(mins):
                candidate = datetime(day.year, day.month, day.day, hour, minute, tzinfo=SCHEDULE_TIMEZONE)
                if candidate > local:
                    return candidate.astimezone(timezone.utc)
    return None


def initial_run_at(spec: str, now: datetime) -> datetime:
    """First occurrence for a new task; never fire a future cron immediately."""
    validate_schedule(spec)
    aware = now if now.tzinfo else now.replace(tzinfo=timezone.utc)
    once = parse_once(spec)
    if once is not None:
        return once
    interval = parse_interval(spec)
    if interval is not None:
        return (aware + interval).astimezone(timezone.utc)
    result = next_cron(spec, aware)
    if result is None:
        raise ValueError("未找到有效的下一次执行时间")
    return result
