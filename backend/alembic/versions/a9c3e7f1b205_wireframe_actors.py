"""wireframe actors: link wireframes to the user types they are designed for

A join table mirroring ``wireframe_personas`` (see ``b7e2c4d9a1f3``) but
pointing at ``use_case_actors``. A wireframe keeps its persona links and
gains zero or more user-type links; deleting either side cascades the row.
Carries ``account_id`` so the same row-level-security policy applies.

Revision ID: a9c3e7f1b205
Revises: f4d2a8c6e017
Create Date: 2026-08-27
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a9c3e7f1b205'
down_revision: Union[str, None] = 'f4d2a8c6e017'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "wireframe_actors"

RLS_POLICY = """
CREATE POLICY {table}_scope ON {table}
    USING (
        current_setting('app.is_super_admin', true) = 'true'
        OR account_id::text = current_setting('app.current_scope_id', true)
    )
    WITH CHECK (
        current_setting('app.is_super_admin', true) = 'true'
        OR account_id::text = current_setting('app.current_scope_id', true)
    )
"""


def upgrade() -> None:
    op.create_table(
        TABLE,
        sa.Column('wireframe_id', sa.UUID(), nullable=False),
        sa.Column('actor_id', sa.UUID(), nullable=False),
        sa.Column('account_id', sa.UUID(), nullable=False),
        sa.ForeignKeyConstraint(['actor_id'], ['use_case_actors.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['wireframe_id'], ['wireframes.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('wireframe_id', 'actor_id'),
    )
    op.create_index('ix_wireframe_actors_account_actor', TABLE, ['account_id', 'actor_id'], unique=False)
    op.execute(f"ALTER TABLE {TABLE} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {TABLE} FORCE ROW LEVEL SECURITY")
    op.execute(RLS_POLICY.format(table=TABLE))


def downgrade() -> None:
    op.drop_index('ix_wireframe_actors_account_actor', table_name=TABLE)
    op.drop_table(TABLE)
