"""Project Agent chatbot: one messages table, one thread per project.

Phase 1 of docs/project-agent-implementation-plan.md -- the isolated
per-project conversation history. No session table: nothing so far calls
for more than one thread per project, so project_id is the whole scope.

Revision ID: 3681179735fd
Revises: e2b7d4f9a316
Create Date: 2026-09-11

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '3681179735fd'
down_revision: Union[str, None] = 'e2b7d4f9a316'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'project_agent_messages',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('account_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('role', sa.String(length=16), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('created_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
        sa.CheckConstraint("role IN ('user','assistant')", name='ck_project_agent_messages_role'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_project_agent_messages_account_project',
        'project_agent_messages',
        ['account_id', 'project_id', 'created_at'],
    )
    op.execute("ALTER TABLE project_agent_messages ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE project_agent_messages FORCE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY project_agent_messages_scope ON project_agent_messages
            USING (
                current_setting('app.is_super_admin', true) = 'true'
                OR account_id::text = current_setting('app.current_scope_id', true)
            )
            WITH CHECK (
                account_id::text = current_setting('app.current_scope_id', true)
            )
    """)


def downgrade() -> None:
    op.drop_table('project_agent_messages')
