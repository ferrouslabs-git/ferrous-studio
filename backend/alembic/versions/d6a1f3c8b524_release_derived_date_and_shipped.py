"""Release: drop the stored release_date, add shipped_at. Sprint: add
release_id + capacity_hours.

Ported from software-management (backend/store.py, 2026-09-07): a release's
date is no longer a field anyone sets -- it's derived as the end of the
latest sprint filed under it (see service.release_dates_map), so the date
always agrees with the sprint plan instead of drifting from it. Safe to drop
outright rather than backfill: nothing in production has used the Roadmap
feature yet (confirmed against the real client project before writing this).

That derivation depends on sprints knowing which release they belong to --
a column the original board port omitted entirely (software-management had
it from the start). Added here since nothing else works without it.

Revision ID: d6a1f3c8b524
Revises: c2f8a4d9e735
Create Date: 2026-09-08

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'd6a1f3c8b524'
down_revision: Union[str, None] = 'c2f8a4d9e735'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('board_releases', sa.Column('shipped_at', sa.DateTime(), nullable=True))
    op.drop_column('board_releases', 'release_date')
    op.add_column('board_sprints', sa.Column('release_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column('board_sprints', sa.Column('capacity_hours', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'board_sprints_release_id_fkey', 'board_sprints', 'board_releases', ['release_id'], ['id'], ondelete='SET NULL'
    )
    op.create_index('ix_board_sprints_release', 'board_sprints', ['release_id'])


def downgrade() -> None:
    op.drop_index('ix_board_sprints_release', table_name='board_sprints')
    op.drop_constraint('board_sprints_release_id_fkey', 'board_sprints', type_='foreignkey')
    op.drop_column('board_sprints', 'capacity_hours')
    op.drop_column('board_sprints', 'release_id')
    op.add_column('board_releases', sa.Column('release_date', sa.Date(), nullable=True))
    op.drop_column('board_releases', 'shipped_at')
