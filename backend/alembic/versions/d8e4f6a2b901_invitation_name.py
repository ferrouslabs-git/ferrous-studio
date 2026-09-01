"""add invitations.name and merge the two migration heads

The invite form now captures the invitee's name so the Users list can show it
before they join, and so the account created on acceptance starts with a name.

This revision also merges the two heads left by ``b7e2c4d9a1f3`` (project
sections) and ``c3b7f1a5e284`` (drop tenant plan), which both branched from
``9d4e1a7c5b02``.

Revision ID: d8e4f6a2b901
Revises: b7e2c4d9a1f3, c3b7f1a5e284
Create Date: 2026-08-26
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd8e4f6a2b901'
down_revision: Union[str, Sequence[str], None] = ('b7e2c4d9a1f3', 'c3b7f1a5e284')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('invitations', sa.Column('name', sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column('invitations', 'name')
