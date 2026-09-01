"""project sections: wireframes own pages; personas, requirements, diagrams, documents

Destructive by design (agreed with the product owner): the four studio tables
are dropped and recreated so that pages, versions and op batches hang off a
*wireframe* rather than directly off the project. Existing projects and their
pages are discarded rather than backfilled.

Every table created here -- including the ``wireframe_personas`` join table --
carries ``account_id`` and gets the same row-level-security policy. The
policy list is driven from one tuple (``STUDIO_TABLES``) so a table cannot be
created without it: a policed table that is missing its policy under FORCE
RLS reads as *empty*, never as an error.

Revision ID: b7e2c4d9a1f3
Revises: 9d4e1a7c5b02
Create Date: 2026-08-26
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'b7e2c4d9a1f3'
down_revision: Union[str, None] = '9d4e1a7c5b02'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

OLD_STUDIO_TABLES = ("projects", "project_pages", "project_versions", "project_op_batches")

# Creation order (dependencies first). The RLS loop and the downgrade both
# iterate this, so adding a table here is the whole checklist.
STUDIO_TABLES = (
    "projects",
    "personas",
    "wireframes",
    "wireframe_personas",
    "project_pages",
    "project_versions",
    "project_op_batches",
    "project_documents",
    "requirement_extractions",
    "requirement_items",
    "project_diagrams",
)

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


def _apply_rls(tables: Sequence[str]) -> None:
    for table in tables:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(RLS_POLICY.format(table=table))


def upgrade() -> None:
    for table in reversed(OLD_STUDIO_TABLES):
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE")

    op.create_table('projects',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('account_id', sa.UUID(), nullable=False),
    sa.Column('created_by', sa.UUID(), nullable=True),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('rationale', sa.Text(), nullable=True),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('custom_components', JSONB, nullable=False),
    sa.Column('schema_version', sa.String(length=10), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['account_id'], ['tenants.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_projects_account_status', 'projects', ['account_id', 'status'], unique=False)

    op.create_table('personas',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=False),
    sa.Column('account_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('role', sa.String(length=255), nullable=True),
    sa.Column('primary_interface', sa.String(length=64), nullable=True),
    sa.Column('traits', JSONB, nullable=False),
    sa.Column('jobs_to_be_done', JSONB, nullable=False),
    sa.Column('pain_points', JSONB, nullable=False),
    sa.Column('feelings', JSONB, nullable=False),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('pos', sa.String(length=64), nullable=False),
    sa.Column('created_by', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_personas_account_project', 'personas', ['account_id', 'project_id'], unique=False)

    op.create_table('wireframes',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=False),
    sa.Column('account_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('interface_type', sa.String(length=16), nullable=False),
    sa.Column('pos', sa.String(length=64), nullable=False),
    sa.Column('created_by', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.CheckConstraint("interface_type IN ('desktop', 'tablet', 'mobile')", name='ck_wireframes_interface_type'),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_wireframes_account_project', 'wireframes', ['account_id', 'project_id'], unique=False)

    op.create_table('wireframe_personas',
    sa.Column('wireframe_id', sa.UUID(), nullable=False),
    sa.Column('persona_id', sa.UUID(), nullable=False),
    sa.Column('account_id', sa.UUID(), nullable=False),
    sa.ForeignKeyConstraint(['persona_id'], ['personas.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['wireframe_id'], ['wireframes.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('wireframe_id', 'persona_id')
    )
    op.create_index('ix_wireframe_personas_account_persona', 'wireframe_personas', ['account_id', 'persona_id'], unique=False)

    op.create_table('project_pages',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=False),
    sa.Column('wireframe_id', sa.UUID(), nullable=False),
    sa.Column('account_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('route', sa.String(length=255), nullable=True),
    sa.Column('pos', sa.String(length=64), nullable=False),
    sa.Column('document', JSONB, nullable=False),
    sa.Column('entity_versions', JSONB, nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['wireframe_id'], ['wireframes.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_project_pages_account_wireframe', 'project_pages', ['account_id', 'wireframe_id'], unique=False)
    # The hot row: every committed canvas action rewrites one page's document.
    op.execute("ALTER TABLE project_pages ALTER COLUMN document SET COMPRESSION lz4")
    op.execute(
        "ALTER TABLE project_pages SET (autovacuum_vacuum_scale_factor = 0.02, "
        "autovacuum_analyze_scale_factor = 0.02)"
    )

    op.create_table('project_versions',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=False),
    sa.Column('wireframe_id', sa.UUID(), nullable=False),
    sa.Column('account_id', sa.UUID(), nullable=False),
    sa.Column('snapshot', JSONB, nullable=False),
    sa.Column('label', sa.String(length=255), nullable=True),
    sa.Column('reason', sa.String(length=40), nullable=False),
    sa.Column('created_by', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['wireframe_id'], ['wireframes.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_project_versions_account_wireframe', 'project_versions', ['account_id', 'wireframe_id', 'created_at'], unique=False)
    op.execute("ALTER TABLE project_versions ALTER COLUMN snapshot SET COMPRESSION lz4")

    op.create_table('project_op_batches',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=False),
    sa.Column('wireframe_id', sa.UUID(), nullable=False),
    sa.Column('account_id', sa.UUID(), nullable=False),
    sa.Column('client_batch_id', sa.String(length=64), nullable=False),
    sa.Column('request_hash', sa.String(length=64), nullable=False),
    sa.Column('status_code', sa.Integer(), nullable=False),
    sa.Column('response', JSONB, nullable=False),
    sa.Column('applied_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['wireframe_id'], ['wireframes.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('project_id', 'client_batch_id', name='uq_project_op_batches_client')
    )
    op.create_index('ix_project_op_batches_account_applied', 'project_op_batches', ['account_id', 'applied_at'], unique=False)

    op.create_table('project_documents',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=False),
    sa.Column('account_id', sa.UUID(), nullable=False),
    sa.Column('filename', sa.String(length=255), nullable=False),
    sa.Column('content_type', sa.String(length=127), nullable=False),
    sa.Column('size_bytes', sa.BigInteger(), nullable=False),
    sa.Column('s3_key', sa.String(length=512), nullable=False),
    sa.Column('status', sa.String(length=12), nullable=False),
    sa.Column('uploaded_by', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('confirmed_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['uploaded_by'], ['users.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('s3_key', name='uq_project_documents_s3_key')
    )
    op.create_index('ix_project_documents_account_project', 'project_documents', ['account_id', 'project_id', 'created_at'], unique=False)

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
    for column in ("transcript_text", "messages", "proposal"):
        op.execute(f"ALTER TABLE requirement_extractions ALTER COLUMN {column} SET COMPRESSION lz4")

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

    op.create_table('project_diagrams',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=False),
    sa.Column('account_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('kind', sa.String(length=24), nullable=False),
    sa.Column('xml', sa.Text(), nullable=False),
    sa.Column('model', JSONB, nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('created_by', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_project_diagrams_account_project', 'project_diagrams', ['account_id', 'project_id'], unique=False)
    # Rewritten whole on every autosave, like a page document.
    op.execute("ALTER TABLE project_diagrams ALTER COLUMN xml SET COMPRESSION lz4")
    op.execute(
        "ALTER TABLE project_diagrams SET (autovacuum_vacuum_scale_factor = 0.02, "
        "autovacuum_analyze_scale_factor = 0.02)"
    )

    _apply_rls(STUDIO_TABLES)


def downgrade() -> None:
    """Recreates the 9d4e1a7c5b02 shape, not the data: the upgrade discarded it."""
    for table in reversed(STUDIO_TABLES):
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE")

    op.create_table('projects',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('account_id', sa.UUID(), nullable=False),
    sa.Column('created_by', sa.UUID(), nullable=True),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('custom_components', JSONB, nullable=False),
    sa.Column('schema_version', sa.String(length=10), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['account_id'], ['tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_projects_account_status', 'projects', ['account_id', 'status'], unique=False)

    op.create_table('project_pages',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=False),
    sa.Column('account_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('route', sa.String(length=255), nullable=True),
    sa.Column('pos', sa.String(length=64), nullable=False),
    sa.Column('document', JSONB, nullable=False),
    sa.Column('entity_versions', JSONB, nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_project_pages_account_project', 'project_pages', ['account_id', 'project_id'], unique=False)
    op.execute("ALTER TABLE project_pages ALTER COLUMN document SET COMPRESSION lz4")

    op.create_table('project_versions',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=False),
    sa.Column('account_id', sa.UUID(), nullable=False),
    sa.Column('snapshot', JSONB, nullable=False),
    sa.Column('label', sa.String(length=255), nullable=True),
    sa.Column('reason', sa.String(length=40), nullable=False),
    sa.Column('created_by', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_project_versions_account_project', 'project_versions', ['account_id', 'project_id', 'created_at'], unique=False)

    op.create_table('project_op_batches',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=False),
    sa.Column('account_id', sa.UUID(), nullable=False),
    sa.Column('client_batch_id', sa.String(length=64), nullable=False),
    sa.Column('request_hash', sa.String(length=64), nullable=False),
    sa.Column('status_code', sa.Integer(), nullable=False),
    sa.Column('response', JSONB, nullable=False),
    sa.Column('applied_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('project_id', 'client_batch_id', name='uq_project_op_batches_client')
    )
    op.create_index('ix_project_op_batches_account_applied', 'project_op_batches', ['account_id', 'applied_at'], unique=False)

    _apply_rls(OLD_STUDIO_TABLES)
