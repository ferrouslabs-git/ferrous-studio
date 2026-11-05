"""Archived requirements (FS-REQ-79).

A requirement can be set aside without being lost: ``archived_at`` takes it
out of every sprint board, roll-up, burndown and default list, and clearing
it restores the requirement exactly as it was. Only an archived requirement
may then be deleted.

Additive and nullable, so safe against a live database: every existing row
reads as live. board_requirements already runs FORCE ROW LEVEL SECURITY; a
new column changes nothing about its policies.

Revision ID: e3a7c1f9b482
Revises: d4b8e1f6a352
Create Date: 2026-11-05
"""
from alembic import op
import sqlalchemy as sa

revision = "e3a7c1f9b482"
down_revision = "d4b8e1f6a352"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("board_requirements", sa.Column("archived_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("board_requirements", "archived_at")
