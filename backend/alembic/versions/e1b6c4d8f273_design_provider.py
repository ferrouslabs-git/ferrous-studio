"""High-fidelity designs are made in Figma or in Claude Design

``project_designs.provider`` says which tool holds the design, chosen when it
is created: ``figma`` (a Figma Make file, shown by framing its published
figma.site page) or ``claude`` (a Claude Design artifact, shown by linking to
its public share link -- claude.ai refuses to be framed by other sites).
Existing designs were all made in Figma Make, so the column defaults to
``figma`` and they keep working unchanged.

``figma_url`` and ``published_url`` keep their names and mean the same for
either tool: where the design is edited, and the address Studio shows.

Additive: no data changes beyond the default.

Revision ID: e1b6c4d8f273
Revises: d9e5a3b7c142
Create Date: 2026-11-25
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'e1b6c4d8f273'
down_revision: Union[str, None] = 'd9e5a3b7c142'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "project_designs",
        sa.Column("provider", sa.String(length=20), nullable=False, server_default="figma"),
    )
    op.create_check_constraint(
        "ck_project_designs_provider", "project_designs", "provider IN ('figma', 'claude')"
    )


def downgrade() -> None:
    op.drop_constraint("ck_project_designs_provider", "project_designs", type_="check")
    op.drop_column("project_designs", "provider")
