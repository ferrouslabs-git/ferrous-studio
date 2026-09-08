"""Agent runner scaffolding (phase 5): board tokens + agent runs

Deliberately not a working feature yet -- see docs/go-live-and-merge-boards.md
phase 5 and app/config.py's agent_ecs_cluster/agent_task_definition. What
this migration adds:

- ``board_tokens``: the credential an agent (or any non-browser client) holds.
  Ported from SMA's ``agents.board_token`` idea (Fnai-sma/software-management-
  app, store.py:1139-1166) but generalised into its own table and made real:
  a secrets.token_urlsafe(32) value, stored only as a sha256 hash (shown once
  at creation, like SMA's own AGENT_SELECT deliberately excludes the raw
  value from every read). Unlike SMA's flat single-board token namespace,
  this is scoped to one board via board_id/account_id, and unlike the
  platform-admin bypass (dependencies.py's is_super_admin), a resolved token
  grants board:read/board:write ONLY -- never the full-permission shortcut.
- ``agent_runs``: one row per queued/running/finished agent attempt at a
  requirement, replacing SMA's agents table's identity-tracking role. No
  ``board_token`` column here -- an agent run is what a token *does*, not
  where the token lives; a token can back multiple runs over its lifetime.

Revision ID: b8e2c5f174ad
Revises: d4f7b2a9c631
Create Date: 2026-09-08
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'b8e2c5f174ad'
down_revision: Union[str, None] = 'd4f7b2a9c631'
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
        'board_tokens',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('board_id', sa.UUID(), nullable=False),
        sa.Column('account_id', sa.UUID(), nullable=False),
        sa.Column('label', sa.String(length=255), nullable=False),
        sa.Column('token_hash', sa.String(length=64), nullable=False),
        sa.Column('created_by', sa.UUID(), nullable=True),
        sa.Column('last_used_at', sa.DateTime(), nullable=True),
        sa.Column('revoked_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['board_id'], ['boards.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('token_hash', name='uq_board_tokens_hash'),
    )
    _apply_rls('board_tokens')

    op.create_table(
        'agent_runs',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('board_id', sa.UUID(), nullable=False),
        sa.Column('account_id', sa.UUID(), nullable=False),
        sa.Column('requirement_id', sa.UUID(), nullable=False),
        sa.Column('status', sa.String(length=12), nullable=False, server_default='queued'),
        sa.Column('ecs_task_arn', sa.String(length=512), nullable=True),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('created_by', sa.UUID(), nullable=True),
        sa.Column('started_at', sa.DateTime(), nullable=True),
        sa.Column('heartbeat_at', sa.DateTime(), nullable=True),
        sa.Column('finished_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.CheckConstraint("status IN ('queued','running','done','failed','cancelled')", name='ck_agent_runs_status'),
        sa.ForeignKeyConstraint(['board_id'], ['boards.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['requirement_id'], ['board_requirements.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_agent_runs_requirement', 'agent_runs', ['requirement_id'])
    op.create_index('ix_agent_runs_board_status', 'agent_runs', ['board_id', 'status'])
    _apply_rls('agent_runs')


def downgrade() -> None:
    op.drop_table('agent_runs')
    op.drop_table('board_tokens')
