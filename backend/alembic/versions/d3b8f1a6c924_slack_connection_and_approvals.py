"""Slack: an organisation's connection, and agent approval requests

``slack_connections`` -- one row per organisation: the workspace it installed
the Ferrous Studio Slack app into, the (encrypted) bot token Slack returned,
and the channel board events are posted to. The token is the one secret in the
studio schema, which is why it is a Fernet ciphertext and not a plain column.

``board_approvals`` -- a question an agent put to a human. It is posted to the
channel with Approve / Reject buttons; the agent polls until the status leaves
``pending``.

Both take the standard studio RLS policy keyed on ``account_id``: reading is
open to the platform-admin bypass, writing never is (see ``f7a3d8e1c265``).

Revision ID: d3b8f1a6c924
Revises: c9f2a6d4e173
Create Date: 2026-10-02
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'd3b8f1a6c924'
down_revision: Union[str, None] = 'c9f2a6d4e173'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

RLS_POLICY = """
CREATE POLICY {table}_scope ON {table}
    USING (
        current_setting('app.is_super_admin', true) = 'true'
        OR account_id::text = current_setting('app.current_scope_id', true)
    )
    WITH CHECK (
        account_id::text = current_setting('app.current_scope_id', true)
    )
"""


def _apply_rls(table: str) -> None:
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(RLS_POLICY.format(table=table))


def upgrade() -> None:
    op.create_table(
        'slack_connections',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('account_id', sa.UUID(), nullable=False),
        sa.Column('team_id', sa.String(length=32), nullable=False),
        sa.Column('team_name', sa.String(length=255), nullable=True),
        sa.Column('bot_token', sa.Text(), nullable=False),
        sa.Column('channel_id', sa.String(length=32), nullable=True),
        sa.Column('channel_name', sa.String(length=255), nullable=True),
        sa.Column('connected_by', sa.UUID(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['account_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['connected_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('account_id', name='uq_slack_connections_account'),
    )
    _apply_rls('slack_connections')

    op.create_table(
        'board_approvals',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('board_id', sa.UUID(), nullable=False),
        sa.Column('account_id', sa.UUID(), nullable=False),
        sa.Column('requested_by', sa.UUID(), nullable=True),
        sa.Column('summary', sa.String(length=300), nullable=False),
        sa.Column('detail', sa.Text(), nullable=False, server_default=''),
        sa.Column('status', sa.String(length=16), nullable=False, server_default='pending'),
        sa.Column('decided_by', sa.String(length=255), nullable=True),
        sa.Column('decided_at', sa.DateTime(), nullable=True),
        sa.Column('channel_id', sa.String(length=32), nullable=True),
        sa.Column('message_ts', sa.String(length=32), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['board_id'], ['boards.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['requested_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.CheckConstraint("status IN ('pending','approved','rejected')", name='ck_board_approvals_status'),
    )
    op.create_index('ix_board_approvals_board_created', 'board_approvals', ['board_id', 'created_at'])
    _apply_rls('board_approvals')


def downgrade() -> None:
    op.drop_table('board_approvals')
    op.drop_table('slack_connections')
