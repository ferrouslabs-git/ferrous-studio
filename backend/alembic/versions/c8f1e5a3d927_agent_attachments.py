"""Agents can attach files; sprints can carry them (FS-REQ-78)

Adds board_attachments.agent_name -- who uploaded a file through a board
token (the agent's name, or the token's label), since created_by is then the
token's creator -- and board_attachments.description (one optional line on
what the file is), and widens the entity_type CHECK to include 'sprint'.

Downgrade deletes the sprint attachment rows first -- the narrower CHECK
cannot be restored while they exist. Their S3 objects are left in place.

Revision ID: c8f1e5a3d927
Revises: b4e8d2f6a913
Create Date: 2026-10-28
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'c8f1e5a3d927'
down_revision: Union[str, None] = 'b4e8d2f6a913'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

BEFORE = ("release", "epic", "feature", "requirement", "doc", "feedback", "comment")
AFTER = (*BEFORE, "sprint")


def _recast(entities: tuple[str, ...]) -> None:
    values = ",".join(f"'{e}'" for e in entities)
    op.drop_constraint('ck_board_attachments_entity_type', 'board_attachments', type_='check')
    op.create_check_constraint('ck_board_attachments_entity_type', 'board_attachments', f"entity_type IN ({values})")


def upgrade() -> None:
    op.add_column('board_attachments', sa.Column('agent_name', sa.String(length=255), nullable=True))
    op.add_column(
        'board_attachments',
        sa.Column('description', sa.String(length=500), nullable=False, server_default=''),
    )
    _recast(AFTER)


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text("SELECT set_config('app.is_super_admin', 'true', true)"))
    # A delete needs no WITH CHECK, so the read bypass is enough.
    conn.execute(sa.text("DELETE FROM board_attachments WHERE entity_type = 'sprint'"))
    _recast(BEFORE)
    op.drop_column('board_attachments', 'description')
    op.drop_column('board_attachments', 'agent_name')
