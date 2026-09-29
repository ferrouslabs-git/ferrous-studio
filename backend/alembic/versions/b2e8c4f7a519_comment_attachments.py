"""Comments can carry attachments

A comment on a requirement is where people capture feedback, and feedback is
often a screenshot or a marked-up document. Attachments already hang off
board entities polymorphically (entity_type + entity_id, no FK -- see
service._ENTITY_TABLES), so a comment is simply one more owner: this only
widens the CHECK on board_attachments.entity_type.

Downgrade deletes the comment attachment rows first -- the narrower CHECK
cannot be restored while they exist. Their S3 objects are left in place.

Revision ID: b2e8c4f7a519
Revises: a6d3f9c2e814
Create Date: 2026-09-29
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'b2e8c4f7a519'
down_revision: Union[str, None] = 'a6d3f9c2e814'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

BEFORE = ("release", "epic", "feature", "requirement", "doc", "feedback")
AFTER = (*BEFORE, "comment")


def _recast(entities: tuple[str, ...]) -> None:
    values = ",".join(f"'{e}'" for e in entities)
    op.drop_constraint('ck_board_attachments_entity_type', 'board_attachments', type_='check')
    op.create_check_constraint('ck_board_attachments_entity_type', 'board_attachments', f"entity_type IN ({values})")


def upgrade() -> None:
    _recast(AFTER)


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text("SELECT set_config('app.is_super_admin', 'true', true)"))
    # A delete needs no WITH CHECK, so the read bypass is enough.
    conn.execute(sa.text("DELETE FROM board_attachments WHERE entity_type = 'comment'"))
    _recast(BEFORE)
