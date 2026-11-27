"""Usability observations shared across participants, and the free-text
answers on Study insights.

No database, like the other usability tests: a fake session hands back the
rows the code asks for.
"""
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.studio.usability import routes
from app.studio.usability.models import Observation, Participant, Study, TaskResult


class _Rows:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return self

    def all(self):
        return list(self._rows)

    def __iter__(self):
        return iter(self._rows)

    def scalar_one_or_none(self):
        return self._rows[0] if self._rows else None


class _Db:
    def __init__(self, rows):
        self.rows = rows
        self.flushed = 0

    async def execute(self, _query):
        return _Rows(self.rows)

    async def flush(self):
        self.flushed += 1


def _study() -> Study:
    return Study(
        id=uuid4(),
        account_id=uuid4(),
        name="Pilot",
        content={
            "tasks": [
                {"id": "t1", "title": "Sign up", "answer_prompt": "What did you expect?"},
                {"id": "t2", "title": "Find a report"},
            ]
        },
    )


async def test_ticking_an_observation_adds_the_participant_once_and_unticking_takes_them_off(monkeypatch):
    study = _study()
    p1, p2 = uuid4(), uuid4()

    async def found(_db, _study, participant_id):
        return Participant(id=participant_id, code="P?", token="t")

    monkeypatch.setattr(routes, "_participant", found)
    seen = Observation(id=uuid4(), study_id=study.id, task_id="t1", text="Missed the button", participant_ids=[str(p1)])
    db = _Db([seen])

    out = await routes._mark(db, study, seen.id, p2, True)
    assert out["participant_ids"] == sorted([str(p1), str(p2)]) and out["count"] == 2
    # ticking again changes nothing
    assert (await routes._mark(db, study, seen.id, p2, True))["count"] == 2
    out = await routes._mark(db, study, seen.id, p1, False)
    assert out["participant_ids"] == [str(p2)] and out["count"] == 1


async def test_ticking_an_observation_from_another_study_is_not_found(monkeypatch):
    async def found(_db, _study, participant_id):
        return Participant(id=participant_id, code="P1", token="t")

    monkeypatch.setattr(routes, "_participant", found)
    with pytest.raises(HTTPException) as caught:
        await routes._mark(_Db([]), _study(), uuid4(), uuid4(), True)
    assert caught.value.status_code == 404


def test_a_tick_locks_the_observation_so_two_moderators_ticking_at_once_both_count():
    import inspect

    assert ".with_for_update()" in inspect.getsource(routes._mark)


async def test_insights_say_who_saw_each_observation_and_gather_answers_task_by_task(monkeypatch):
    study = _study()
    p1 = Participant(id=uuid4(), code="P1", token="a", session_notes="Talked fast")
    p2 = Participant(id=uuid4(), code="P2", token="b")
    p3 = Participant(id=uuid4(), code="P3", token="c")
    people = [p1, p2, p3]

    async def participants(_db, _study):
        return people

    async def results(_db, _study, _ids):
        return {
            p1.id: {"t1": TaskResult(task_id="t1", answer="A dashboard")},
            p2.id: {"t1": TaskResult(task_id="t1", answer="   "), "t2": TaskResult(task_id="t2", answer="Under Reports")},
            p3.id: {},
        }

    monkeypatch.setattr(routes, "_participants", participants)
    monkeypatch.setattr(routes, "_results", results)
    gone = str(uuid4())  # a participant since removed
    observation = Observation(
        id=uuid4(), task_id="t1", text="Missed the button", participant_ids=[str(p1.id), str(p3.id), gone]
    )

    out = await routes._insights(_Db([observation]), study)

    assert out["observations"][0]["seen_by"] == ["P1", "P3"]
    assert out["participants"][0]["session_notes"] == "Talked fast"
    by_task = {a["task_id"]: a for a in out["answers"]}
    # a blank answer is left out; the question goes with its answers
    assert by_task["t1"]["prompt"] == "What did you expect?"
    assert [(a["code"], a["answer"]) for a in by_task["t1"]["answers"]] == [("P1", "A dashboard")]
    # a task with no question still shows answers someone gave
    assert [(a["code"], a["answer"]) for a in by_task["t2"]["answers"]] == [("P2", "Under Reports")]
