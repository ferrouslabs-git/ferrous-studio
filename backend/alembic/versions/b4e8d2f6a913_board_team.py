"""Boards: a product manager and a support developer

Two super admins a project's feedback is routed to on Slack: the support
developer hears about new and confirmed reports, the product manager about
reports awaiting an estimate's confirmation, reports judged not a bug, and
reports whose requirements are all ready to test. Kept on the board, so they
belong to the lineage and survive versioning like the project key.

Revision ID: b4e8d2f6a913
Revises: a7d3e9f2c418
Create Date: 2026-10-19
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'b4e8d2f6a913'
down_revision: Union[str, None] = 'a7d3e9f2c418'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_ROLES = ('product_manager_id', 'support_dev_id')


def upgrade() -> None:
    for column in _ROLES:
        op.add_column('boards', sa.Column(column, sa.UUID(), nullable=True))
        op.create_foreign_key(f'fk_boards_{column}', 'boards', 'users', [column], ['id'], ondelete='SET NULL')


def downgrade() -> None:
    for column in _ROLES:
        op.drop_constraint(f'fk_boards_{column}', 'boards', type_='foreignkey')
        op.drop_column('boards', column)
