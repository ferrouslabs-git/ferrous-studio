"""Use case actors say what KIND of thing they are: a person, another system, or time.

Requested 2026-09-18. The tab was called "User types", which is narrower than
what a UML actor is: an actor is anything outside the system that interacts
with it, and two of the three common ones are not users at all -- another
system (a payment gateway, a scheduler's callback) and time itself (the
nightly run, the 30-day expiry). Calling them all "user types" meant either
drawing a stick figure for a cron job or leaving the trigger off the diagram.

``kind`` is a plain string rather than a native enum: adding a value to a
Postgres enum is a migration, and this is a vocabulary that may well grow.
The route validates it against the same three values the client offers.

NOT NULL with a server default of 'person', so every existing row keeps the
meaning it already had -- they were all user types by definition. The default
stays on the column: an INSERT that predates this feature is still valid.

Revision ID: c7a2e9d4b158
Revises: b5c9e2a7f314
Create Date: 2026-09-18
"""
from alembic import op
import sqlalchemy as sa

revision = "c7a2e9d4b158"
down_revision = "b5c9e2a7f314"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "use_case_actors",
        sa.Column("kind", sa.String(length=16), nullable=False, server_default="person"),
    )


def downgrade() -> None:
    op.drop_column("use_case_actors", "kind")
