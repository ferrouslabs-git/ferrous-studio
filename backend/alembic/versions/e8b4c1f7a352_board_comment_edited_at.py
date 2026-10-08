"""Board comments: when a comment was last edited (FS-REQ-36)

A comment's author may now change what it says. ``edited_at`` records the
last edit so the thread can mark the comment as edited; NULL means it reads
exactly as it was posted.

Revision ID: e8b4c1f7a352
Revises: d3b8f1a6c924
Create Date: 2026-10-07
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'e8b4c1f7a352'
down_revision: Union[str, None] = 'd3b8f1a6c924'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('board_comments', sa.Column('edited_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column('board_comments', 'edited_at')
