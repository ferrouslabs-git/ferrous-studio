"""merge board agents with feedback/environment

Revision ID: 9f8aabc36c5d
Revises: b2e6f9c4a173, d3a8f1c5b427
Create Date: 2026-09-09 10:25:21.357965

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9f8aabc36c5d'
down_revision: Union[str, None] = ('b2e6f9c4a173', 'd3a8f1c5b427')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
