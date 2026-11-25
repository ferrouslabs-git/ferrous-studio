"""Requirements carry no actual time (FS-REQ-106)

The board stops sizing work by requirement hours: progress and burndown are
counted in requirements, and work is planned by putting features into sprints
and sprints into releases. ``board_requirements.actual_hours`` goes, data and
all. ``estimate_hours`` stays: a requirement raised from a feedback report
still carries the estimate the maintenance log charges that report, set from
the report's page, never the board.

The downgrade only brings the column back, empty; the dropped hours are not
recoverable.

Revision ID: d9e5a3b7c142
Revises: d8b4f2a6c917
Create Date: 2026-11-25
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'd9e5a3b7c142'
down_revision: Union[str, None] = 'd8b4f2a6c917'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("board_requirements", "actual_hours")


def downgrade() -> None:
    op.add_column("board_requirements", sa.Column("actual_hours", sa.Float(), nullable=True))
