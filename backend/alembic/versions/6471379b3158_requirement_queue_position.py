"""Requirement queue position: an agent's work order within a sprint.

Ported from software-management. ``queue_position`` says where a
requirement sits in its sprint's queue -- the order an agent assigned to
that sprint picks Todo work in, and the order the sprint board and release
page list it. NULL means "not ordered": the row sorts after every ordered
one (``ORDER BY queue_position NULLS LAST, seq``), which is the state every
existing row lands in.

Positions are scoped to a sprint, so the same number repeats across
sprints -- hence the partial index leads with ``sprint_id`` and only covers
rows that actually carry a position. A position is meaningless once the
requirement leaves its sprint, so it is cleared whenever ``sprint_id``
changes without the client also setting a new one, when a sprint is
completed (its unfinished work returns to the backlog) and when a sprint
is deleted. That rule lives in routes.py/service.py, not the database.

Additive and nullable, so it is safe against a live database. No RLS work
here -- board_requirements already runs FORCE ROW LEVEL SECURITY with its
account_id policy, and adding a column does not change it.

Revision ID: 6471379b3158
Revises: 3681179735fd
Create Date: 2026-09-11
"""
from alembic import op
import sqlalchemy as sa

revision = "6471379b3158"
down_revision = "3681179735fd"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "board_requirements",
        sa.Column("queue_position", sa.Integer(), nullable=True),
    )
    op.create_index(
        "ix_board_requirements_queue",
        "board_requirements",
        ["sprint_id", "queue_position"],
        postgresql_where=sa.text("queue_position IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_board_requirements_queue", table_name="board_requirements")
    op.drop_column("board_requirements", "queue_position")
