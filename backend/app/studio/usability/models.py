"""Usability study ORM models.

Every table carries ``account_id`` and a row-level-security policy keyed on
it, like the rest of the studio tables. A study hangs off ``lineage_id``
rather than a ``projects`` row for the same reason the board does: a project
row is one frozen design version, and a round of testing is live state that
must outlast it. None of these tables has a ``project_id``, so versioning
neither copies nor skips them.
"""
from uuid import uuid4

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, LargeBinary, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB, UUID

from ..models import Base, utc_now

__all__ = ["Study", "StudyFile", "Participant", "TaskResult", "Observation", "Availability"]


class Study(Base):
    """One round of usability testing and everything it tests with."""

    __tablename__ = "usability_studies"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    account_id = Column(UUID(as_uuid=True), nullable=False)
    lineage_id = Column(UUID(as_uuid=True), nullable=False)
    name = Column(String(255), nullable=False)
    status = Column(String(16), nullable=False, default="open")  # open | closed
    persona = Column(String(255), nullable=True)   # who the study is for, by name
    duration = Column(String(64), nullable=True)   # as shown to a participant: "about 60 minutes"
    app_url = Column(String(500), nullable=True)   # the address every participant opens
    #: The test account a participant is given unless their own row says
    #: otherwise (``account_for``): their value when set, else this one.
    account_email = Column(String(255), nullable=True)
    account_password = Column(String(255), nullable=True)
    account_notes = Column(Text, nullable=True)
    #: The Studio super admin who runs the sessions. Booked sessions, and holds
    #: on the times offered, go on their Google calendar.
    moderator_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    #: How long a bookable slot is: availability windows are cut into slots this long.
    session_minutes = Column(Integer, nullable=True)
    #: The break between one slot and the next (0 = back to back).
    slot_gap_minutes = Column(Integer, nullable=False, default=0, server_default="0")
    #: What emails and Studio show times in (an IANA name, e.g. Europe/London).
    timezone = Column(String(64), nullable=False, default="Europe/London")
    #: Research questions, protocol, consent form, tasks, script and word list.
    content = Column(JSONB, nullable=False, default=dict)
    #: Raised whenever the consent wording changes; each participant keeps the
    #: version they agreed to.
    consent_version = Column(Integer, nullable=False, default=1)
    #: How many participants have ever been added. The next is P<n+1>, so a
    #: removed participant's code is never handed to someone else.
    participant_seq = Column(Integer, nullable=False, default=0)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=utc_now, nullable=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)

    __table_args__ = (Index("ix_usability_studies_account_lineage", "account_id", "lineage_id"),)


class StudyFile(Base):
    """A file a task hands to the participant (a dataset, a definition).

    Held in the database rather than in the documents bucket: these are small
    text files, a study must clone and export whole, and a participant has no
    session to presign a download for."""

    __tablename__ = "usability_study_files"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    account_id = Column(UUID(as_uuid=True), nullable=False)
    study_id = Column(UUID(as_uuid=True), ForeignKey("usability_studies.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    content_type = Column(String(120), nullable=False, default="application/octet-stream")
    size = Column(Integer, nullable=False)
    data = Column(LargeBinary, nullable=False)
    created_at = Column(DateTime, default=utc_now, nullable=False)

    __table_args__ = (
        UniqueConstraint("study_id", "name", name="uq_usability_study_files_name"),
        Index("ix_usability_study_files_account_study", "account_id", "study_id"),
    )


class Participant(Base):
    """A participant in a study and their session: who they are, the test
    account they use, their consent and their word choices.

    ``token`` is kept readable because an admin copies the session link from
    Studio and sends it at the start of the call; it is never emailed. The
    booking email carries ``booking_token`` instead, a separate link that only
    books a time. ``account_password`` is a test account's password, shown to
    the participant after consent -- never a real person's.

    Times are naive UTC, like every other DateTime here."""

    __tablename__ = "usability_participants"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    account_id = Column(UUID(as_uuid=True), nullable=False)
    study_id = Column(UUID(as_uuid=True), ForeignKey("usability_studies.id", ondelete="CASCADE"), nullable=False)
    code = Column(String(8), nullable=False)  # P1, P2, ...
    token = Column(String(64), nullable=False, unique=True)
    scheduled_at = Column(String(40), nullable=True)  # as entered: "2026-12-01T14:00"
    role = Column(String(255), nullable=True)
    company = Column(String(255), nullable=True)
    characteristics = Column(Text, nullable=True)
    # No longer read or written: a participant opens the study's app_url. Kept
    # so old rows and running instances are untouched; safe to drop later.
    app_url = Column(String(500), nullable=True)
    account_email = Column(String(255), nullable=True)
    account_password = Column(String(255), nullable=True)
    account_notes = Column(Text, nullable=True)  # anything else they need to get going
    consent_name = Column(String(255), nullable=True)
    consent_at = Column(DateTime, nullable=True)
    consent_version = Column(Integer, nullable=True)
    words = Column(JSONB, nullable=False, default=list)
    top_words = Column(JSONB, nullable=False, default=list)
    completed_at = Column(DateTime, nullable=True)
    session_notes = Column(Text, nullable=True)
    # Booking: who to write to, their booking link, the slot they chose, its
    # calendar event, and when each email went out (or why it did not).
    name = Column(String(255), nullable=True)
    contact_email = Column(String(255), nullable=True)
    booking_token = Column(String(64), nullable=True, unique=True)
    booked_start = Column(DateTime, nullable=True)
    google_event_id = Column(String(255), nullable=True)
    meet_url = Column(String(500), nullable=True)
    calendar_error = Column(Text, nullable=True)
    invite_sent_at = Column(DateTime, nullable=True)
    invite_error = Column(Text, nullable=True)
    confirmation_sent_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utc_now, nullable=False)

    __table_args__ = (
        UniqueConstraint("study_id", "code", name="uq_usability_participants_code"),
        Index("ix_usability_participants_account_study", "account_id", "study_id"),
        # Two participants can never hold the same slot, even booking at once.
        Index(
            "uq_usability_participants_booked_slot", "study_id", "booked_start",
            unique=True, postgresql_where=text("booked_start IS NOT NULL"),
        ),
    )


class Availability(Base):
    """A window of time participants may book in, cut into the study's
    ``session_minutes`` slots. ``google_hold_id`` is the busy event that holds
    the window on the moderator's calendar so nothing else is booked over it."""

    __tablename__ = "usability_availability"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    account_id = Column(UUID(as_uuid=True), nullable=False)
    study_id = Column(UUID(as_uuid=True), ForeignKey("usability_studies.id", ondelete="CASCADE"), nullable=False)
    starts_at = Column(DateTime, nullable=False)
    ends_at = Column(DateTime, nullable=False)
    google_hold_id = Column(String(255), nullable=True)
    hold_error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utc_now, nullable=False)

    __table_args__ = (Index("ix_usability_availability_account_study", "account_id", "study_id"),)


class TaskResult(Base):
    """One task for one participant: what the participant gave (rating,
    answer) and what the moderator captured (time, errors, success, notes)."""

    __tablename__ = "usability_task_results"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    account_id = Column(UUID(as_uuid=True), nullable=False)
    participant_id = Column(
        UUID(as_uuid=True), ForeignKey("usability_participants.id", ondelete="CASCADE"), nullable=False
    )
    task_id = Column(String(16), nullable=False)
    rating = Column(Integer, nullable=True)        # participant: 1 to 10
    answer = Column(Text, nullable=True)           # participant
    time_seconds = Column(Integer, nullable=True)  # moderator
    errors = Column(Integer, nullable=True)        # moderator
    success = Column(String(16), nullable=True)    # moderator: complete | help | fail
    observations = Column(Text, nullable=True)     # moderator
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)

    __table_args__ = (
        UniqueConstraint("participant_id", "task_id", name="uq_usability_task_results_task"),
        Index("ix_usability_task_results_account_participant", "account_id", "participant_id"),
    )


class Observation(Base):
    """One row of the study's observations sheet: something seen, which
    participants it applied to, and what might fix it. ``task_id`` is null for
    a general observation."""

    __tablename__ = "usability_observations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    account_id = Column(UUID(as_uuid=True), nullable=False)
    study_id = Column(UUID(as_uuid=True), ForeignKey("usability_studies.id", ondelete="CASCADE"), nullable=False)
    task_id = Column(String(16), nullable=True)
    text = Column(Text, nullable=False)
    solution = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    participant_ids = Column(JSONB, nullable=False, default=list)  # participant ids, as strings
    created_at = Column(DateTime, default=utc_now, nullable=False)

    __table_args__ = (Index("ix_usability_observations_account_study", "account_id", "study_id"),)
