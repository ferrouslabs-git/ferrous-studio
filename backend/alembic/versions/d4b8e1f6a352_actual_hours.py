"""Actual hours on feedback reports and requirements.

How long a fix really took, beside the estimate it was agreed at. Additive
and nullable, so safe against a live database: existing rows read as NULL,
"not recorded", which is distinct from zero. The maintenance log charges a
resolved report its actual hours when recorded and its estimate otherwise.

``double precision`` for the same reason as estimate_hours (e2b7d4f9a316):
psycopg maps numeric to Decimal, which would break JSON responses. Both
tables already run FORCE ROW LEVEL SECURITY; a new column changes nothing.

Revision ID: d4b8e1f6a352
Revises: c8f1e5a3d927
Create Date: 2026-11-04
"""
from alembic import op
import sqlalchemy as sa

revision = "d4b8e1f6a352"
down_revision = "c8f1e5a3d927"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("board_requirements", sa.Column("actual_hours", sa.Float(), nullable=True))
    op.add_column("board_feedback", sa.Column("actual_hours", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("board_feedback", "actual_hours")
    op.drop_column("board_requirements", "actual_hours")
