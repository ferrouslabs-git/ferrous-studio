"""Persistent named agents, sprint-scoped.

Ported from software-management (backend/store.py's agents table, added
incrementally through Sept 2026). Distinct from the existing agent_runs
table (one single attempt at a requirement) -- an Agent is started/stopped
repeatedly over its lifetime and works its assigned sprint's Todo
requirements in queue order.

Revision ID: b2e6f9c4a173
Revises: a3d8c1f5e692
Create Date: 2026-09-08

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'b2e6f9c4a173'
down_revision: Union[str, None] = 'a3d8c1f5e692'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'board_agents',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('board_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('account_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('sprint_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('desired_state', sa.String(length=10), nullable=False, server_default='stopped'),
        sa.Column('status', sa.String(length=10), nullable=False, server_default='stopped'),
        sa.Column('task_arn', sa.String(length=512), nullable=True),
        sa.Column('last_error', sa.Text(), nullable=True),
        sa.Column('current_requirement_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('board_token_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('board_token', sa.String(length=64), nullable=True),
        sa.Column('last_heartbeat', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['board_id'], ['boards.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['sprint_id'], ['board_sprints.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['current_requirement_id'], ['board_requirements.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['board_token_id'], ['board_tokens.id'], ondelete='SET NULL'),
        sa.CheckConstraint("desired_state IN ('running','stopped')", name='ck_board_agents_desired_state'),
        sa.CheckConstraint("status IN ('running','stopped','error')", name='ck_board_agents_status'),
    )
    op.create_index('ix_board_agents_sprint', 'board_agents', ['sprint_id'])
    op.execute("ALTER TABLE board_agents ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE board_agents FORCE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY board_agents_scope ON board_agents
            USING (
                current_setting('app.is_super_admin', true) = 'true'
                OR account_id::text = current_setting('app.current_scope_id', true)
            )
            WITH CHECK (
                account_id::text = current_setting('app.current_scope_id', true)
            )
    """)


def downgrade() -> None:
    op.drop_table('board_agents')
