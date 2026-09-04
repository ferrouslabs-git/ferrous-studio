"""page presentation: pages that open as a modal or drawer overlay

Nullable "modal" | "drawer" on project_pages; null keeps the ordinary
navigate-to-page behaviour, so existing rows need no backfill.

Revision ID: f4b9e2d7c163
Revises: d7a4e9b2c581
Create Date: 2026-09-02
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f4b9e2d7c163'
down_revision: Union[str, None] = 'd7a4e9b2c581'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('project_pages', sa.Column('presentation', sa.String(length=20), nullable=True))


def downgrade() -> None:
    op.drop_column('project_pages', 'presentation')
