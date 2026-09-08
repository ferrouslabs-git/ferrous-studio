"""Epic: replace phase (Now/Next/Later) with a real lifecycle status.

Ported from software-management (backend/store.py, 2026-08-28): phase "never
represented real planning (no owner, no dates, no dependency on anything
else)" and was dropped outright. In its place, status tracks where the epic
itself sits in the agreed Definition-of-Done lifecycle: Readiness ->
Implementation -> ReleasedToUAT -> HumanValidation -> Done.

Safe to drop phase outright rather than migrate its values: nothing in
production has used the Epics page yet (same basis as the release_date
drop in d6a1f3c8b524).

Revision ID: e8f4b1c6a927
Revises: d6a1f3c8b524
Create Date: 2026-09-08

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'e8f4b1c6a927'
down_revision: Union[str, None] = 'd6a1f3c8b524'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_STATUSES = "'Readiness','Implementation','ReleasedToUAT','HumanValidation','Done'"


def upgrade() -> None:
    op.drop_column('board_epics', 'phase')
    op.add_column(
        'board_epics',
        sa.Column('status', sa.String(length=20), nullable=False, server_default='Readiness'),
    )
    op.create_check_constraint('ck_board_epics_status', 'board_epics', f"status IN ({_STATUSES})")
    op.alter_column('board_epics', 'status', server_default=None)


def downgrade() -> None:
    op.drop_constraint('ck_board_epics_status', 'board_epics', type_='check')
    op.drop_column('board_epics', 'status')
    op.add_column('board_epics', sa.Column('phase', sa.String(length=10), nullable=False, server_default='Later'))
    op.alter_column('board_epics', 'phase', server_default=None)
