"""landscape tablets: allow wireframes.interface_type = tablet_landscape

``tablet`` keeps meaning a portrait tablet, and landscape arrives as its own
value (``tablet_landscape``) rather than a separate orientation column: a
wireframe stays described by one field and existing rows need no backfill.

Two things gate the column and only one of them is visible in ``models.py``:
the type, varchar(16), which the new value fills exactly (widened to 32 so the
next interface type needs no migration), and ``ck_wireframes_interface_type``
from b7e2c4d9a1f3, which lists the accepted values and exists only in the
migrations. A check constraint cannot be altered, so it is dropped and
recreated.

Revision ID: b6e1d3a9f724
Revises: a7f3c9e2b514
Create Date: 2026-09-04
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b6e1d3a9f724'
down_revision: Union[str, None] = 'a7f3c9e2b514'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


INTERFACE_TYPES = "'desktop', 'tablet', 'tablet_landscape', 'mobile'"
OLD_INTERFACE_TYPES = "'desktop', 'tablet', 'mobile'"


def upgrade() -> None:
    op.alter_column(
        'wireframes',
        'interface_type',
        existing_type=sa.String(16),
        type_=sa.String(32),
        existing_nullable=False,
    )
    op.drop_constraint('ck_wireframes_interface_type', 'wireframes', type_='check')
    op.create_check_constraint(
        'ck_wireframes_interface_type', 'wireframes', f"interface_type IN ({INTERFACE_TYPES})"
    )


def downgrade() -> None:
    # Landscape tablets fall back to portrait: the value no longer fits, and a
    # portrait tablet is the closest thing the old schema can express.
    op.execute("UPDATE wireframes SET interface_type = 'tablet' WHERE interface_type = 'tablet_landscape'")
    op.drop_constraint('ck_wireframes_interface_type', 'wireframes', type_='check')
    op.create_check_constraint(
        'ck_wireframes_interface_type', 'wireframes', f"interface_type IN ({OLD_INTERFACE_TYPES})"
    )
    op.alter_column(
        'wireframes',
        'interface_type',
        existing_type=sa.String(32),
        type_=sa.String(16),
        existing_nullable=False,
    )
