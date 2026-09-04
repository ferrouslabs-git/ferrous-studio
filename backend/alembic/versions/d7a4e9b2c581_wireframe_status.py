"""wireframe status: archive instead of delete on the wireframes list

Mirrors the projects table's ``status`` column ("active" | "archived").
Existing rows become "active" via the server default.

Revision ID: d7a4e9b2c581
Revises: b3d8f2c6a917
Create Date: 2026-09-02
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd7a4e9b2c581'
down_revision: Union[str, None] = 'b3d8f2c6a917'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'wireframes',
        sa.Column('status', sa.String(length=20), nullable=False, server_default='active'),
    )


def downgrade() -> None:
    op.drop_column('wireframes', 'status')
