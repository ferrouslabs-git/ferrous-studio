"""Epics and features can be assigned to a person, as requirements already are.

Requested 2026-09-18 ("assign requirements, features or epics to org users").
A requirement has carried ``assignee_id`` since the board was ported; the two
levels above it had no way to say who owns them, so "who is looking after this
epic?" had no answer on the board at all -- only "who is doing each of its
requirements", which is a different question and often nobody's yet.

Same shape as board_requirements.assignee_id: a nullable FK to users with
ON DELETE SET NULL, so removing a user from the platform empties the field
rather than blocking the delete or orphaning the row. NULL means unassigned,
which is what every existing row lands as.

Membership of the board's organisation is checked in the route
(_validate_assignee), not here: the constraint would have to span accounts
and memberships change independently of the assignment.

Additive and nullable, so it is safe against a live database. No RLS work --
both tables already run FORCE ROW LEVEL SECURITY with their account_id
policy, and adding a column does not change it.

Revision ID: b5c9e2a7f314
Revises: a1f6c3e8b472
Create Date: 2026-09-18
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "b5c9e2a7f314"
down_revision = "a1f6c3e8b472"
branch_labels = None
depends_on = None


TABLES = ("board_epics", "board_features")


def upgrade() -> None:
    for table in TABLES:
        op.add_column(table, sa.Column("assignee_id", postgresql.UUID(as_uuid=True), nullable=True))
        op.create_foreign_key(
            f"fk_{table}_assignee",
            table,
            "users",
            ["assignee_id"],
            ["id"],
            ondelete="SET NULL",
        )
        # "What is on my plate?" reads by assignee across the board.
        op.create_index(
            f"ix_{table}_assignee",
            table,
            ["assignee_id"],
            postgresql_where=sa.text("assignee_id IS NOT NULL"),
        )


def downgrade() -> None:
    for table in TABLES:
        op.drop_index(f"ix_{table}_assignee", table_name=table)
        op.drop_constraint(f"fk_{table}_assignee", table, type_="foreignkey")
        op.drop_column(table, "assignee_id")
