"""Feedback as a support desk (FS-REQ-51..54): the status vocabulary and how
the old one maps on, resolution time, raising a requirement from a report,
and maintenance contracts.

Pure functions are called directly; route-level rules are pinned by source
inspection, as test_board_rules.py does, because the suite has no database.
"""
import datetime as dt
import importlib.util
import inspect
import pathlib
import types
from typing import get_args
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.studio.board import routes, service
from app.studio.board.models import Comment, Feedback
from app.studio.board.schemas import (
    EntityType,
    FeedbackCreate,
    FeedbackStatus,
    FeedbackUpdate,
    MaintenanceContractCreate,
    MaintenanceContractUpdate,
)
from app.studio.board.statuses import (
    CLOSED_FEEDBACK_STATUSES,
    FEEDBACK_STATUS_LABEL,
    FEEDBACK_STATUSES,
    LEGACY_FEEDBACK_STATUS,
)

MIGRATION = pathlib.Path(__file__).parents[1] / "alembic" / "versions" / "f5c2a8d1e937_feedback_support_desk.py"


def _migration():
    spec = importlib.util.spec_from_file_location("feedback_support_desk", MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# ── Statuses (FS-REQ-53) ─────────────────────────────────────────────────


def test_the_status_vocabulary_is_the_support_desk_one():
    assert FEEDBACK_STATUSES == (
        "New", "EstimatedToConfirm", "OnHold", "NotABug", "Confirmed", "InProgress", "Resolved",
    )
    assert Feedback.STATUSES == FEEDBACK_STATUSES


def test_pydantic_and_the_model_agree_on_the_statuses():
    assert get_args(FeedbackStatus) == FEEDBACK_STATUSES


def test_every_status_has_a_label():
    assert set(FEEDBACK_STATUS_LABEL) == set(FEEDBACK_STATUSES)
    assert FEEDBACK_STATUS_LABEL["EstimatedToConfirm"] == "Estimated – to confirm"
    assert FEEDBACK_STATUS_LABEL["NotABug"] == "Not a bug, added to backlog"


def test_every_old_status_maps_onto_a_new_one():
    assert set(LEGACY_FEEDBACK_STATUS) == {"New", "Triaged", "Accepted", "Declined", "Done"}
    assert set(LEGACY_FEEDBACK_STATUS.values()) <= set(FEEDBACK_STATUSES)
    assert LEGACY_FEEDBACK_STATUS["Done"] == "Resolved"
    assert LEGACY_FEEDBACK_STATUS["Declined"] == "NotABug"


def test_the_migration_maps_exactly_as_the_application_says():
    m = _migration()
    assert m.down_revision == "e8b4c1f7a352"
    assert dict(m._UPGRADE_MAP) == {k: v for k, v in LEGACY_FEEDBACK_STATUS.items() if k != v}
    assert m._NEW_STATUSES == FEEDBACK_STATUSES
    # Every new status has somewhere to go on the way down, and the four that
    # came from an old one go back to it.
    down = dict(m._DOWNGRADE_MAP)
    assert set(down) == set(FEEDBACK_STATUSES) - {"New"}
    assert set(down.values()) <= set(m._OLD_STATUSES)
    for old, new in m._UPGRADE_MAP:
        assert down[new] == old


def test_closed_statuses_are_statuses():
    assert set(CLOSED_FEEDBACK_STATUSES) <= set(FEEDBACK_STATUSES)
    assert "Resolved" in CLOSED_FEEDBACK_STATUSES


def test_a_reporter_still_cannot_choose_the_status():
    assert "status" not in FeedbackCreate.model_fields
    assert "assignee_id" not in FeedbackCreate.model_fields
    assert "estimate_hours" not in FeedbackCreate.model_fields


# ── Assignee, estimate, resolution time (FS-REQ-52) ─────────────────────


def test_triage_can_assign_estimate_and_clear():
    edit = FeedbackUpdate(assignee_id=uuid4(), estimate_hours=2.5)
    assert edit.estimate_hours == 2.5
    assert FeedbackUpdate(clear_assignee=True).clear_assignee
    cleared = FeedbackUpdate(estimate_hours=None)
    assert "estimate_hours" in cleared.model_fields_set and cleared.estimate_hours is None
    with pytest.raises(ValidationError):
        FeedbackUpdate(estimate_hours=-1)
    with pytest.raises(ValidationError):
        FeedbackUpdate(estimate_hours=True)


def test_update_feedback_checks_the_assignee_and_stamps_the_resolution():
    src = inspect.getsource(routes.update_feedback)
    assert "_validate_assignee" in src
    assert "service.resolution_stamp(" in src
    assert '"estimate_hours" in payload.model_fields_set' in src


NOW = dt.datetime(2026, 10, 16, 12, 0)
EARLIER = dt.datetime(2026, 9, 3, 9, 30)


def test_resolving_stamps_now():
    assert service.resolution_stamp("InProgress", "Resolved", None, NOW) == NOW


def test_staying_resolved_keeps_the_first_stamp():
    assert service.resolution_stamp("Resolved", "Resolved", EARLIER, NOW) == EARLIER


def test_reopening_clears_the_stamp():
    assert service.resolution_stamp("Resolved", "InProgress", EARLIER, NOW) is None


def test_an_unresolved_report_has_no_stamp():
    assert service.resolution_stamp("New", "Confirmed", None, NOW) is None


def test_a_resolved_report_missing_its_stamp_gets_one():
    assert service.resolution_stamp("Resolved", "Resolved", None, NOW) == NOW


# ── Comments on a report ─────────────────────────────────────────────────


def test_a_report_can_be_commented_on():
    assert "feedback" in get_args(EntityType)
    assert "feedback" in Comment.ENTITY_TYPES
    assert service._ENTITY_TABLES["feedback"] is Feedback


def test_deleting_a_report_takes_its_thread_with_it():
    src = inspect.getsource(routes.delete_feedback)
    assert 'Comment.entity_type == "feedback"' in src


# ── Raising a requirement (FS-REQ-51) ────────────────────────────────────


def _report(**over):
    base = dict(
        title="Check-in search misses double-barrelled surnames",
        detail="Searching for 'Adeyemi-Cole' finds nothing.",
        kind="bug",
        severity="critical",
        page_url="https://uat.example.org/check-in",
        raised_by_name="Margaret",
        raised_by_email="margaret@example.org",
        created_at=dt.datetime(2026, 10, 1, 9, 0),
        human_id="FS-FB-4",
        assignee_id=None,
        estimate_hours=3.0,
    )
    base.update(over)
    return types.SimpleNamespace(**base)


def test_the_requirement_starts_from_the_report():
    fields = service.requirement_from_feedback(_report(), "UAT")
    assert fields["title"] == "Check-in search misses double-barrelled surnames"
    assert fields["priority"] == "Urgent"
    assert fields["estimate_hours"] == 3.0
    body = fields["body"]
    assert body.startswith("Searching for 'Adeyemi-Cole' finds nothing.")
    assert "Raised from FS-FB-4 (Bug, critical severity) in UAT by Margaret on 01 Oct 2026." in body
    assert "Page: https://uat.example.org/check-in" in body


def test_a_report_with_no_detail_or_page_still_says_where_it_came_from():
    body = service.requirement_from_feedback(_report(detail="", page_url="", raised_by_name=None), "Staging")["body"]
    assert body.startswith("Raised from FS-FB-4")
    assert "by margaret@example.org" in body
    assert "Page:" not in body


@pytest.mark.parametrize("severity,priority", [("low", "Low"), ("medium", "Medium"), ("high", "High"), ("critical", "Urgent")])
def test_severity_becomes_priority(severity, priority):
    assert service.requirement_from_feedback(_report(severity=severity), "UAT")["priority"] == priority


def test_raising_a_requirement_is_board_write_and_refuses_a_second():
    from tests.test_role_permissions import required_permissions

    assert required_permissions(routes.create_requirement_from_feedback) == {"board:write"}
    src = inspect.getsource(routes.create_requirement_from_feedback)
    assert "HTTP_409_CONFLICT" in src
    assert "Requirement.deleted_at.is_(None)" in src
    assert "create_requirement_content(" in src
    assert "_copy_screenshots(" in src
    assert "item.requirement_id = requirement.id" in src


def test_screenshots_are_copied_not_moved():
    src = inspect.getsource(routes._copy_screenshots)
    assert "storage.copy_object(" in src
    assert 'entity_type="requirement"' in src


# ── Maintenance contracts (FS-REQ-54) ────────────────────────────────────


def test_a_contract_has_a_start_hours_and_an_optional_end():
    c = MaintenanceContractCreate(start_date=dt.date(2026, 1, 1), hours_per_month=10)
    assert c.end_date is None and c.hours_per_month == 10
    MaintenanceContractCreate(start_date=dt.date(2026, 1, 1), end_date=dt.date(2026, 1, 1), hours_per_month=0)


def test_a_contract_cannot_end_before_it_starts():
    with pytest.raises(ValidationError):
        MaintenanceContractCreate(start_date=dt.date(2026, 3, 1), end_date=dt.date(2026, 2, 1), hours_per_month=5)
    assert "A contract cannot end before it starts" in inspect.getsource(routes.update_maintenance_contract)


def test_contract_hours_are_a_real_non_negative_number():
    for bad in (-1, True, float("inf")):
        with pytest.raises(ValidationError):
            MaintenanceContractCreate(start_date=dt.date(2026, 1, 1), hours_per_month=bad)


def test_an_update_can_make_a_contract_open_ended():
    edit = MaintenanceContractUpdate(end_date=None)
    assert "end_date" in edit.model_fields_set
    assert "end_date" not in MaintenanceContractUpdate(hours_per_month=4).model_fields_set


def test_contracts_are_read_by_the_board_and_written_by_admins():
    from tests.test_role_permissions import required_permissions

    assert required_permissions(routes.list_maintenance_contracts) == {"board:read"}
    for fn in (routes.create_maintenance_contract, routes.update_maintenance_contract, routes.delete_maintenance_contract):
        assert required_permissions(fn) == {"board:write"}, fn.__name__


def test_the_contracts_table_gets_row_level_security():
    src = MIGRATION.read_text(encoding="utf-8")
    assert "_apply_rls('board_maintenance_contracts')" in src
