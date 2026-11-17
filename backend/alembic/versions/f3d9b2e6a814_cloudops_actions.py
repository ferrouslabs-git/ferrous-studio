"""CloudOps action audit log (INT-REQ-14, phase 3).

Every attempt to start, stop or re-tag a service from the CloudOps panel is recorded here, including the
refused ones. Platform-wide (no account_id), like cloudops_cost_snapshots, so no row level security.
Additive and new: nothing existing changes.

Revision ID: f3d9b2e6a814
Revises: f2c8a1d5e703
Create Date: 2026-11-16
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "f3d9b2e6a814"
down_revision = "f2c8a1d5e703"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "cloudops_actions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=True),
        sa.Column("user_email", sa.String(length=255), nullable=False),
        sa.Column("action", sa.String(length=32), nullable=False),
        sa.Column("service", sa.String(length=255), nullable=False),
        sa.Column("params", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("before", postgresql.JSONB(), nullable=True),
        sa.Column("after", postgresql.JSONB(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("message", sa.String(length=500), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_cloudops_actions_created_at", "cloudops_actions", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_cloudops_actions_created_at", table_name="cloudops_actions")
    op.drop_table("cloudops_actions")
