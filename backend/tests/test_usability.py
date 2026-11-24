"""Usability studies: the rules a mistake would be costly in.

The suite has no database, so these pin the pure parts -- what a participant
may see, what a study's content may hold, how the averages are worked out --
and inspect the routes for the two things that must hold of every one of them:
the organisation's side is admin-only, and the participant's side resolves its
organisation from the link before it touches anything.
"""
import base64
import inspect

import pytest
from pydantic import ValidationError
from starlette.routing import Mount

from app.main import app
from app.studio.usability import content as rules
from app.studio.usability import routes
from app.studio.usability.schemas import (
    CaptureWrite,
    ConsentIn,
    StudyContent,
    StudyCreate,
    StudyFileIn,
    StudyUpdate,
    TaskAnswerIn,
)

TASK = {
    "id": "a1b2c3d4",
    "title": "Create the function",
    "scenario": "Get the function into the product.",
    "notes": ["Download the file below."],
    "files": ["definition.yaml"],
    "answer_prompt": "What did it answer?",
    "success": "The function exists.",
    "path": "Workbench, New function, Import.",
    "watch": "Whether they find Import.",
    "probes": ["What did you expect to happen?"],
}


# ── what a participant may see ──────────────────────────────────────────────


def test_a_participant_never_receives_the_moderators_half_of_a_task():
    seen = rules.participant_content({"protocol": ["Welcome."], "tasks": [TASK]})
    assert seen["protocol"] == ["Welcome."]
    task = seen["tasks"][0]
    assert task["scenario"] == TASK["scenario"] and task["files"] == ["definition.yaml"]
    for hidden in ("success", "path", "watch", "probes"):
        assert hidden not in task
    assert "Workbench" not in str(seen) and "Whether they find" not in str(seen)


def test_only_files_a_task_lists_can_be_served_to_a_participant():
    content = {"tasks": [TASK, {**TASK, "id": "b2", "files": ["tickets.csv", "definition.yaml"]}]}
    assert rules.listed_files(content) == {"definition.yaml", "tickets.csv"}
    assert rules.listed_files({"tasks": []}) == set()


def test_the_session_route_returns_nothing_past_the_consent_form_until_consent_is_given():
    source = inspect.getsource(routes._session_out)
    gate = source.index("if participant.consent_at is None:")
    for locked in ('"account"', '"tasks"', '"word_list"'):
        assert source.index(locked) > gate, f"{locked} is built before the consent check"


# ── a study's content ───────────────────────────────────────────────────────


def test_a_new_study_starts_with_a_protocol_a_consent_form_and_a_script():
    content = StudyContent.model_validate(rules.default_content("Acme Ltd")).model_dump()
    assert content["protocol"] and content["script"]["welcome"] and content["script"]["after"]
    consent = " ".join(content["consent_text"])
    assert "Acme Ltd" in consent and "recorded" in consent and "voluntary" in consent
    assert content["tasks"] == [] and content["top_words"] == 5 and "Easy to use" in content["words"]


def test_content_is_tidied_blank_lines_go_and_a_task_gets_an_id():
    content = StudyContent.model_validate(
        {
            "protocol": ["  Welcome.  ", "", "   "],
            "tasks": [{"title": " First ", "notes": ["", "a note"], "answer_prompt": "  "}],
            "script": {"welcome": ["hello", ""]},
        }
    )
    assert content.protocol == ["Welcome."]
    task = content.tasks[0]
    assert task.title == "First" and task.notes == ["a note"] and task.answer_prompt is None
    assert task.id and task.id.isalnum()
    assert content.script.welcome == ["hello"]


def test_two_tasks_cannot_share_an_id_because_results_hang_off_it():
    with pytest.raises(ValidationError):
        StudyContent.model_validate({"tasks": [{"id": "abc"}, {"id": "abc"}]})
    with pytest.raises(ValidationError):
        StudyContent.model_validate({"tasks": [{"id": "../etc"}]})


def test_a_clone_round_trips_content_unchanged():
    content = StudyContent.model_validate({**rules.default_content("Acme Ltd"), "tasks": [TASK]}).model_dump()
    assert StudyContent.model_validate(content).model_dump() == content


def test_a_study_needs_a_name_and_a_known_status():
    with pytest.raises(ValidationError):
        StudyCreate(name="   ")
    assert StudyCreate(name="  Pilot round ").name == "Pilot round"
    with pytest.raises(ValidationError):
        StudyUpdate(status="archived")
    assert StudyUpdate(status="closed").model_fields_set == {"status"}


def test_a_file_is_named_not_pathed_and_capped_in_size():
    with pytest.raises(ValidationError):
        StudyFileIn(name="../secrets.txt", data_base64="")
    with pytest.raises(ValidationError):
        StudyFileIn(name="a\\b.csv", data_base64="")
    ok = StudyFileIn(name=" tickets.csv ", data_base64=base64.b64encode(b"a,b\n1,2\n").decode())
    assert ok.name == "tickets.csv" and routes._decode(ok) == b"a,b\n1,2\n"
    with pytest.raises(Exception) as too_big:
        routes._decode(StudyFileIn(name="big.bin", data_base64=base64.b64encode(b"x" * (2 * 1024 * 1024 + 1)).decode()))
    assert getattr(too_big.value, "status_code", None) == 413
    with pytest.raises(Exception) as not_base64:
        routes._decode(StudyFileIn(name="x.txt", data_base64="not base64!"))
    assert getattr(not_base64.value, "status_code", None) == 422


# ── what a participant and a moderator may send ─────────────────────────────


def test_consent_needs_a_name_and_agreement():
    with pytest.raises(ValidationError):
        ConsentIn(name="Pat Example", agree=False)
    with pytest.raises(ValidationError):
        ConsentIn(name=" ", agree=True)
    assert ConsentIn(name="  Pat Example ", agree=True).name == "Pat Example"


def test_an_ease_rating_is_one_to_ten():
    assert TaskAnswerIn(rating=10).rating == 10
    for bad in (0, 11):
        with pytest.raises(ValidationError):
            TaskAnswerIn(rating=bad)
    assert TaskAnswerIn(answer="billing").model_fields_set == {"answer"}   # the rating is left alone


def test_a_capture_changes_only_what_it_sends_and_takes_known_outcomes():
    assert CaptureWrite(errors=2).model_fields_set == {"errors"}
    assert CaptureWrite(success="help").success == "help"
    assert CaptureWrite(success="").success is None           # clearing it
    with pytest.raises(ValidationError):
        CaptureWrite(success="sort of")
    with pytest.raises(ValidationError):
        CaptureWrite(time_seconds=-1)


def test_word_choice_keeps_offered_words_once_and_top_words_must_be_ticked():
    content = {"words": ["Clear", "Slow", "Useful", "Fast"]}
    words, top = rules.clean_words(["Clear", "Slow", "Made up", "Clear", "Useful"], ["Slow", "Fast"], content)
    assert words == ["Clear", "Slow", "Useful"]
    assert top == ["Slow"]            # Fast is offered but was not ticked


# ── the averages ────────────────────────────────────────────────────────────


def test_statistics_match_the_spreadsheet():
    s = rules.stats([60.0, 120.0, 180.0])
    assert s["count"] == 3 and s["mean"] == 120
    assert round(s["sd"], 3) == 60.0                      # sample deviation, as STDEV
    assert round(s["ci95"], 2) == round(1.96 * 60 / 3**0.5, 2)
    assert rules.stats([]) == {"count": 0, "mean": None, "sd": None, "ci95": None}
    assert rules.stats([7.0]) == {"count": 1, "mean": 7.0, "sd": None, "ci95": None}


def test_success_counts_only_finishing_unaided():
    assert rules.success_score("complete") == 1.0
    assert rules.success_score("help") == 0.0 and rules.success_score("fail") == 0.0
    assert rules.success_score(None) is None and rules.success_score("") is None


# ── every route ─────────────────────────────────────────────────────────────


def _usability_routes():
    for mount in app.routes:
        if isinstance(mount, Mount):
            for route in mount.routes:
                if "usability" in getattr(route, "path", ""):
                    yield route


def _is_participant_route(route) -> bool:
    return route.path.startswith("/studio/usability/session")


def test_there_are_routes_on_both_sides():
    all_routes = list(_usability_routes())
    assert [r for r in all_routes if _is_participant_route(r)]
    assert [r for r in all_routes if not _is_participant_route(r)]


@pytest.mark.parametrize(
    "route", [r for r in _usability_routes() if not _is_participant_route(r)], ids=lambda r: r.endpoint.__name__
)
def test_the_organisations_side_is_admin_only_reads_included(route):
    """A participant's row holds a test account's password, so even a read
    needs the permission only an organisation admin holds."""
    source = inspect.getsource(route.endpoint)
    # The literal, not a constant: tests/test_role_permissions.py reads the
    # permission out of each route's source, and so must a reviewer.
    assert 'Depends(require_permission("data:write"))' in source, f"{route.endpoint.__name__} is not admin-only"
    assert "await get_project(db, project_id, ctx)" in source, f"{route.endpoint.__name__} skips the project check"


@pytest.mark.parametrize(
    "route", [r for r in _usability_routes() if _is_participant_route(r)], ids=lambda r: r.endpoint.__name__
)
def test_the_participants_side_resolves_its_organisation_from_the_link_first(route):
    source = inspect.getsource(route.endpoint)
    body = source[source.index('"""') if '"""' in source else 0 :]
    assert "await _session(db, token" in body, f"{route.endpoint.__name__} does not go through _session"
    assert "require_permission" not in source
    assert route.include_in_schema is False


def test_everything_but_reading_the_form_and_consenting_needs_consent():
    open_before_consent = {"usability_session", "usability_session_consent"}
    for route in _usability_routes():
        if not _is_participant_route(route) or route.endpoint.__name__ in open_before_consent:
            continue
        assert "consented=True" in inspect.getsource(route.endpoint), route.endpoint.__name__


def test_the_session_confines_itself_to_one_organisation_before_reading_the_study():
    source = inspect.getsource(routes._session)
    found = source.index("select(Participant).where(Participant.token == token)")
    adopted = source.index("await adopt_account_scope(db, participant.account_id)")
    read_study = source.index("select(Study)")
    assert source.index("await allow_cross_account(db)") < found < adopted < read_study
