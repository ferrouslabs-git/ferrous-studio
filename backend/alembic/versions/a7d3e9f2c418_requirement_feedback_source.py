"""Requirements remember the feedback report they were raised from (FS-REQ-54)

A report may now raise more than one requirement, so the link moves to the
requirement side: ``board_requirements.feedback_id`` (board_feedback, SET
NULL). The maintenance log charges a report at the sum of its requirements'
estimates once it has any, and at the report's own estimate until then.
Existing links are carried over from ``board_feedback.requirement_id``, which
stays as the most recently raised requirement.

Revision ID: a7d3e9f2c418
Revises: f2a9c4d7e815
Create Date: 2026-10-16
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'a7d3e9f2c418'
down_revision: Union[str, None] = 'f2a9c4d7e815'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('board_requirements', sa.Column('feedback_id', sa.UUID(), nullable=True))
    op.create_foreign_key(
        'fk_board_requirements_feedback', 'board_requirements', 'board_feedback',
        ['feedback_id'], ['id'], ondelete='SET NULL',
    )
    op.create_index('ix_board_requirements_feedback', 'board_requirements', ['feedback_id'])
    # Both tables run FORCE ROW LEVEL SECURITY, and the board policies' WITH
    # CHECK has no super-admin clause, so the owner backfills with the force
    # lifted for the one statement (as f5c2a8d1e937's downgrade does).
    for table in ('board_requirements', 'board_feedback'):
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        UPDATE board_requirements r
           SET feedback_id = f.id
          FROM board_feedback f
         WHERE f.requirement_id = r.id
        """
    )
    for table in ('board_requirements', 'board_feedback'):
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_index('ix_board_requirements_feedback', table_name='board_requirements')
    op.drop_constraint('fk_board_requirements_feedback', 'board_requirements', type_='foreignkey')
    op.drop_column('board_requirements', 'feedback_id')
