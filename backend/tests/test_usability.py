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
from app.studio.usability import agent_routes, routes
from app.studio.usability.schemas import (
    AgentCaptureWrite,
    AgentObservationWrite,
    AgentParticipantWrite,
    AgentStudyCreate,
    AgentStudyImport,
    AgentStudyPatch,
    AgentTask,
    AgentTaskOrder,
    AgentTaskPatch,
    AgentTasksIn,
    CaptureWrite,
    ConsentIn,
    ParticipantWrite,
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


@pytest.mark.parametrize("schema", [StudyCreate, StudyUpdate], ids=lambda s: s.__name__)
def test_the_application_address_is_a_web_address_because_a_participant_is_given_it_as_a_link(schema):
    base = {"name": "Pilot"} if schema is StudyCreate else {}
    for bad in ("javascript:alert(1)", " JavaScript:alert(1)", "data:text/html,x", "app.example.com", "https://a b"):
        with pytest.raises(ValidationError):
            schema(**base, app_url=bad)
    assert schema(**base, app_url="  HTTPS://app.example.com/x ").app_url == "HTTPS://app.example.com/x"
    assert schema(**base, app_url="http://localhost:5173").app_url == "http://localhost:5173"
    assert schema(**base, app_url="").app_url == ""           # clearing it


def test_every_participant_opens_the_studys_address_not_one_of_their_own():
    from app.studio.usability.models import Participant, Study

    assert "app_url" not in ParticipantWrite.model_fields
    assert ParticipantWrite(app_url="https://elsewhere.example.com").model_fields_set == set()   # an old form's field is dropped
    study = Study(name="Pilot", app_url="https://app.example.com", content={"tasks": []})
    old = Participant(code="P1", token="t", app_url="https://stale.example.com")   # set before the field went
    assert routes._participant_out(study, old, {})["app_url"] == "https://app.example.com"
    assert "participant.app_url" not in inspect.getsource(routes._session_out)
    assert "study.app_url" in inspect.getsource(routes._session_out)


def test_a_study_that_tests_signing_up_gives_an_email_and_instructions_not_a_password():
    assert rules.default_content("Acme")["sign_up"] is False
    assert StudyContent().sign_up_text == rules.SIGN_UP_TEXT
    older = {"protocol": ["Welcome."]}                      # stored before sign_up existed
    assert rules.with_defaults(older)["sign_up"] is False and rules.with_defaults(older)["protocol"] == ["Welcome."]
    assert rules.with_defaults({"sign_up": True, "sign_up_text": []})["sign_up_text"] == []
    source = inspect.getsource(routes._session_out)
    assert '"password": "" if content["sign_up"]' in source
    assert AgentStudyPatch(sign_up=True, sign_up_text=["Use this email", " "]).sign_up_text == ["Use this email"]


def test_a_participant_uses_the_studys_test_account_unless_their_own_details_differ():
    from app.studio.usability.models import Participant, Study

    study = Study(name="Pilot", account_email="study@example.com", account_password="pw", account_notes="Ask for a code")
    assert routes.account_for(study, Participant(code="P1", token="t")) == {
        "account_email": "study@example.com", "account_password": "pw", "account_notes": "Ask for a code",
    }
    own = Participant(code="P2", token="u", account_email="p2@example.com", account_notes="")
    assert routes.account_for(study, own) == {
        "account_email": "p2@example.com", "account_password": "pw", "account_notes": "Ask for a code",
    }
    assert "account_for(study, participant)" in inspect.getsource(routes._session_out)
    # an agent sets the study's test account but never reads its password back
    assert AgentStudyPatch(account_password="pw").model_fields_set == {"account_password"}
    assert '"account_password_set": bool(study.account_password)' in inspect.getsource(agent_routes._out)
    assert "account_password" not in inspect.getsource(routes._export)


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


def _is_agent_route(route) -> bool:
    return "/usability/agent/" in route.path


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
    # permission out of each route's source, and so must a reviewer. An agent
    # route takes the guard a board token passes; the permission is the same.
    guard = "require_studio_permission" if _is_agent_route(route) else "require_permission"
    assert f'Depends({guard}("data:write"))' in source, f"{route.endpoint.__name__} is not admin-only"
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


# ── an agent's side ─────────────────────────────────────────────────────────


def test_a_board_token_reaches_only_the_agent_routes():
    """The editor's routes return participants with their links and test
    account passwords, so none of them may take the guard a token passes."""
    for route in _usability_routes():
        source = inspect.getsource(route.endpoint)
        assert ("require_studio_permission(" in source) == _is_agent_route(route), route.endpoint.__name__


def test_an_agent_never_receives_a_participants_link_or_password():
    """Anything an agent reads lands in its transcript."""
    out = {"id": "p1", "code": "P1", "token": "secret-link", "account_password": "hunter2", "role": "Dev"}
    view = agent_routes._participant_view(out)
    assert "token" not in view and "account_password" not in view
    assert view["account_password_set"] is True and view["role"] == "Dev"
    assert agent_routes._participant_view({**out, "account_password": ""})["account_password_set"] is False
    # every agent route that hands back a participant goes through the view
    for route in _usability_routes():
        source = inspect.getsource(route.endpoint)
        if _is_agent_route(route) and "_participant_out(" in source:
            assert source.count("_participant_out(") == source.count("_participant_view(_participant_out("), (
                route.endpoint.__name__
            )
    # and nothing an agent reaches returns the editor's full study
    assert "_study_detail" not in inspect.getsource(agent_routes)


def test_an_agent_cannot_delete_or_replace_and_cannot_write_to_a_closed_study():
    agent = [r for r in _usability_routes() if _is_agent_route(r)]
    assert agent and not any("DELETE" in r.methods or "PUT" in r.methods for r in agent)
    # new studies, a copy of a closed one, and reopening are the writes a closed study allows
    exempt = {
        "create_usability_study_for_agent", "import_usability_study_for_agent",
        "clone_usability_study_for_agent", "update_usability_study_for_agent",
    }
    for route in agent:
        if route.methods & {"POST", "PATCH"} and route.endpoint.__name__ not in exempt:
            assert "_open(await _study(" in inspect.getsource(route.endpoint), route.endpoint.__name__
    assert "_open(study)" in inspect.getsource(agent_routes.update_usability_study_for_agent)


def test_an_agents_study_change_takes_content_fields_but_not_tasks():
    patch = AgentStudyPatch(protocol=["Read me", " "], script={"welcome": ["Hi"]}, status="closed")
    assert patch.protocol == ["Read me"] and patch.script.model_fields_set == {"welcome"}
    for bad in ({"tasks": []}, {"status": "archived"}, {"top_words": 0}, {"script": {"intro": []}}):
        with pytest.raises(ValidationError):
            AgentStudyPatch(**bad)


@pytest.mark.parametrize(
    "schema, field, value",
    [
        (AgentStudyCreate, "app_url", "https://elsewhere.example"),
        (AgentStudyPatch, "app_url", "https://elsewhere.example"),
        (AgentStudyPatch, "consent_title", "New terms"),
        (AgentStudyPatch, "consent_text", ["You agree to anything"]),
        (AgentParticipantWrite, "app_url", "https://elsewhere.example"),
        (AgentStudyImport, "app_url", "https://elsewhere.example"),
    ],
)
def test_an_agent_cannot_set_where_participants_go_or_what_they_sign(schema, field, value):
    """An agent reads what participants typed, and anyone with a link can
    type it; text steering the agent must not redirect participants or
    rewrite their consent."""
    base = {"name": "x"} if schema in (AgentStudyCreate, AgentStudyImport) else {}
    if schema is AgentStudyImport:
        base["content"] = rules.default_content("Acme Ltd")
    with pytest.raises(ValidationError):
        schema(**base, **{field: value})


def test_an_imported_study_takes_the_default_consent_wording():
    source = inspect.getsource(agent_routes.import_usability_study_for_agent)
    assert '"consent_text": default["consent_text"]' in source and "app_url" not in source


def test_an_agents_participant_capture_and_observation_refuse_unknown_fields():
    assert AgentParticipantWrite(account_password="pw").model_fields_set == {"account_password"}
    for schema, bad in ((AgentParticipantWrite, {"token": "x"}), (AgentParticipantWrite, {"code": "P9"}),
                        (AgentParticipantWrite, {"app_url": "https://app.example.com"}),
                        (AgentCaptureWrite, {"rating": 5}), (AgentObservationWrite, {"id": "x"})):
        with pytest.raises(ValidationError):
            schema(**bad)
    with pytest.raises(ValidationError):
        AgentCaptureWrite(success="nearly")


def test_an_agent_imports_only_a_whole_exported_study():
    with pytest.raises(ValidationError):
        AgentStudyImport(name="x")
    made = AgentStudyImport(name="x", content=rules.default_content("Acme Ltd"))
    assert made.content.consent_text


def test_a_reorder_names_every_task():
    with pytest.raises(ValidationError):
        AgentTaskOrder(task_ids=[])


def test_an_agents_task_needs_a_title_and_a_scenario_and_no_unknown_fields():
    ok = AgentTask(title=" Create it ", scenario="Get the function in.", notes=["", "use the file"])
    assert ok.title == "Create it" and ok.notes == ["use the file"] and "id" not in ok.model_dump()
    for bad in ({"title": "x"}, {"scenario": "x"}, {"title": " ", "scenario": "x"},
                {"title": "x", "scenario": "y", "id": "abc"}, {"title": "x", "scenario": "y", "steps": []}):
        with pytest.raises(ValidationError):
            AgentTask(**bad)
    with pytest.raises(ValidationError):
        AgentTasksIn(tasks=[])
    with pytest.raises(ValidationError):
        AgentTasksIn(tasks=[{"title": "x", "scenario": "y"}], protocol=["mine now"])
    assert AgentTasksIn(tasks=[{"title": "x", "scenario": "y"}]).research_questions is None


def test_an_agents_tasks_join_the_study_with_ids_of_their_own():
    content = {**rules.default_content("Acme Ltd"), "tasks": [TASK]}
    added = [AgentTask(title="Run it", scenario="Run the evaluation.").model_dump()] * 2
    merged = StudyContent.model_validate({**content, "tasks": content["tasks"] + added}).model_dump()
    ids = [t["id"] for t in merged["tasks"]]
    assert ids[0] == TASK["id"] and len(set(ids)) == 3
    assert merged["consent_text"] == content["consent_text"]      # the wording is untouched


def test_an_agents_correction_changes_only_what_it_sends():
    assert AgentTaskPatch(watch="Whether they find Import").model_fields_set == {"watch"}
    assert AgentTaskPatch(answer_prompt="").model_fields_set == {"answer_prompt"}
    with pytest.raises(ValidationError):
        AgentTaskPatch(title="  ")
    with pytest.raises(ValidationError):
        AgentTaskPatch(id="other")


def test_an_agents_study_takes_details_and_research_questions_only():
    made = AgentStudyCreate(name=" Pilot ", research_questions=["Can they find Import?", " "])
    assert made.name == "Pilot" and made.research_questions == ["Can they find Import?"]
    for bad in ({"name": "x", "content": {}}, {"name": "x", "app_url": "javascript:alert(1)"}, {"name": "x", "status": "closed"}):
        with pytest.raises(ValidationError):
            AgentStudyCreate(**bad)


def test_the_task_guide_names_every_field_an_agent_may_write():
    for field in AgentTask.model_fields:
        assert field in rules.TASK_GUIDE, field
