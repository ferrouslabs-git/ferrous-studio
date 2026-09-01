"""drop the tenants.plan column

Ferrous Studio is an internal tool: organisations have no pricing plan, and the
column only ever held its "free" default. Dropping it is irreversible for the
data, but the data carried no meaning -- the downgrade re-adds the column with
the same default rather than restoring per-organisation values.

Revision ID: c3b7f1a5e284
Revises: 9d4e1a7c5b02
Create Date: 2026-08-26
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c3b7f1a5e284'
down_revision: Union[str, None] = '9d4e1a7c5b02'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column('tenants', 'plan')


def downgrade() -> None:
    op.add_column(
        'tenants',
        sa.Column('plan', sa.String(length=50), nullable=True, server_default='free'),
    )
