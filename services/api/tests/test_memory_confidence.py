from datetime import timedelta

import pytest

from app.memory_service import compute_confidence
from app.models import utcnow


def test_neutral():
    assert compute_confidence(0, False, "scratch", None, utcnow()) == pytest.approx(0.5)


def test_high_recall_bible():
    assert compute_confidence(5, False, "bible", None, utcnow()) == pytest.approx(0.8)


def test_hypothesis_penalty():
    assert compute_confidence(0, True, "scratch", None, utcnow()) == pytest.approx(0.2)


def test_stale_decay():
    old = utcnow() - timedelta(days=100)
    assert compute_confidence(0, False, "scratch", old, utcnow()) == pytest.approx(0.3)


def test_clamps_to_unit():
    low = compute_confidence(0, True, "scratch", utcnow() - timedelta(days=400), utcnow())
    high = compute_confidence(999, False, "bible", utcnow(), utcnow())
    assert 0.0 <= low <= 1.0 and 0.0 <= high <= 1.0
