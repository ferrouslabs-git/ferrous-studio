"""Request and content schemas for usability studies.

``StudyContent`` is the shape of a study's ``content`` document. It is
validated on every write and on import, so nothing reaches the database (or a
participant) that the editor could not have produced.
"""
from __future__ import annotations

from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints, field_validator, model_validator

from .content import SUCCESS_VALUES, TOP_WORDS, WORDS, new_task_id

Line = Annotated[str, StringConstraints(strip_whitespace=True, max_length=4000)]
Short = Annotated[str, StringConstraints(strip_whitespace=True, max_length=255)]

#: A study file is a dataset or a definition a participant downloads, not media.
MAX_FILE_BYTES = 2 * 1024 * 1024


def _no_blanks(items: list[str]) -> list[str]:
    return [item for item in items if item]


class Lines(BaseModel):
    """Mixin: every list of text lines drops its blank entries."""

    @field_validator("*", mode="after")
    @classmethod
    def _drop_blank_lines(cls, value):
        if isinstance(value, list) and all(isinstance(item, str) for item in value):
            return _no_blanks(value)
        return value


class StudyTask(Lines):
    id: Annotated[str, StringConstraints(pattern=r"^[a-z0-9]{1,16}$")] = Field(default_factory=new_task_id)
    title: Short = ""
    scenario: Line = ""
    notes: list[Line] = []
    files: list[Short] = []
    answer_prompt: Line | None = None
    # The moderator's half. None of these ever reaches a participant.
    success: Line = ""
    path: Line = ""
    watch: Line = ""
    probes: list[Line] = []

    @field_validator("answer_prompt", mode="after")
    @classmethod
    def _blank_prompt_is_none(cls, value: str | None) -> str | None:
        return value or None


class StudyScript(Lines):
    before: list[Line] = []
    welcome: list[Line] = []
    per_task: list[Line] = []
    wrap_up: list[Line] = []
    after: list[Line] = []


class StudyContent(Lines):
    research_questions: list[Line] = []
    protocol: list[Line] = []
    consent_title: Short = "Consent and recording release"
    consent_text: list[Line] = []
    tasks: list[StudyTask] = []
    script: StudyScript = StudyScript()
    words: list[Short] = Field(default_factory=lambda: list(WORDS))
    top_words: int = Field(TOP_WORDS, ge=1, le=10)

    @model_validator(mode="after")
    def _task_ids_are_unique(self) -> "StudyContent":
        ids = [task.id for task in self.tasks]
        if len(ids) != len(set(ids)):
            raise ValueError("Two tasks share an id")
        return self


class StudyFileIn(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
    content_type: Short = "application/octet-stream"
    data_base64: str

    @field_validator("name", mode="after")
    @classmethod
    def _a_file_name_not_a_path(cls, value: str) -> str:
        if "/" in value or "\\" in value or value in (".", ".."):
            raise ValueError("A file name cannot contain a path")
        return value


class StudyCreate(BaseModel):
    """A blank study, or one made from an exported file (``content`` and
    ``files`` given)."""

    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
    persona: Short | None = None
    duration: Annotated[str, StringConstraints(strip_whitespace=True, max_length=64)] | None = None
    app_url: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] | None = None
    content: StudyContent | None = None
    files: list[StudyFileIn] = []


class StudyUpdate(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)] | None = None
    status: str | None = Field(None, pattern="^(open|closed)$")
    persona: Short | None = None
    duration: Annotated[str, StringConstraints(strip_whitespace=True, max_length=64)] | None = None
    app_url: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] | None = None
    content: StudyContent | None = None


class StudyClone(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)] | None = None


class ParticipantWrite(BaseModel):
    scheduled_at: Annotated[str, StringConstraints(strip_whitespace=True, max_length=40)] | None = None
    role: Short | None = None
    company: Short | None = None
    characteristics: str | None = None
    app_url: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] | None = None
    account_email: Short | None = None
    account_password: Annotated[str, StringConstraints(max_length=255)] | None = None
    account_notes: str | None = None
    session_notes: str | None = None


class CaptureWrite(BaseModel):
    """The moderator's half of a task. Only the fields sent are changed, so a
    stopwatch stopping and a note being typed never overwrite each other."""

    time_seconds: int | None = Field(None, ge=0)
    errors: int | None = Field(None, ge=0)
    success: str | None = None
    observations: str | None = None

    @field_validator("success", mode="after")
    @classmethod
    def _a_known_outcome(cls, value: str | None) -> str | None:
        if value in (None, ""):
            return None
        if value not in SUCCESS_VALUES:
            raise ValueError(f"success must be one of {', '.join(SUCCESS_VALUES)}")
        return value


class ObservationWrite(BaseModel):
    task_id: str | None = None
    text: Line | None = None
    solution: str | None = None
    notes: str | None = None
    participant_ids: list[UUID] | None = None


# ── the participant page ────────────────────────────────────────────────────


class ConsentIn(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=255)]
    agree: bool

    @field_validator("agree", mode="after")
    @classmethod
    def _must_agree(cls, value: bool) -> bool:
        if not value:
            raise ValueError("Tick the box to agree")
        return value


class TaskAnswerIn(BaseModel):
    rating: int | None = Field(None, ge=1, le=10)
    answer: Annotated[str, StringConstraints(max_length=4000)] | None = None


class WordsIn(BaseModel):
    words: list[str]
    top_words: list[str] = []
