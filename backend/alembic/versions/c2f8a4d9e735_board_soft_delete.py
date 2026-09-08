"""Board soft delete.

Ported from software-management's deleted_at pattern (backend/store.py):
every content table gets a nullable deleted_at, delete sets it instead of
removing the row, and every read path filters deleted_at IS NULL (enforced
in board/routes.py and board/service.py, not here -- this migration only
adds the column).

Not applied to boards, board_events, board_tokens, agent_runs or
board_requirement_sprint_history: those are either the board itself, an
append-only audit/history log, or credentials -- none of them are things a
user "deletes" through the UI.

Revision ID: c2f8a4d9e735
Revises: b8e2c5f174ad
Create Date: 2026-09-08

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'c2f8a4d9e735'
down_revision: Union[str, None] = 'b8e2c5f174ad'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = (
    "board_releases",
    "board_epics",
    "board_features",
    "board_sprints",
    "board_requirements",
    "board_docs",
    "board_comments",
    "board_attachments",
)


def upgrade() -> None:
    for table in _TABLES:
        op.add_column(table, sa.Column("deleted_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    for table in _TABLES:
        op.drop_column(table, "deleted_at")
