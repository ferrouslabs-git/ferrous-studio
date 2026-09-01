"""remove the workspace (space) layer: organisations own projects directly

Destructive by design (agreed with the product owner): the studio tables are
dropped and recreated keyed on ``account_id`` rather than migrated, so existing
projects, pages, versions and op batches are discarded. Space memberships are
deleted, space-targeted invitations revoked, and the ``spaces`` table dropped.

Two things here are easy to get wrong and both fail *silently*:

  * The row-level-security policies key on ``current_setting('app.current_scope_id')``,
    which now carries an organisation UUID. A policy left comparing ``space_id``
    would match no rows at all -- an empty project list, not an error. They are
    recreated against ``account_id`` below.
  * ``account_owner`` no longer exists in auth_config.yaml, and an unknown role
    resolves to the empty permission set rather than raising, so any membership
    still holding it would 403 on everything. Those rows are rewritten to
    ``account_admin``.

Revision ID: 9d4e1a7c5b02
Revises: 7c41e2a9d0b3
Create Date: 2026-08-26
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '9d4e1a7c5b02'
down_revision: Union[str, None] = '7c41e2a9d0b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

STUDIO_TABLES = ("projects", "project_pages", "project_versions", "project_op_batches")

RLS_POLICY = """
CREATE POLICY {table}_scope ON {table}
    USING (
        current_setting('app.is_super_admin', true) = 'true'
        OR {column}::text = current_setting('app.current_scope_id', true)
    )
    WITH CHECK (
        current_setting('app.is_super_admin', true) = 'true'
        OR {column}::text = current_setting('app.current_scope_id', true)
    )
"""


def _create_studio_tables(scope_column: str, scope_table: str, index_stem: str) -> None:
    """Create the four studio tables keyed on ``scope_column``.

    Shared by upgrade (account_id -> tenants) and downgrade (space_id -> spaces)
    so the two paths cannot drift apart.
    """
    op.create_table('projects',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column(scope_column, sa.UUID(), nullable=False),
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
    sa.ForeignKeyConstraint([scope_column], [f'{scope_table}.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(f'ix_projects_{index_stem}_status', 'projects', [scope_column, 'status'], unique=False)

    op.create_table('project_pages',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=False),
    sa.Column(scope_column, sa.UUID(), nullable=False),
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
    op.create_index(f'ix_project_pages_{index_stem}_project', 'project_pages', [scope_column, 'project_id'], unique=False)
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
    sa.Column(scope_column, sa.UUID(), nullable=False),
    sa.Column('snapshot', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('label', sa.String(length=255), nullable=True),
    sa.Column('reason', sa.String(length=40), nullable=False),
    sa.Column('created_by', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(f'ix_project_versions_{index_stem}_project', 'project_versions', [scope_column, 'project_id', 'created_at'], unique=False)
    op.execute("ALTER TABLE project_versions ALTER COLUMN snapshot SET COMPRESSION lz4")

    op.create_table('project_op_batches',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=False),
    sa.Column(scope_column, sa.UUID(), nullable=False),
    sa.Column('client_batch_id', sa.String(length=64), nullable=False),
    sa.Column('request_hash', sa.String(length=64), nullable=False),
    sa.Column('status_code', sa.Integer(), nullable=False),
    sa.Column('response', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('applied_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('project_id', 'client_batch_id', name='uq_project_op_batches_client')
    )
    op.create_index(f'ix_project_op_batches_{index_stem}_applied', 'project_op_batches', [scope_column, 'applied_at'], unique=False)

    for table in STUDIO_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(RLS_POLICY.format(table=table, column=scope_column))


def upgrade() -> None:
    # 1. Discard studio storage. CASCADE takes the RLS policies, indexes and
    #    dependent foreign keys with the tables.
    for table in reversed(STUDIO_TABLES):
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE")

    # 2. Recreate it keyed on the owning organisation.
    _create_studio_tables("account_id", "tenants", "account")

    # 3. Collapse the scope model onto organisations.
    op.execute("DELETE FROM memberships WHERE scope_type = 'space'")
    op.execute("DELETE FROM permission_grants WHERE role_name LIKE 'space\\_%'")
    op.execute("DELETE FROM role_definitions WHERE layer = 'space'")

    # Outstanding invitations to a space now point at a scope that no longer
    # exists; revoke rather than delete so the audit trail survives.
    op.execute(
        "UPDATE invitations SET revoked_at = NOW() AT TIME ZONE 'utc' "
        "WHERE target_scope_type = 'space' AND revoked_at IS NULL AND accepted_at IS NULL"
    )

    # 4. account_owner is gone; its holders become account_admin.
    op.execute(
        "UPDATE memberships SET role_name = 'account_admin' "
        "WHERE role_name IN ('account_owner', 'owner')"
    )
    op.execute(
        "UPDATE invitations SET target_role_name = 'account_admin' "
        "WHERE target_role_name IN ('account_owner', 'owner')"
    )

    # 5. The workspace layer itself.
    op.drop_index(op.f('ix_spaces_account_id'), table_name='spaces')
    op.drop_table('spaces')


def downgrade() -> None:
    # Recreates the shape, not the data: the upgrade discarded it.
    op.create_table('spaces',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('account_id', sa.UUID(), nullable=True),
    sa.Column('status', sa.String(length=20), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('suspended_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['account_id'], ['tenants.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_spaces_account_id'), 'spaces', ['account_id'], unique=False)

    for table in reversed(STUDIO_TABLES):
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
    _create_studio_tables("space_id", "spaces", "space")
