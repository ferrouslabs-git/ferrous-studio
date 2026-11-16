"""High-fidelity designs: a design is for one, several or all wireframes

``project_designs.wireframe_id`` becomes:

- ``all_wireframes``: every active wireframe of the project, resolved when
  the brief is read, so a wireframe added later is part of the next build;
- ``wireframe_ids``: otherwise the wireframes picked, in order (JSONB list of
  id strings -- soft references, like the column it replaces).

Existing rows keep their one wireframe.

Row-level security is forced on ``project_designs`` and, since f7a3d8e1c265,
its WITH CHECK only admits the row's own organisation -- not even
``app.is_super_admin``. Setting that flag alone would leave the backfill
updating nothing (see ``7c41e2a9d0b3``), so FORCE is lifted for the
migration's own transaction and put back before it ends.

Revision ID: b5d1f7e3a926
Revises: a4c8e2f6b913
Create Date: 2026-11-16
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'b5d1f7e3a926'
down_revision: Union[str, None] = 'a4c8e2f6b913'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _owner_bypass() -> None:
    op.execute("ALTER TABLE project_designs NO FORCE ROW LEVEL SECURITY")
    # wireframes is read by the downgrade; reading only needs the flag.
    op.execute("SELECT set_config('app.is_super_admin', 'true', true)")


def _restore_rls() -> None:
    op.execute("ALTER TABLE project_designs FORCE ROW LEVEL SECURITY")


def upgrade() -> None:
    op.add_column(
        'project_designs',
        sa.Column('all_wireframes', sa.Boolean(), nullable=False, server_default=sa.text('false')),
    )
    op.add_column(
        'project_designs',
        sa.Column(
            'wireframe_ids',
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    _owner_bypass()
    op.execute("UPDATE project_designs SET wireframe_ids = jsonb_build_array(wireframe_id::text)")
    _restore_rls()
    op.drop_column('project_designs', 'wireframe_id')


def downgrade() -> None:
    op.add_column('project_designs', sa.Column('wireframe_id', sa.UUID(), nullable=True))
    _owner_bypass()
    # The first wireframe picked; for "all", the project's first active one.
    op.execute(
        """
        UPDATE project_designs d SET wireframe_id = COALESCE(
            (d.wireframe_ids->>0)::uuid,
            (SELECT w.id FROM wireframes w
              WHERE w.project_id = d.project_id AND w.status = 'active'
              ORDER BY w.pos LIMIT 1)
        )
        """
    )
    # A design with nothing to point at cannot satisfy the old NOT NULL.
    op.execute("DELETE FROM project_designs WHERE wireframe_id IS NULL")
    _restore_rls()
    op.alter_column('project_designs', 'wireframe_id', nullable=False)
    op.drop_column('project_designs', 'wireframe_ids')
    op.drop_column('project_designs', 'all_wireframes')
