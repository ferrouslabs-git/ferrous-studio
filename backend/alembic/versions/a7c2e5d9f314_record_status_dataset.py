"""platform dataset: Record status (Active / Archived / All)

The status vocabulary a CRUD list filters by. Seeded as a platform default so
every project's filter chip binds to the same three values, and so the studio's
CRUD recipe has a dataset to point at without inventing one per wireframe.

Fixed id, matching the convention in ``b3d8f2c6a917``: re-running against a
restored dump never duplicates the row, and the frontend can name the id
directly (see RECORD_STATUS_DATASET_ID in features/studio/model/crud.ts --
keep them in step). ``pos`` continues that migration's ``a0``..``a7`` sequence.

Revision ID: a7c2e5d9f314
Revises: c5f8a2d4e761
Create Date: 2026-09-04
"""
from datetime import datetime, UTC
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'a7c2e5d9f314'
down_revision: Union[str, None] = 'c5f8a2d4e761'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

JSONB = postgresql.JSONB(astext_type=sa.Text())

DATASET_ID = "6f1a2b3c-0009-4d5e-8f00-a1b2c3d4e509"
NAME = "Record status"
KIND = "status"
VALUES = ["Active", "Archived", "All"]
POS = "a8"


def upgrade() -> None:
    table = sa.table(
        'platform_datasets',
        sa.column('id', sa.UUID()),
        sa.column('name', sa.String()),
        sa.column('kind', sa.String()),
        sa.column('values', JSONB),
        sa.column('pos', sa.String()),
        sa.column('created_at', sa.DateTime()),
        sa.column('updated_at', sa.DateTime()),
    )
    now = datetime.now(UTC).replace(tzinfo=None)  # naive UTC, matching utc_now()
    op.bulk_insert(
        table,
        [
            {
                "id": DATASET_ID,
                "name": NAME,
                "kind": KIND,
                "values": VALUES,
                "pos": POS,
                "created_at": now,
                "updated_at": now,
            }
        ],
    )


def downgrade() -> None:
    # By id, not by name: a platform admin may have renamed the row, and we
    # must not remove one they created themselves. Compared as text because a
    # bound parameter arrives typed VARCHAR, and Postgres has no uuid = varchar
    # operator (the same ::text idiom the RLS policies use).
    op.execute(sa.text("DELETE FROM platform_datasets WHERE id::text = :id").bindparams(id=DATASET_ID))
