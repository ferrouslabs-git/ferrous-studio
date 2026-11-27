"""A usability study's gap between bookable slots

``usability_studies.slot_gap_minutes``: the break between one session and
the next when a window is cut into slots (0 = back to back, as before).

Additive: a column with a default; existing studies keep back-to-back slots.

Revision ID: c4f7a2e9d815
Revises: b8e2d4f6a913
Create Date: 2026-11-27
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'c4f7a2e9d815'
down_revision: Union[str, None] = 'b8e2d4f6a913'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "usability_studies",
        sa.Column("slot_gap_minutes", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("usability_studies", "slot_gap_minutes")
