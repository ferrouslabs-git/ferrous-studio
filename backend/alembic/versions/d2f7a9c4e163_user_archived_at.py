"""archive a user: the platform-level "has left" state

Users already have a temporary block (``is_active`` + ``suspended_at``) and
a permanent one (hard delete). This adds the filing state in between, the
one projects and wireframes already have: ``archived_at`` set means the
person has left the platform. They cannot sign in, they drop out of the
default Users list, but the record and everything attributed to it survive,
and Restore brings them back exactly as they were.

Kept separate from ``is_active`` on purpose: restoring an archived user only
clears ``archived_at``, so someone who was suspended and then archived comes
back suspended, not quietly reinstated.

Nothing is backfilled: every existing user is simply not archived.

Revision ID: d2f7a9c4e163
Revises: c8a3f5d1e746
Create Date: 2026-09-07
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd2f7a9c4e163'
down_revision: Union[str, None] = 'c8a3f5d1e746'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('archived_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'archived_at')
