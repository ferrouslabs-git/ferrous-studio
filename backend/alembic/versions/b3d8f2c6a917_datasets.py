"""datasets: reusable value lists elements bind to, plus platform defaults

Two tables. ``datasets`` is project-scoped with the standard studio RLS
policy (see ``b7e2c4d9a1f3``). ``platform_datasets`` holds the defaults every
project sees; it has no organisation column, so no RLS -- platform admin
routes guard the writes. The defaults are seeded here with fixed ids so every
environment starts with the same catalogue; platform admins can edit or
remove them afterwards.

Revision ID: b3d8f2c6a917
Revises: c9d1e5f7a3b2
Create Date: 2026-09-02
"""
from datetime import datetime, UTC
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'b3d8f2c6a917'
down_revision: Union[str, None] = 'c9d1e5f7a3b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

RLS_POLICY = """
CREATE POLICY datasets_scope ON datasets
    USING (
        current_setting('app.is_super_admin', true) = 'true'
        OR account_id::text = current_setting('app.current_scope_id', true)
    )
    WITH CHECK (
        current_setting('app.is_super_admin', true) = 'true'
        OR account_id::text = current_setting('app.current_scope_id', true)
    )
"""

JSONB = postgresql.JSONB(astext_type=sa.Text())

# Seeded defaults: (fixed id, name, kind, values). Fixed ids keep every
# environment's seed rows identical, so re-running against a restored dump
# never duplicates them.
DEFAULTS: list[tuple[str, str, str, list[str]]] = [
    ("6f1a2b3c-0001-4d5e-8f00-a1b2c3d4e501", "UK addresses", "text", [
        "12 High Street, Leeds LS1 4HR",
        "8 Queen's Road, Bristol BS8 1QU",
        "3 Castle Street, Edinburgh EH2 3AH",
        "27 Market Square, Cambridge CB2 3QJ",
        "154 Deansgate, Manchester M3 3EE",
        "41 Victoria Avenue, Cardiff CF10 3NB",
    ]),
    ("6f1a2b3c-0002-4d5e-8f00-a1b2c3d4e502", "Full names", "person", [
        "Ada Lovelace", "Alan Turing", "Grace Hopper", "Katherine Johnson", "Tim Berners-Lee", "Margaret Hamilton",
    ]),
    ("6f1a2b3c-0003-4d5e-8f00-a1b2c3d4e503", "Email addresses", "email", [
        "ada@acme.io", "alan@acme.io", "grace@acme.io", "katherine@acme.io", "tim@acme.io",
    ]),
    ("6f1a2b3c-0004-4d5e-8f00-a1b2c3d4e504", "UK cities", "text", [
        "London", "Manchester", "Birmingham", "Leeds", "Glasgow", "Bristol", "Newcastle",
    ]),
    ("6f1a2b3c-0005-4d5e-8f00-a1b2c3d4e505", "Countries", "text", [
        "United Kingdom", "Ireland", "France", "Germany", "Spain", "Netherlands", "Italy",
    ]),
    ("6f1a2b3c-0006-4d5e-8f00-a1b2c3d4e506", "Job titles", "text", [
        "Software Engineer", "Product Manager", "Designer", "Data Analyst", "Operations Lead",
    ]),
    ("6f1a2b3c-0007-4d5e-8f00-a1b2c3d4e507", "Departments", "text", [
        "Engineering", "Design", "Sales", "Marketing", "Finance", "Operations",
    ]),
    ("6f1a2b3c-0008-4d5e-8f00-a1b2c3d4e508", "Order statuses", "status", [
        "Pending", "Active", "Dispatched", "Delivered", "Cancelled",
    ]),
]


def _pos_keys(n: int) -> list[str]:
    # Matches positions.key_after appending from an empty list: a0, a1, a2…
    # (fewer than 62 seed rows, so single-digit keys suffice).
    base62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    return [f"a{base62[i]}" for i in range(n)]


def upgrade() -> None:
    op.create_table(
        'datasets',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('project_id', sa.UUID(), nullable=False),
        sa.Column('account_id', sa.UUID(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('kind', sa.String(length=24), nullable=False, server_default='text'),
        sa.Column('values', JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column('pos', sa.String(length=64), nullable=False),
        sa.Column('created_by', sa.UUID(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_datasets_account_project', 'datasets', ['account_id', 'project_id'], unique=False)
    op.execute("ALTER TABLE datasets ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE datasets FORCE ROW LEVEL SECURITY")
    op.execute(RLS_POLICY)

    op.create_table(
        'platform_datasets',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('kind', sa.String(length=24), nullable=False, server_default='text'),
        sa.Column('values', JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column('pos', sa.String(length=64), nullable=False),
        sa.Column('created_by', sa.UUID(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )

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
                "id": row_id,
                "name": name,
                "kind": kind,
                "values": values,
                "pos": pos,
                "created_at": now,
                "updated_at": now,
            }
            for (row_id, name, kind, values), pos in zip(DEFAULTS, _pos_keys(len(DEFAULTS)))
        ],
    )


def downgrade() -> None:
    op.drop_table('platform_datasets')
    op.drop_index('ix_datasets_account_project', table_name='datasets')
    op.drop_table('datasets')
