"""Requirement: Review + Blocked statuses, blocked_from bookkeeping.

Ported from software-management (backend/store.py, static/js/core.js): the
real status set is Todo/Doing/Review/Blocked/Done, not Todo/Doing/Done.
Blocked is a flag on top of the Todo->Doing->Review->Done path, not a stage
on it -- blocked_from records which of the three in-flight stages to return
to when unblocked, computed automatically on the transition (routes.py's
update_requirement) rather than sent by the client.

Ferrous Studio's original board port added a CHECK constraint
software-management itself doesn't have (d4f7b2a9c631's docstring:
"requirements.status/priority get real CHECK constraints. SMA has none");
that constraint still names the old 3-value set and must widen too, or
every transition into Review/Blocked fails at the database with a
CheckViolationError -- caught locally while verifying this migration.

Revision ID: f9c3e7a2d854
Revises: e8f4b1c6a927
Create Date: 2026-09-08

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'f9c3e7a2d854'
down_revision: Union[str, None] = 'e8f4b1c6a927'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_OLD_STATUSES = "'Todo','Doing','Done'"
_NEW_STATUSES = "'Todo','Doing','Review','Blocked','Done'"


def upgrade() -> None:
    op.add_column('board_requirements', sa.Column('blocked_from', sa.String(length=10), nullable=True))
    op.drop_constraint('ck_board_requirements_status', 'board_requirements', type_='check')
    op.create_check_constraint('ck_board_requirements_status', 'board_requirements', f"status IN ({_NEW_STATUSES})")


def downgrade() -> None:
    op.drop_constraint('ck_board_requirements_status', 'board_requirements', type_='check')
    op.create_check_constraint('ck_board_requirements_status', 'board_requirements', f"status IN ({_OLD_STATUSES})")
    op.drop_column('board_requirements', 'blocked_from')
