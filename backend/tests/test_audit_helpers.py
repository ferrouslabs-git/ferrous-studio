"""should_coalesce decides whether an op batch joins the user's current
editing session row or starts a new one. Pure function; no database."""
from datetime import datetime, timedelta

from app.studio.audit import COALESCE_GAP, should_coalesce

NOW = datetime(2026, 9, 3, 12, 0, 0)


# ── should_coalesce ─────────────────────────────────────────────────────────


def test_no_previous_row_starts_a_new_session():
    assert should_coalesce(None, NOW) is False


def test_a_bump_just_inside_the_gap_coalesces():
    assert should_coalesce(NOW - COALESCE_GAP + timedelta(seconds=1), NOW) is True


def test_a_bump_exactly_at_the_gap_starts_a_new_session():
    assert should_coalesce(NOW - COALESCE_GAP, NOW) is False


def test_a_bump_beyond_the_gap_starts_a_new_session():
    assert should_coalesce(NOW - COALESCE_GAP - timedelta(minutes=5), NOW) is False


def test_clock_skew_does_not_split_a_session():
    # A row stamped slightly in the future (skewed writer) still coalesces.
    assert should_coalesce(NOW + timedelta(minutes=1), NOW) is True


def test_a_custom_gap_is_respected():
    assert should_coalesce(NOW - timedelta(minutes=2), NOW, gap=timedelta(minutes=1)) is False
    assert should_coalesce(NOW - timedelta(seconds=30), NOW, gap=timedelta(minutes=1)) is True
