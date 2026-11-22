from datetime import datetime, timezone

import pytest

from app.scheduling import cron_field, next_cron, parse_once, validate_schedule


def test_daily_cron_runs_at_shanghai_nine_am_with_utc_storage():
    after = datetime(2026, 11, 19, 0, 59, tzinfo=timezone.utc)
    assert next_cron("0 9 * * *", after) == datetime(2026, 11, 19, 1, tzinfo=timezone.utc)
    assert next_cron("0 9 * * *", datetime(2026, 11, 19, 1, tzinfo=timezone.utc)) == datetime(2026, 11, 20, 1, tzinfo=timezone.utc)


@pytest.mark.parametrize("spec", ["0s", "*/0 * * * *", "61 * * * *", "0 25 * * *", "0 9 31 2 *", "bad", "once:nonsense", "0,,1 * * * *"])
def test_invalid_schedules_are_rejected(spec):
    with pytest.raises(ValueError):
        validate_schedule(spec)


def test_range_steps_and_sunday_alias():
    assert cron_field("7-20/5", 0, 59) == {7, 12, 17}
    sunday = datetime(2026, 11, 21, 16, tzinfo=timezone.utc)
    assert next_cron("0 9 * * 7", sunday) == datetime(2026, 11, 22, 1, tzinfo=timezone.utc)


def test_once_without_timezone_uses_shanghai_and_explicit_offset_preserved():
    expected = datetime(2026, 11, 19, 1, tzinfo=timezone.utc)
    assert parse_once("once:2026-11-19T09:00:00") == expected
    assert parse_once("once:2026-11-19T09:00:00+08:00") == expected
    assert validate_schedule(" 15m ") == "15m"


def test_day_and_weekday_use_cron_or_semantics():
    after = datetime(2026, 11, 18, 16, tzinfo=timezone.utc)
    assert next_cron("0 9 1 * 4", after) == datetime(2026, 11, 19, 1, tzinfo=timezone.utc)


def test_new_schedule_first_occurrence_obeys_wall_clock_or_interval():
    from app.scheduling import initial_run_at

    now = datetime(2026, 11, 19, 0, 30, tzinfo=timezone.utc)
    assert initial_run_at("0 9 * * *", now) == now.replace(hour=1, minute=0)
    assert initial_run_at("30m", now) == now.replace(hour=1, minute=0)
    assert initial_run_at("once:2026-11-19T09:00:00", now) == now.replace(hour=1, minute=0)
