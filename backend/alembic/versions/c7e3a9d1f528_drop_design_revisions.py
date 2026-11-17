"""High-fidelity designs: drop built revisions; the page frames the published Make site

The design page now frames the site published from the Make file
(``project_designs.published_url``), so Studio no longer keeps built copies.
This drops ``design_revisions`` and the two columns that pointed into it
(``current_revision_id``, ``synced_at``).

The revisions' HTML and source archives stay in the documents bucket under
``<account>/<project>/designs/<design>/<revision>/``; a migration cannot reach
S3. Delete that prefix by hand if the space matters.

The downgrade puts the table and columns back empty: the rows are gone.

Revision ID: c7e3a9d1f528
Revises: b5d1f7e3a926
Create Date: 2026-11-16
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'c7e3a9d1f528'
down_revision: Union[str, None] = 'b5d1f7e3a926'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

RLS_POLICY = """
CREATE POLICY design_revisions_scope ON design_revisions
    USING (
        current_setting('app.is_super_admin', true) = 'true'
        OR account_id::text = current_setting('app.current_scope_id', true)
    )
    WITH CHECK (
        account_id::text = current_setting('app.current_scope_id', true)
    )
"""


def upgrade() -> None:
    op.drop_table('design_revisions')
    op.drop_column('project_designs', 'current_revision_id')
    op.drop_column('project_designs', 'synced_at')


def downgrade() -> None:
    op.add_column('project_designs', sa.Column('synced_at', sa.DateTime(), nullable=True))
    op.add_column('project_designs', sa.Column('current_revision_id', sa.UUID(), nullable=True))
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
    op.execute("ALTER TABLE design_revisions ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE design_revisions FORCE ROW LEVEL SECURITY")
    op.execute(RLS_POLICY)
