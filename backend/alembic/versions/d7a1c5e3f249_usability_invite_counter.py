"""Count a usability study's booking invite sends, resends included

``usability_studies.invites_window_start`` / ``invites_in_window``: how many
invites the study has sent since the start of its current one-day window.
The daily cap counts sends, so re-sending to the same people counts too.

Additive: two columns; existing studies start with an empty window.

Revision ID: d7a1c5e3f249
Revises: c4f7a2e9d815
Create Date: 2026-11-27
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'd7a1c5e3f249'
down_revision: Union[str, None] = 'c4f7a2e9d815'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("usability_studies", sa.Column("invites_window_start", sa.DateTime(), nullable=True))
    op.add_column(
        "usability_studies", sa.Column("invites_in_window", sa.Integer(), nullable=False, server_default="0")
    )


def downgrade() -> None:
    op.drop_column("usability_studies", "invites_in_window")
    op.drop_column("usability_studies", "invites_window_start")
