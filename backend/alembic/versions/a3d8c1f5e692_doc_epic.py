"""Doc: add epic_id.

Ported from software-management (backend/store.py, added to docs
2026-09-04). A doc filed under an epic shows there; unfiled (epic_id NULL)
it shows on the Overview instead. delete_epic must unfile (not delete) any
docs under it, same principle as everything else that cascade -- see the
routes.py change alongside this migration.

Revision ID: a3d8c1f5e692
Revises: f9c3e7a2d854
Create Date: 2026-09-08

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'a3d8c1f5e692'
down_revision: Union[str, None] = 'f9c3e7a2d854'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('board_docs', sa.Column('epic_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        'board_docs_epic_id_fkey', 'board_docs', 'board_epics', ['epic_id'], ['id'], ondelete='SET NULL'
    )
    op.create_index('ix_board_docs_epic', 'board_docs', ['epic_id'])


def downgrade() -> None:
    op.drop_index('ix_board_docs_epic', table_name='board_docs')
    op.drop_constraint('board_docs_epic_id_fkey', 'board_docs', type_='foreignkey')
    op.drop_column('board_docs', 'epic_id')
