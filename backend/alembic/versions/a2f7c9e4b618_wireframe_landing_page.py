"""wireframe landing page: which page the studio and preview open on

Nullable soft reference (no FK, like ``project_pages.placement``): null means
the automatic behaviour — follow the shell's first nav link. A dangling id
(page deleted, snapshot restored without it) falls back the same way.

Revision ID: a2f7c9e4b618
Revises: f4b9e2d7c163
Create Date: 2026-09-02
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision: str = 'a2f7c9e4b618'
down_revision: Union[str, None] = 'f4b9e2d7c163'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('wireframes', sa.Column('landing_page_id', UUID(as_uuid=True), nullable=True))


def downgrade() -> None:
    op.drop_column('wireframes', 'landing_page_id')
