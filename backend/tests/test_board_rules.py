"""Board rules ported from software-management (2026-09-11).

The rollup weights, the burndown arithmetic and the "question" convention
are pure functions in service.py; the sprint-release rule, no-demotion and
own-only comment delete live in routes/schemas. Pure functions are called
directly; the route-level rules are pinned by source inspection, the same
way test_role_permissions.py does it, because the suite has no database.
"""
import datetime as dt
import inspect
import types
from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError

from app.studio.board import routes, service
from app.studio.board.schemas import (
    EpicCreate,
    EpicProgress,
    EpicUpdate,
    FeatureCreate,
    FeatureUpdate,
    RequirementCreate,
    RequirementUpdate,
    SprintCreate,
    SprintUpdate,
)
from app.studio.board.statuses import WORK_STATUSES, roll_up_status


def _req(status: str, estimate_hours: float | None = None, **extra):
    return types.SimpleNamespace(id=uuid4(), status=status, estimate_hours=estimate_hours, **extra)


# ── Progress rollup ──────────────────────────────────────────────────────


def test_rollup_weights_match_effort_js():
    """Done = 1, ToTest = 0.75, InProgress = 0.5, NotStarted/Blocked = 0."""
    rows = [_req("Done"), _req("ToTest"), _req("InProgress"), _req("NotStarted"), _req("Blocked")]
    out = service.progress_rollup(rows)
    assert (out["total"], out["done"], out["in_progress"], out["to_test"]) == (5, 1, 1, 1)
    assert out["pct"] == round(100 * 2.25 / 5)


def test_rollup_hours_sum_only_existing_estimates():
    """``hours_done`` credits every estimate by its status weight -- the
    same arithmetic as effort.ts's rollup(), so a ToTest or InProgress
    requirement counts for part of its estimate rather than nothing."""
    rows = [_req("Done", 4.0), _req("ToTest", 2.5), _req("InProgress", 2.0), _req("Blocked", 1.0), _req("NotStarted", None)]
    out = service.progress_rollup(rows)
    assert out["hours"] == 9.5
    assert out["hours_done"] == pytest.approx(4.0 + 2.5 * 0.75 + 2.0 * 0.5)
    assert out["estimated"] == 4
    assert out["unestimated"] == 1
    assert out["coverage"] == pytest.approx(4 / 5)


def test_rollup_of_nothing_has_full_coverage():
    out = service.progress_rollup([])
    assert out["total"] == 0 and out["pct"] == 0 and out["hours"] == 0
    assert out["coverage"] == 1.0


def test_rollup_is_the_epic_progress_shape():
    rows = [_req("Done", 1.0), _req("InProgress")]
    progress = EpicProgress(**service.progress_rollup(rows))
    assert set(progress.model_dump()) == {
        "total", "done", "in_progress", "to_test", "pct", "hours", "hours_done", "estimated", "unestimated", "coverage",
    }


def test_routes_empty_progress_is_the_service_rollup_of_nothing():
    assert routes._EMPTY_PROGRESS == service.progress_rollup([])


# ── Questions from the agent ─────────────────────────────────────────────


def _comment(body: str, agent_id: UUID | None = None):
    return types.SimpleNamespace(id=uuid4(), body=body, agent_id=agent_id)


def test_agent_authored_comment_on_blocked_requirement_is_a_question():
    agent = uuid4()
    r = _req("Blocked")
    c = _comment("Which database should this use?", agent_id=agent)
    assert service.detect_questions([r], {r.id: c}, [agent]) == [(r, c)]


def test_human_comment_starting_question_is_a_question():
    r = _req("Blocked")
    c = _comment("  question: is the API versioned?")
    assert service.detect_questions([r], {r.id: c}, []) == [(r, c)]


def test_blocked_with_unrelated_latest_comment_is_not_a_question():
    r = _req("Blocked")
    c = _comment("Waiting on the design review.", agent_id=uuid4())
    assert service.detect_questions([r], {r.id: c}, [uuid4()]) == []


def test_non_blocked_requirement_is_never_a_question():
    agent = uuid4()
    r = _req("NotStarted")
    c = _comment("Question: really?", agent_id=agent)
    assert service.detect_questions([r], {r.id: c}, [agent]) == []


def test_blocked_without_a_comment_is_not_a_question():
    r = _req("Blocked")
    assert service.detect_questions([r], {}, [uuid4()]) == []


# ── Burndown arithmetic ──────────────────────────────────────────────────


def _days(start: dt.date, n: int) -> list[dt.date]:
    return [start + dt.timedelta(days=i) for i in range(n)]


def test_burndown_series_reconstructs_scope_and_remaining():
    sprint = uuid4()
    r1, r2 = uuid4(), uuid4()
    d0 = dt.date(2026, 9, 1)
    days = _days(d0, 5)
    today = d0 + dt.timedelta(days=3)  # day 4 of 5
    membership = {
        r1: [(d0, sprint)],
        r2: [(d0, None), (d0 + dt.timedelta(days=2), sprint)],  # added on day 3
    }
    status = {r1: [(d0 + dt.timedelta(days=3), "Done")]}  # done on day 4
    estimates = {r1: 4.0, r2: None}

    out = service.burndown_series(sprint, days, [r1, r2], membership, status, estimates, today)

    assert out["sprint_id"] == sprint and out["note"] is None
    assert out["dates"] == days
    assert out["total"] == 1 and out["total_hours"] == 4.0
    assert out["scope"] == [1, 1, 2, 2, None]
    assert out["remaining"] == [1, 1, 2, 1, None]
    assert out["scope_hours"] == [4.0, 4.0, 4.0, 4.0, None]
    assert out["remaining_hours"] == [4.0, 4.0, 4.0, 0.0, None]
    assert out["ideal"] == [round(1 * (1 - i / 4), 1) for i in range(5)]
    assert out["ideal"][0] == 1.0 and out["ideal"][-1] == 0.0
    assert out["ideal_hours"] == [4.0, 3.0, 2.0, 1.0, 0.0]
    # Coverage is over CURRENT membership (both, on today), not the start.
    assert out["estimated_count"] == 1 and out["unestimated_count"] == 1


def test_one_day_sprint_ideal_is_flat_zero():
    sprint = uuid4()
    r1 = uuid4()
    day = dt.date(2026, 9, 1)
    out = service.burndown_series(sprint, [day], [r1], {r1: [(day, sprint)]}, {}, {r1: 2.0}, day)
    assert out["ideal"] == [0.0] and out["ideal_hours"] == [0.0]
    assert out["total"] == 1 and out["remaining"] == [1]


def test_empty_burndown_carries_every_key():
    assert set(service._EMPTY_BURNDOWN) == {
        "dates", "remaining", "ideal", "total", "remaining_hours", "ideal_hours", "total_hours",
        "scope", "scope_hours", "estimated_count", "unestimated_count",
    }


# ── Schema rules ─────────────────────────────────────────────────────────


def test_a_sprint_must_belong_to_a_release():
    with pytest.raises(ValidationError, match="must belong to a release"):
        SprintCreate(name="x")
    with pytest.raises(ValidationError, match="must belong to a release"):
        SprintCreate(name="x", release_id=None)
    assert SprintCreate(name="x", release_id=uuid4()).release_id is not None


def test_sprint_update_keeps_clear_release_for_the_route_to_refuse():
    assert "clear_release" in SprintUpdate.model_fields
    assert "release_id" in SprintUpdate.model_fields


def test_queue_position_rejects_booleans_and_out_of_range_ints():
    with pytest.raises(ValidationError):
        RequirementUpdate(queue_position=True)
    with pytest.raises(ValidationError):
        RequirementUpdate(queue_position=-1)
    with pytest.raises(ValidationError):
        RequirementUpdate(queue_position=2_147_483_648)
    assert RequirementUpdate(queue_position=None).queue_position is None
    assert RequirementUpdate(queue_position=0).queue_position == 0
    assert RequirementUpdate(queue_position=3).queue_position == 3


def test_queue_position_is_not_settable_at_creation():
    assert "queue_position" not in RequirementCreate.model_fields


def test_an_epic_has_no_settable_status():
    """It is rolled up from the requirements under it (statuses.roll_up_status),
    so neither create nor update accepts one."""
    assert "status" not in EpicCreate.model_fields
    assert "status" not in EpicUpdate.model_fields


# ── Assignment (2026-09-18) ──────────────────────────────────────────────


def test_every_level_of_the_board_can_be_assigned():
    """Requirements always could; epics and features gained it so that "who
    is looking after this?" has an answer above the requirement level."""
    for schema in (RequirementCreate, EpicCreate, FeatureCreate):
        assert "assignee_id" in schema.model_fields, schema.__name__
    for schema in (RequirementUpdate, EpicUpdate, FeatureUpdate):
        assert "assignee_id" in schema.model_fields, schema.__name__
        assert "clear_assignee" in schema.model_fields, schema.__name__


def test_an_assignee_must_be_a_member_of_the_board_organisation():
    """The FK only says "a user exists somewhere", so the route checks the
    membership -- and all three levels go through the same helper, or they
    would drift into accepting different ids."""
    src = inspect.getsource(routes._validate_assignee)
    assert 'Membership.scope_id == board.account_id' in src
    assert 'Membership.status == "active"' in src
    assert "not a member of this organisation" in src
    for fn in (routes._validate_requirement_refs, routes.create_epic_content, routes.update_epic,
               routes.create_feature_content, routes.update_feature):
        assert "_validate_assignee" in inspect.getsource(fn), fn.__name__


def test_clearing_an_assignment_is_the_flag_not_a_null():
    """A null id means "leave it alone" on every link the board patches, so
    an older client that omits nothing cannot wipe an assignment by accident."""
    src = inspect.getsource(routes.update_epic)
    assert 'clear_assignee = data.pop("clear_assignee", False)' in src
    assert 'if field in ("release_id", "assignee_id") and value is None:' in src


def test_assignment_is_on_the_audit_trail():
    assert "assignee_id" in routes._EPIC_EVENT_FIELDS
    assert "assignee_id" in routes._FEATURE_EVENT_FIELDS
    assert "assignee_id" in routes._REQUIREMENT_EVENT_FIELDS


# ── Route-level rules, pinned by source ──────────────────────────────────


def test_update_sprint_refuses_to_clear_the_release():
    assert "a sprint must belong to a release" in inspect.getsource(routes.update_sprint)


def test_closing_a_sprint_no_longer_demotes_the_others():
    """Several sprints may be open at once (software-management,
    2026-09-04): closing one must not touch any other sprint."""
    src = inspect.getsource(service.close_sprint)
    assert "Sprint.id !=" not in src and "!= sprint.id" not in src


def test_closing_a_sprint_clears_queue_positions():
    assert "queue_position = None" in inspect.getsource(service.close_sprint)


def test_closing_a_closed_sprint_returns_nothing():
    """A repeated PATCH with closed=true must not empty the sprint twice."""
    assert "if sprint.closed_at is not None:" in inspect.getsource(service.close_sprint)


# ── The two status vocabularies ──────────────────────────────────────────


def test_sprint_and_release_statuses_carry_no_side_effects():
    """A delivery status is a free label: the route must key nothing off it.
    What used to (an "active" sprint being the only workable one, "done"
    emptying it) hangs off closed_at now."""
    src = inspect.getsource(routes.update_sprint)
    assert "close_sprint" in src
    for value in ("DeployedToUAT", "DeployedToStaging", "DeployedToLive"):
        assert value not in src


def test_reaching_live_stamps_shipped_at_once_and_never_clears_it():
    src = inspect.getsource(routes.update_release)
    assert 'release.status == "DeployedToLive" and release.shipped_at is None' in src
    assert "shipped_at = None" not in src


@pytest.mark.parametrize(
    "statuses,expected",
    [
        ([], "NotStarted"),
        (["Done", "Done"], "Done"),
        (["NotStarted", "NotStarted"], "NotStarted"),
        # Blocked only surfaces once it is the only thing left unfinished.
        (["Done"] * 9 + ["Blocked"], "Blocked"),
        (["Blocked"], "Blocked"),
        (["InProgress", "Blocked"], "InProgress"),
        # Something has been picked up and run into a wall: a started epic
        # with a blocked item in it, not a blocked epic.
        (["Blocked", "NotStarted"], "InProgress"),
        (["Done", "ToTest"], "ToTest"),
        (["ToTest"], "ToTest"),
        (["Done", "NotStarted"], "InProgress"),
    ],
)
def test_roll_up_status_lets_progress_dominate(statuses, expected):
    assert roll_up_status(statuses) == expected


def test_every_rolled_up_status_is_a_requirement_status():
    """Features and epics share the requirement vocabulary exactly -- they
    are reporting the same work, so a value it cannot produce would be a
    value nothing can explain."""
    produced = {
        roll_up_status(c)
        for c in ([], ["Done"], ["NotStarted"], ["InProgress"], ["ToTest"], ["Blocked"], ["Done", "Blocked"])
    }
    assert produced <= set(WORK_STATUSES)


def test_only_the_author_deletes_a_comment():
    """An agent's comment belongs to the agent, not to whoever minted its
    token: an agent request matches on agent_id, a human one on author_id
    plus no agent at all -- so neither can delete the other's."""
    source = inspect.getsource(routes.delete_comment)
    assert "Agent.board_token_id == ctx.board_token_id" in source
    assert "comment.agent_id == acting_agent_id" in source
    assert "comment.author_id == ctx.user_id and comment.agent_id is None" in source
    assert "You can only delete your own comments" in source


def test_requirement_events_keep_status_and_drop_blocked_from():
    """sprint_burndown reads detail["status"]["to"]; blocked_from is
    bookkeeping derived from that same transition."""
    assert "status" in routes._REQUIREMENT_EVENT_FIELDS
    assert "blocked_from" not in routes._REQUIREMENT_EVENT_FIELDS
    assert "queue_position" in routes._REQUIREMENT_EVENT_FIELDS


def test_claim_writes_the_same_status_event_as_a_patch():
    source = inspect.getsource(service.claim_requirement)
    assert '"requirement.updated"' in source and '"requirement.claimed"' not in source


# ── Event detail helpers ─────────────────────────────────────────────────


def test_diff_clips_long_strings_with_an_ellipsis():
    long = "a" * 81
    out = routes._diff({"body": long}, {"body": "b"}, ("body",))
    assert out["body"]["from"] == "a" * 80 + "…"
    assert out["body"]["to"] == "b"
    assert routes._clip("a" * 80) == "a" * 80


def test_diff_stringifies_uuids_and_dates_and_leaves_scalars_alone():
    before_id, after_id = uuid4(), uuid4()
    day = dt.date(2026, 9, 11)
    out = routes._diff(
        {"release_id": before_id, "start_date": None, "queue_position": None, "estimate_hours": 2.5},
        {"release_id": after_id, "start_date": day, "queue_position": 3, "estimate_hours": None},
        ("release_id", "start_date", "queue_position", "estimate_hours"),
    )
    assert out["release_id"] == {"from": str(before_id), "to": str(after_id)}
    assert out["start_date"] == {"from": None, "to": "2026-09-11"}
    assert out["queue_position"] == {"from": None, "to": 3}
    assert out["estimate_hours"] == {"from": 2.5, "to": None}


def test_diff_skips_unchanged_fields():
    assert routes._diff({"title": "a", "body": "b"}, {"title": "a", "body": "c"}, ("title", "body")) == {
        "body": {"from": "b", "to": "c"}
    }
