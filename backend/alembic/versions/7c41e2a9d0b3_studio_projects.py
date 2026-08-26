"""studio: projects, pages, versions, op batches; drop example items

Row-level security is enabled AND forced on every studio table: the app's
database role owns the tables (create-rds-roles.sh makes it the database
owner and migrations run as it), and owners bypass RLS unless FORCE is set.
Policies key on the same session variables app/auth sets per request via
set_config(); an unset variable yields NULL (missing_ok) and matches nothing.

Any future *data* migration touching these tables must first run
    SELECT set_config('app.is_super_admin', 'true', true)
or it will see zero rows.

Revision ID: 7c41e2a9d0b3
Revises: 3f2a9c1d7b44
Create Date: 2026-08-26
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '7c41e2a9d0b3'
down_revision: Union[str, None] = '3f2a9c1d7b44'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

STUDIO_TABLES = ("projects", "project_pages", "project_versions", "project_op_batches")

RLS_POLICY = """
CREATE POLICY {table}_scope ON {table}
    USING (
        current_setting('app.is_super_admin', true) = 'true'
        OR space_id::text = current_setting('app.current_scope_id', true)
    )
    WITH CHECK (
        current_setting('app.is_super_admin', true) = 'true'
        OR space_id::text = current_setting('app.current_scope_id', true)
    )
"""


def upgrade() -> None:
    op.create_table('projects',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('space_id', sa.UUID(), nullable=False),
    sa.Column('created_by', sa.UUID(), nullable=True),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('custom_components', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('schema_version', sa.String(length=10), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['space_id'], ['spaces.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_projects_space_status', 'projects', ['space_id', 'status'], unique=False)

    op.create_table('project_pages',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=False),
    sa.Column('space_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('route', sa.String(length=255), nullable=True),
    sa.Column('pos', sa.String(length=64), nullable=False),
    sa.Column('document', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('entity_versions', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_project_pages_space_project', 'project_pages', ['space_id', 'project_id'], unique=False)
    # The hot row: every committed canvas action rewrites one page's document.
    # LZ4 makes the TOAST rewrite cheap; the aggressive autovacuum keeps the
    # dead-tuple churn from bloating the table.
    op.execute("ALTER TABLE project_pages ALTER COLUMN document SET COMPRESSION lz4")
    op.execute(
        "ALTER TABLE project_pages SET (autovacuum_vacuum_scale_factor = 0.02, "
        "autovacuum_analyze_scale_factor = 0.02)"
    )

    op.create_table('project_versions',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=False),
    sa.Column('space_id', sa.UUID(), nullable=False),
    sa.Column('snapshot', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('label', sa.String(length=255), nullable=True),
    sa.Column('reason', sa.String(length=40), nullable=False),
    sa.Column('created_by', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_project_versions_space_project', 'project_versions', ['space_id', 'project_id', 'created_at'], unique=False)
    op.execute("ALTER TABLE project_versions ALTER COLUMN snapshot SET COMPRESSION lz4")

    op.create_table('project_op_batches',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=False),
    sa.Column('space_id', sa.UUID(), nullable=False),
    sa.Column('client_batch_id', sa.String(length=64), nullable=False),
    sa.Column('request_hash', sa.String(length=64), nullable=False),
    sa.Column('status_code', sa.Integer(), nullable=False),
    sa.Column('response', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('applied_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('project_id', 'client_batch_id', name='uq_project_op_batches_client')
    )
    op.create_index('ix_project_op_batches_space_applied', 'project_op_batches', ['space_id', 'applied_at'], unique=False)

    for table in STUDIO_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(RLS_POLICY.format(table=table))

    # The template's demonstration feature; superseded by the studio module.
    op.drop_index(op.f('ix_items_space_id'), table_name='items')
    op.drop_table('items')


def downgrade() -> None:
    op.create_table('items',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('space_id', sa.UUID(), nullable=False),
    sa.Column('created_by', sa.UUID(), nullable=False),
    sa.Column('title', sa.String(length=255), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['created_by'], ['users.id']),
    sa.ForeignKeyConstraint(['space_id'], ['spaces.id']),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_items_space_id'), 'items', ['space_id'], unique=False)

    for table in reversed(STUDIO_TABLES):
        op.execute(f"DROP POLICY IF EXISTS {table}_scope ON {table}")
    op.drop_index('ix_project_op_batches_space_applied', table_name='project_op_batches')
    op.drop_table('project_op_batches')
    op.drop_index('ix_project_versions_space_project', table_name='project_versions')
    op.drop_table('project_versions')
    op.drop_index('ix_project_pages_space_project', table_name='project_pages')
    op.drop_table('project_pages')
    op.drop_index('ix_projects_space_status', table_name='projects')
    op.drop_table('projects')
