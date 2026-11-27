"""Request and content schemas for usability studies.

``StudyContent`` is the shape of a study's ``content`` document. It is
validated on every write and on import, so nothing reaches the database (or a
participant) that the editor could not have produced.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Annotated
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

from .content import DEFAULT_EMAILS, SIGN_UP_TEXT, SUCCESS_VALUES, TOP_WORDS, WORDS, new_task_id

Line = Annotated[str, StringConstraints(strip_whitespace=True, max_length=4000)]
Short = Annotated[str, StringConstraints(strip_whitespace=True, max_length=255)]

_WEB_ADDRESS = re.compile(r"^https?://\S+$", re.IGNORECASE)


def _web_address(value: str) -> str:
    """The application address is shown to a participant as a link, so it may
    only be a web address: a ``javascript:`` one would run on their page."""
    if value and not _WEB_ADDRESS.match(value):
        raise ValueError("The application address must start with http:// or https://")
    return value


AppUrl = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500), AfterValidator(_web_address)]

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _contact_email(value: str) -> str:
    """Where the booking emails go. Blank clears it."""
    if value and not _EMAIL.match(value):
        raise ValueError("The contact email is not an email address")
    return value


ContactEmail = Annotated[str, StringConstraints(strip_whitespace=True, max_length=255), AfterValidator(_contact_email)]


def _time_zone(value: str) -> str:
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError(f"{value} is not a time zone (use a name like Europe/London)")
    return value


TimeZone = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64), AfterValidator(_time_zone)]


def _naive_utc(value: datetime) -> datetime:
    """Every DateTime here is naive UTC. A time without an offset is taken as UTC."""
    if value.tzinfo is not None:
        value = value.astimezone(timezone.utc).replace(tzinfo=None)
    return value.replace(second=0, microsecond=0)

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


class StudyEmail(Lines):
    subject: Short = ""
    body: list[Line] = []


def _default_email(kind: str) -> StudyEmail:
    default = DEFAULT_EMAILS[kind]
    return StudyEmail(subject=default["subject"], body=list(default["body"]))


class StudyEmails(BaseModel):
    """The invite (thank you, choose a time) and the confirmation (what to
    prepare). Studio adds the booking button, the session details and the
    rebooking link itself, so the copy cannot leave them out."""

    invite: StudyEmail = Field(default_factory=lambda: _default_email("invite"))
    confirmation: StudyEmail = Field(default_factory=lambda: _default_email("confirmation"))


class StudyContent(Lines):
    research_questions: list[Line] = []
    protocol: list[Line] = []
    consent_title: Short = "Consent and recording release"
    consent_text: list[Line] = []
    #: The testing includes signing up: a participant is given an address and
    #: an email to use (and ``sign_up_text``), not a test account to sign in with.
    sign_up: bool = False
    sign_up_text: list[Line] = Field(default_factory=lambda: list(SIGN_UP_TEXT))
    #: The words of the booking emails; set by a person in Studio, never an agent.
    emails: StudyEmails = Field(default_factory=lambda: StudyEmails())
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
    app_url: AppUrl | None = None
    content: StudyContent | None = None
    files: list[StudyFileIn] = []


class StudyUpdate(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)] | None = None
    status: str | None = Field(None, pattern="^(open|closed)$")
    persona: Short | None = None
    duration: Annotated[str, StringConstraints(strip_whitespace=True, max_length=64)] | None = None
    app_url: AppUrl | None = None
    account_email: Short | None = None
    account_password: Annotated[str, StringConstraints(max_length=255)] | None = None
    account_notes: str | None = None
    #: A Studio super admin; checked against their platform role by the route.
    moderator_user_id: UUID | None = None
    session_minutes: int | None = Field(None, ge=5, le=480)
    timezone: TimeZone | None = None
    content: StudyContent | None = None


class StudyClone(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)] | None = None


class AvailabilityIn(BaseModel):
    """A window participants may book in. Sent with an offset (ISO 8601);
    stored as naive UTC."""

    starts_at: datetime
    ends_at: datetime

    @model_validator(mode="after")
    def _a_window_runs_forwards(self) -> "AvailabilityIn":
        self.starts_at, self.ends_at = _naive_utc(self.starts_at), _naive_utc(self.ends_at)
        if self.ends_at <= self.starts_at:
            raise ValueError("A window must end after it starts")
        if self.ends_at - self.starts_at > timedelta(hours=24):
            raise ValueError("A window can be at most a day long")
        return self


class BookingIn(BaseModel):
    """The slot a participant picked: one of the starts the booking page offered."""

    start: datetime

    @field_validator("start", mode="after")
    @classmethod
    def _utc(cls, value: datetime) -> datetime:
        return _naive_utc(value)


class ParticipantWrite(BaseModel):
    name: Short | None = None
    contact_email: ContactEmail | None = None
    scheduled_at: Annotated[str, StringConstraints(strip_whitespace=True, max_length=40)] | None = None
    role: Short | None = None
    company: Short | None = None
    characteristics: str | None = None
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


# ── an agent's side (a board token, through the MCP server) ─────────────────
#
# The editor's reach less deletion, and less the two things a participant is
# sent to or signs: the application address and the consent wording
# (agent_routes.py says why). Tasks have no "replace all": they are appended,
# patched by id, or reordered. Unknown fields are refused rather than
# dropped, so a misnamed one comes back as an error the agent can fix.

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
MAX_AGENT_TASKS = 30


class AgentTask(Lines):
    """A task as an agent writes it: no id (the server gives it one), and a
    title and scenario are required."""

    model_config = ConfigDict(extra="forbid")

    title: Name
    scenario: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]
    notes: list[Line] = []
    files: list[Short] = []
    answer_prompt: Line | None = None
    success: Line = ""
    path: Line = ""
    watch: Line = ""
    probes: list[Line] = []


class AgentTaskPatch(Lines):
    """Only the fields sent are changed."""

    model_config = ConfigDict(extra="forbid")

    title: Name | None = None
    scenario: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)] | None = None
    notes: list[Line] | None = None
    files: list[Short] | None = None
    answer_prompt: Line | None = None
    success: Line | None = None
    path: Line | None = None
    watch: Line | None = None
    probes: list[Line] | None = None


class AgentStudyCreate(Lines):
    model_config = ConfigDict(extra="forbid")

    name: Name
    persona: Short | None = None
    duration: Annotated[str, StringConstraints(strip_whitespace=True, max_length=64)] | None = None
    research_questions: list[Line] = []


class AgentTasksIn(Lines):
    model_config = ConfigDict(extra="forbid")

    tasks: list[AgentTask] = Field(min_length=1, max_length=MAX_AGENT_TASKS)
    #: Replaces the study's research questions when given; left alone when not.
    research_questions: list[Line] | None = None


class AgentScriptPatch(Lines):
    """The moderator's script, section by section: a section sent replaces
    that section, one not sent is left as it is."""

    model_config = ConfigDict(extra="forbid")

    before: list[Line] | None = None
    welcome: list[Line] | None = None
    per_task: list[Line] | None = None
    wrap_up: list[Line] | None = None
    after: list[Line] | None = None


class AgentStudyPatch(Lines):
    """A study's details and content, field by field. Tasks are not here:
    they are added, corrected and reordered by their own routes, so results
    captured against one stay attached to it."""

    model_config = ConfigDict(extra="forbid")

    name: Name | None = None
    status: str | None = Field(None, pattern="^(open|closed)$")
    persona: Short | None = None
    duration: Annotated[str, StringConstraints(strip_whitespace=True, max_length=64)] | None = None
    research_questions: list[Line] | None = None
    protocol: list[Line] | None = None
    sign_up: bool | None = None
    sign_up_text: list[Line] | None = None
    account_email: Short | None = None
    account_password: Annotated[str, StringConstraints(max_length=255)] | None = None
    account_notes: str | None = None
    script: AgentScriptPatch | None = None
    words: list[Short] | None = None
    top_words: int | None = Field(None, ge=1, le=10)


class AgentTaskOrder(BaseModel):
    """Every task id of the study, once each, in the new order."""

    model_config = ConfigDict(extra="forbid")

    task_ids: list[str] = Field(min_length=1)


class AgentStudyImport(BaseModel):
    """A study made from an exported study document: content is required.
    No application address, and the consent wording in the document is
    replaced with the organisation's default (agent_routes.py)."""

    model_config = ConfigDict(extra="forbid")

    name: Name
    persona: Short | None = None
    duration: Annotated[str, StringConstraints(strip_whitespace=True, max_length=64)] | None = None
    content: StudyContent
    files: list[StudyFileIn] = []


class AgentParticipantWrite(BaseModel):
    """ParticipantWrite, refusing unknown fields. A participant has no
    address of their own: they open the study's, which a person sets. An
    agent may record a contact email, but only a person in Studio sends to it."""

    model_config = ConfigDict(extra="forbid")

    name: Short | None = None
    contact_email: ContactEmail | None = None
    scheduled_at: Annotated[str, StringConstraints(strip_whitespace=True, max_length=40)] | None = None
    role: Short | None = None
    company: Short | None = None
    characteristics: str | None = None
    account_email: Short | None = None
    account_password: Annotated[str, StringConstraints(max_length=255)] | None = None
    account_notes: str | None = None
    session_notes: str | None = None


class AgentCaptureWrite(CaptureWrite):
    model_config = ConfigDict(extra="forbid")


class AgentObservationWrite(ObservationWrite):
    model_config = ConfigDict(extra="forbid")
