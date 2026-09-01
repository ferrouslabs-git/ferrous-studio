"""use case model: actors (user types) and the use cases they can perform

Two project-scoped tables. ``use_cases.actor_ids`` is a JSONB array of actor
ids rather than a join table; the delete-actor route keeps it consistent.
Both tables carry ``account_id`` and the same row-level-security policy as
the other studio tables (see ``b7e2c4d9a1f3``).

Revision ID: e5a1c7b3d902
Revises: d8e4f6a2b901
Create Date: 2026-08-27
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'e5a1c7b3d902'
down_revision: Union[str, None] = 'd8e4f6a2b901'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLES = ("use_case_actors", "use_cases")

RLS_POLICY = """
CREATE POLICY {table}_scope ON {table}
    USING (
        current_setting('app.is_super_admin', true) = 'true'
        OR account_id::text = current_setting('app.current_scope_id', true)
    )
    WITH CHECK (
        current_setting('app.is_super_admin', true) = 'true'
        OR account_id::text = current_setting('app.current_scope_id', true)
    )
"""

JSONB = postgresql.JSONB(astext_type=sa.Text())


def _leading_columns() -> list:
    return [
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('project_id', sa.UUID(), nullable=False),
        sa.Column('account_id', sa.UUID(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
    ]


def _trailing_columns() -> list:
    return [
        sa.Column('pos', sa.String(length=64), nullable=False),
        sa.Column('created_by', sa.UUID(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    ]


def upgrade() -> None:
    op.create_table('use_case_actors', *_leading_columns(), *_trailing_columns())
    op.create_index('ix_use_case_actors_account_project', 'use_case_actors', ['account_id', 'project_id'], unique=False)

    op.create_table(
        'use_cases',
        *_leading_columns(),
        sa.Column('actor_ids', JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        *_trailing_columns(),
    )
    op.create_index('ix_use_cases_account_project', 'use_cases', ['account_id', 'project_id'], unique=False)

    for table in TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(RLS_POLICY.format(table=table))


def downgrade() -> None:
    op.drop_index('ix_use_cases_account_project', table_name='use_cases')
    op.drop_table('use_cases')
    op.drop_index('ix_use_case_actors_account_project', table_name='use_case_actors')
    op.drop_table('use_case_actors')
