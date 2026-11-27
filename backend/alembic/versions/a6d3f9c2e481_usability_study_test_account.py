"""A usability study holds the test account its participants use by default

``usability_studies.account_email`` / ``account_password`` / ``account_notes``:
the test account every participant is given unless their own row says
otherwise. A participant's own value, when set, wins; a blank one falls back
to the study's, so changing the study's reaches everyone not overridden.

Additive: nullable columns, no data changes. Existing participants keep the
details already on their rows.

Revision ID: a6d3f9c2e481
Revises: e1b6c4d8f273
Create Date: 2026-11-27
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'a6d3f9c2e481'
down_revision: Union[str, None] = 'e1b6c4d8f273'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("usability_studies", sa.Column("account_email", sa.String(length=255), nullable=True))
    op.add_column("usability_studies", sa.Column("account_password", sa.String(length=255), nullable=True))
    op.add_column("usability_studies", sa.Column("account_notes", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("usability_studies", "account_notes")
    op.drop_column("usability_studies", "account_password")
    op.drop_column("usability_studies", "account_email")
