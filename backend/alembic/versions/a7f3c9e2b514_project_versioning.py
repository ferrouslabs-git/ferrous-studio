"""project versioning: a project row is also a version

Versioning a project deep-copies it and everything it owns into a new
``projects`` row, which then diverges independently. Because every child table
is already keyed by ``project_id`` and policed by RLS on ``account_id``, a
version needs no table of its own -- only ancestry columns here. Nothing else
in the schema, the policies or the queries changes.

``lineage_id`` groups the versions of one project and is backfilled to each
existing row's own id, so every project today becomes v1 of its own lineage.
``parent_project_id`` is the adjacency list versions branch along.

The backfill needs ``app.is_super_admin`` set first: ``projects`` runs FORCE
ROW LEVEL SECURITY, so an UPDATE without it matches no rows and the migration
"succeeds" having changed nothing (same trap as e1c4a7f2b930).

``version_key`` is the client's idempotency key for the copy, kept on the row
it created and uniquely indexed per parent: a double-click or a retry then
finds the version it already made instead of forking a second one.

``wireframe_audit_log.wireframe_id`` becomes nullable in the same step: a
version being created, locked or unlocked is a project-level event with no
wireframe to hang off, and an unlockable freeze that records no unlocker is a
speed bump rather than a control.

Revision ID: a7f3c9e2b514
Revises: a7c2e5d9f314
Create Date: 2026-09-04
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID


revision: str = 'a7f3c9e2b514'
down_revision: Union[str, None] = 'a7c2e5d9f314'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('projects', sa.Column('lineage_id', UUID(as_uuid=True), nullable=True))
    op.add_column(
        'projects', sa.Column('parent_project_id', UUID(as_uuid=True), nullable=True)
    )
    op.add_column('projects', sa.Column('version_no', sa.Integer(), nullable=False, server_default='1'))
    op.add_column('projects', sa.Column('version_label', sa.String(length=255), nullable=True))
    op.add_column('projects', sa.Column('locked_at', sa.DateTime(), nullable=True))
    op.add_column('projects', sa.Column('locked_by', UUID(as_uuid=True), nullable=True))
    op.add_column('projects', sa.Column('version_key', sa.String(length=64), nullable=True))

    # Without this the UPDATE below silently matches zero rows (see docstring).
    op.execute("SELECT set_config('app.is_super_admin', 'true', true)")
    op.execute('UPDATE projects SET lineage_id = id WHERE lineage_id IS NULL')
    op.alter_column('projects', 'lineage_id', nullable=False)

    op.create_foreign_key(
        'fk_projects_parent_project', 'projects', 'projects', ['parent_project_id'], ['id'], ondelete='SET NULL'
    )
    op.create_foreign_key(
        'fk_projects_locked_by', 'projects', 'users', ['locked_by'], ['id'], ondelete='SET NULL'
    )
    op.create_index('ix_projects_account_lineage', 'projects', ['account_id', 'lineage_id', 'version_no'])
    # Partial: roots carry no key, and NULLs would not collide anyway.
    op.create_index(
        'uq_projects_version_key',
        'projects',
        ['parent_project_id', 'version_key'],
        unique=True,
        postgresql_where=sa.text('version_key IS NOT NULL'),
    )

    op.alter_column('wireframe_audit_log', 'wireframe_id', existing_type=UUID(), nullable=True)


def downgrade() -> None:
    # Project-level entries have no wireframe, so they cannot survive the
    # column going back to NOT NULL.
    op.execute("SELECT set_config('app.is_super_admin', 'true', true)")
    op.execute('DELETE FROM wireframe_audit_log WHERE wireframe_id IS NULL')
    op.alter_column('wireframe_audit_log', 'wireframe_id', existing_type=UUID(), nullable=False)

    op.drop_index('uq_projects_version_key', table_name='projects')
    op.drop_index('ix_projects_account_lineage', table_name='projects')
    op.drop_constraint('fk_projects_locked_by', 'projects', type_='foreignkey')
    op.drop_constraint('fk_projects_parent_project', 'projects', type_='foreignkey')
    for column in (
        'version_key', 'locked_by', 'locked_at', 'version_label', 'version_no', 'parent_project_id', 'lineage_id'
    ):
        op.drop_column('projects', column)
