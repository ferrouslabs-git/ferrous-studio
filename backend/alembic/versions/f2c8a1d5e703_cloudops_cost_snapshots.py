"""CloudOps cost report snapshots (INT-REQ-14, phase 1).

Each refresh of the platform-admin Costs page stores the finished report here, so reopening the page
costs nothing. Platform-wide (no account_id), like platform_datasets, so no row level security.
Additive and new: nothing existing changes.

Revision ID: f2c8a1d5e703
Revises: f1b6d8a2c597
Create Date: 2026-11-16
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "f2c8a1d5e703"
down_revision = "f1b6d8a2c597"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "cloudops_cost_snapshots",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("report", postgresql.JSONB(), nullable=False),
        sa.Column("created_by", sa.UUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_cloudops_cost_snapshots_created_at", "cloudops_cost_snapshots", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_cloudops_cost_snapshots_created_at", table_name="cloudops_cost_snapshots")
    op.drop_table("cloudops_cost_snapshots")
