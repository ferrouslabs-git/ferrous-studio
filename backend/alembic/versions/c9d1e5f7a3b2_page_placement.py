"""Child pages: nullable placement on project_pages.

``placement`` = {"page_id", "region_id"} makes a page render inside a region
of its parent (the outlet model behind region-targeted links). Page documents
themselves moved from the frames/regions format to the layout-tree format;
that is a JSONB content change with no schema impact -- old documents are
reset client-side on first open.

Revision ID: c9d1e5f7a3b2
Revises: a9c3e7f1b205
Create Date: 2026-09-01
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "c9d1e5f7a3b2"
down_revision: Union[str, None] = "a9c3e7f1b205"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("project_pages", sa.Column("placement", JSONB, nullable=True))


def downgrade() -> None:
    op.drop_column("project_pages", "placement")
