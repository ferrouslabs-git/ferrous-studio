"""add rate_limit_hits

The RateLimitHit model existed but was never imported by app.auth.models, so
Alembic autogenerate never saw it and the table was missing from the initial
schema. The DB-backed rate limiter and the platform cleanup job both write to
it.

Revision ID: 3f2a9c1d7b44
Revises: bab1365419da
Create Date: 2026-08-26
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '3f2a9c1d7b44'
down_revision: Union[str, None] = 'bab1365419da'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('rate_limit_hits',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('key', sa.String(length=255), nullable=False),
    sa.Column('hit_at', sa.DateTime(), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_rate_limit_hits_hit_at'), 'rate_limit_hits', ['hit_at'], unique=False)
    op.create_index(op.f('ix_rate_limit_hits_key'), 'rate_limit_hits', ['key'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_rate_limit_hits_key'), table_name='rate_limit_hits')
    op.drop_index(op.f('ix_rate_limit_hits_hit_at'), table_name='rate_limit_hits')
    op.drop_table('rate_limit_hits')
