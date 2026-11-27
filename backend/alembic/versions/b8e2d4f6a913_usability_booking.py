"""Usability studies: participants book their own session

* ``usability_studies``: ``moderator_user_id`` (a Studio super admin who runs
  the sessions; the calendar events go on their Google calendar),
  ``session_minutes`` (how long a bookable slot is) and ``timezone`` (what
  the emails and Studio show times in).
* ``usability_availability`` (new): windows of time participants may book
  in, cut into ``session_minutes`` slots. Each window holds its time on the
  moderator's calendar (``google_hold_id``). Organisation-scoped with the
  usual forced row-level-security policy.
* ``usability_participants``: a name and a contact email to write to, a
  separate ``booking_token`` (the session link is sent at the start of the
  call, so the booking link must not be it), the booked slot, its calendar
  event and Meet link, and when the emails went out. A partial unique index
  on (study_id, booked_start) refuses two bookings of one slot.

Additive: nothing existing changes.

Revision ID: b8e2d4f6a913
Revises: a6d3f9c2e481
Create Date: 2026-11-27
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'b8e2d4f6a913'
down_revision: Union[str, None] = 'a6d3f9c2e481'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

RLS_POLICY = """
CREATE POLICY usability_availability_scope ON usability_availability
    USING (
        current_setting('app.is_super_admin', true) = 'true'
        OR account_id::text = current_setting('app.current_scope_id', true)
    )
    WITH CHECK (
        account_id::text = current_setting('app.current_scope_id', true)
    )
"""


def upgrade() -> None:
    op.add_column(
        "usability_studies",
        sa.Column("moderator_user_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
    )
    op.add_column("usability_studies", sa.Column("session_minutes", sa.Integer(), nullable=True))
    op.add_column(
        "usability_studies",
        sa.Column("timezone", sa.String(length=64), nullable=False, server_default="Europe/London"),
    )

    op.create_table(
        "usability_availability",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("account_id", sa.UUID(), nullable=False),
        sa.Column("study_id", sa.UUID(), sa.ForeignKey("usability_studies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("starts_at", sa.DateTime(), nullable=False),
        sa.Column("ends_at", sa.DateTime(), nullable=False),
        sa.Column("google_hold_id", sa.String(length=255), nullable=True),
        sa.Column("hold_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_usability_availability_account_study", "usability_availability", ["account_id", "study_id"]
    )
    op.execute("ALTER TABLE usability_availability ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE usability_availability FORCE ROW LEVEL SECURITY")
    op.execute(RLS_POLICY)

    for column in (
        sa.Column("name", sa.String(length=255), nullable=True),
        sa.Column("contact_email", sa.String(length=255), nullable=True),
        sa.Column("booking_token", sa.String(length=64), nullable=True),
        sa.Column("booked_start", sa.DateTime(), nullable=True),
        sa.Column("google_event_id", sa.String(length=255), nullable=True),
        sa.Column("meet_url", sa.String(length=500), nullable=True),
        sa.Column("calendar_error", sa.Text(), nullable=True),
        sa.Column("invite_sent_at", sa.DateTime(), nullable=True),
        sa.Column("invite_error", sa.Text(), nullable=True),
        sa.Column("confirmation_sent_at", sa.DateTime(), nullable=True),
    ):
        op.add_column("usability_participants", column)
    # No backfill: the table forces row-level security, so an UPDATE here would
    # see no rows. A participant without a booking token is given one the first
    # time a booking email is sent to them (routes._booking_token).
    op.create_index("uq_usability_participants_booking_token", "usability_participants", ["booking_token"], unique=True)
    op.create_index(
        "uq_usability_participants_booked_slot",
        "usability_participants",
        ["study_id", "booked_start"],
        unique=True,
        postgresql_where=sa.text("booked_start IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_usability_participants_booked_slot", table_name="usability_participants")
    op.drop_index("uq_usability_participants_booking_token", table_name="usability_participants")
    for name in (
        "confirmation_sent_at", "invite_error", "invite_sent_at", "calendar_error", "meet_url",
        "google_event_id", "booked_start", "booking_token", "contact_email", "name",
    ):
        op.drop_column("usability_participants", name)
    op.drop_table("usability_availability")
    op.drop_column("usability_studies", "timezone")
    op.drop_column("usability_studies", "session_minutes")
    op.drop_column("usability_studies", "moderator_user_id")
