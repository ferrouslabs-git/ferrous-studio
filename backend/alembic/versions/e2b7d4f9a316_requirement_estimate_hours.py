"""Requirement effort estimate, in hours.

Additive and nullable, so it is safe against a live database: existing rows
read as NULL, which is the correct "not estimated yet" state rather than a
stand-in for zero.

Carried over from software-management, whose effort rollups and
capacity-vs-committed sprint lane are built on this column. Nothing in this
app surfaces it yet -- it exists so the estimates on the software-management
board survive the import instead of being silently dropped, and so a
future effort-based burndown has the input it needs (today's burndown counts
requirements, not hours).

``double precision``, deliberately not ``numeric``: psycopg maps numeric to
decimal.Decimal, which is not JSON-serialisable and would break every
response carrying a requirement.

No RLS work here -- board_requirements already runs FORCE ROW LEVEL SECURITY
with its account_id policy, and adding a column does not change it.

Revision ID: e2b7d4f9a316
Revises: 9f8aabc36c5d
Create Date: 2026-09-09
"""
from alembic import op
import sqlalchemy as sa

revision = "e2b7d4f9a316"
down_revision = "9f8aabc36c5d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "board_requirements",
        sa.Column("estimate_hours", sa.Float(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("board_requirements", "estimate_hours")
