"""Datasets: matching terms (FS-REQ-61)

Besides its own name, a dataset may list other words an element label can
use for it -- "Company" for an Organisations list. An element whose text is
one of them binds the dataset automatically, exactly as a label naming the
dataset does. Both project and platform datasets carry the list.

Revision ID: f2a9c4d7e815
Revises: f5c2a8d1e937
Create Date: 2026-10-16
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = 'f2a9c4d7e815'
down_revision: Union[str, None] = 'f5c2a8d1e937'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    for table in ('datasets', 'platform_datasets'):
        op.add_column(table, sa.Column('match_terms', JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")))


def downgrade() -> None:
    for table in ('datasets', 'platform_datasets'):
        op.drop_column(table, 'match_terms')
