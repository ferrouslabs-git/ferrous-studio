"""drop the requirements catalogue

Requirements will be sourced from elsewhere, so the Epic › Feature ›
Requirement tables (and the Claude extraction sessions that fed them) go.
Both were created in ``b7e2c4d9a1f3``; the downgrade recreates them as they
were there so the chain stays reversible, but any rows are gone for good.

Revision ID: f4d2a8c6e017
Revises: e5a1c7b3d902
Create Date: 2026-08-27
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'f4d2a8c6e017'
down_revision: Union[str, None] = 'e5a1c7b3d902'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

RLS_POLICY = """
CREATE POLICY {table}_scope ON {table}
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


def upgrade() -> None:
    # Items reference extractions (source_extraction_id), so items go first.
    op.drop_index('ix_requirement_items_parent', table_name='requirement_items')
    op.drop_index('ix_requirement_items_account_project_kind', table_name='requirement_items')
    op.drop_table('requirement_items')
    op.drop_index('ix_requirement_extractions_account_project', table_name='requirement_extractions')
    op.drop_table('requirement_extractions')


def downgrade() -> None:
    op.create_table('requirement_extractions',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=False),
    sa.Column('account_id', sa.UUID(), nullable=False),
    sa.Column('source', sa.String(length=12), nullable=False),
    sa.Column('document_id', sa.UUID(), nullable=True),
    sa.Column('transcript_text', sa.Text(), nullable=False),
    sa.Column('transcript_tokens', sa.Integer(), nullable=True),
    sa.Column('status', sa.String(length=12), nullable=False),
    sa.Column('messages', JSONB, nullable=False),
    sa.Column('proposal', JSONB, nullable=True),
    sa.Column('revision', sa.Integer(), nullable=False),
    sa.Column('catalogue_snapshot', JSONB, nullable=False),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('created_by', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['document_id'], ['project_documents.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_requirement_extractions_account_project', 'requirement_extractions', ['account_id', 'project_id', 'created_at'], unique=False)

    op.create_table('requirement_items',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=False),
    sa.Column('account_id', sa.UUID(), nullable=False),
    sa.Column('kind', sa.String(length=12), nullable=False),
    sa.Column('parent_id', sa.UUID(), nullable=True),
    sa.Column('ref', sa.String(length=16), nullable=False),
    sa.Column('ref_num', sa.Integer(), nullable=False),
    sa.Column('pos', sa.String(length=64), nullable=False),
    sa.Column('title', sa.String(length=255), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('priority', sa.String(length=8), nullable=True),
    sa.Column('status', sa.String(length=12), nullable=False),
    sa.Column('acceptance_criteria', JSONB, nullable=False),
    sa.Column('source_extraction_id', sa.UUID(), nullable=True),
    sa.Column('created_by', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.CheckConstraint("kind IN ('epic', 'feature', 'requirement')", name='ck_requirement_items_kind'),
    sa.CheckConstraint("priority IS NULL OR priority IN ('must', 'should', 'could', 'wont')", name='ck_requirement_items_priority'),
    sa.CheckConstraint("status IN ('draft', 'approved')", name='ck_requirement_items_status'),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['parent_id'], ['requirement_items.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['source_extraction_id'], ['requirement_extractions.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('project_id', 'ref', name='uq_requirement_items_ref')
    )
    op.create_index('ix_requirement_items_account_project_kind', 'requirement_items', ['account_id', 'project_id', 'kind'], unique=False)
    op.create_index('ix_requirement_items_parent', 'requirement_items', ['parent_id'], unique=False)

    for table in ("requirement_extractions", "requirement_items"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(RLS_POLICY.format(table=table))
