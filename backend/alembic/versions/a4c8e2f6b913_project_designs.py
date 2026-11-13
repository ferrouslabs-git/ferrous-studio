"""High-fidelity designs: the brief Studio authors and the revisions it mirrors

See docs/high-fidelity-design.md. Two tables:

- ``project_designs``: one row per design. Studio authors only the brief
  (wireframe, name, text, reference images); the prototype lives in a Figma
  Make file and ``figma_url`` points at it. ``wireframe_id`` and
  ``current_revision_id`` are soft references with no foreign key, so deleting
  a wireframe cannot cascade into a design and its history.
- ``design_revisions``: one row per synced build -- a single HTML file in the
  documents bucket, plus the source archive it was built from. Append-only.

``project_documents.purpose`` gains the value ``design_reference`` for the
brief's reference images. It is an unconstrained String(20), so that needs no
schema change here.

Both tables take the scope policy as it stands after f7a3d8e1c265 (a platform
admin's bypass reads but does not write), the way b8e2c5f174ad's tables do.
That migration's SCOPED_TABLES tuple is a record of what existed then and is
deliberately left alone.

Revision ID: a4c8e2f6b913
Revises: f1b6d8a2c597
Create Date: 2026-11-13
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'a4c8e2f6b913'
down_revision: Union[str, None] = 'f1b6d8a2c597'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

#: The tables this migration puts under the organisation scope policy.
SCOPED_TABLES = ("project_designs", "design_revisions")

RLS_POLICY = """
CREATE POLICY {table}_scope ON {table}
    USING (
        current_setting('app.is_super_admin', true) = 'true'
        OR account_id::text = current_setting('app.current_scope_id', true)
    )
    WITH CHECK (
        account_id::text = current_setting('app.current_scope_id', true)
    )
"""


def _apply_rls(table: str) -> None:
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(RLS_POLICY.format(table=table))


def upgrade() -> None:
    op.create_table(
        'project_designs',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('project_id', sa.UUID(), nullable=False),
        sa.Column('account_id', sa.UUID(), nullable=False),
        sa.Column('wireframe_id', sa.UUID(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('brief', sa.Text(), nullable=False, server_default=''),
        sa.Column(
            'reference_document_ids',
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column('figma_url', sa.String(length=2048), nullable=True),
        sa.Column('published_url', sa.String(length=2048), nullable=True),
        sa.Column('current_revision_id', sa.UUID(), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='active'),
        sa.Column('pos', sa.String(length=64), nullable=False),
        sa.Column('synced_at', sa.DateTime(), nullable=True),
        sa.Column('created_by', sa.UUID(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.CheckConstraint("status IN ('active','archived')", name='ck_project_designs_status'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_project_designs_account_project', 'project_designs', ['account_id', 'project_id'])

    op.create_table(
        'design_revisions',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('design_id', sa.UUID(), nullable=False),
        sa.Column('project_id', sa.UUID(), nullable=False),
        sa.Column('account_id', sa.UUID(), nullable=False),
        sa.Column('revision_no', sa.Integer(), nullable=False),
        sa.Column('html_key', sa.String(length=512), nullable=False),
        sa.Column('source_key', sa.String(length=512), nullable=True),
        sa.Column('html_bytes', sa.BigInteger(), nullable=False),
        sa.Column('source_bytes', sa.BigInteger(), nullable=True),
        sa.Column('source_hash', sa.String(length=64), nullable=False),
        sa.Column('origin', sa.String(length=20), nullable=False),
        sa.Column('summary', sa.Text(), nullable=True),
        sa.Column('status', sa.String(length=12), nullable=False, server_default='pending'),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.CheckConstraint("origin IN ('figma_make','claude_code')", name='ck_design_revisions_origin'),
        sa.CheckConstraint("status IN ('pending','uploaded')", name='ck_design_revisions_status'),
        sa.ForeignKeyConstraint(['design_id'], ['project_designs.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('design_id', 'revision_no', name='uq_design_revisions_design_no'),
        sa.UniqueConstraint('html_key', name='uq_design_revisions_html_key'),
        sa.UniqueConstraint('source_key', name='uq_design_revisions_source_key'),
    )
    op.create_index(
        'ix_design_revisions_account_design', 'design_revisions', ['account_id', 'design_id', 'revision_no']
    )
    op.create_index('ix_design_revisions_account_project', 'design_revisions', ['account_id', 'project_id'])

    for table in SCOPED_TABLES:
        _apply_rls(table)


def downgrade() -> None:
    op.drop_table('design_revisions')
    op.drop_table('project_designs')
