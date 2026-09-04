"""wireframe annotations and audit log

Developer annotations (notes and tasks) pinned to wireframe nodes, and the
audit log recording annotation events and wireframe changes. ``page_id`` on
both tables is a soft reference with no foreign key: snapshot restore deletes
and re-inserts page rows with the same ids, and a CASCADE would silently
destroy every annotation on each restore; audit rows must additionally
survive genuine page deletion. The ``note_seq``/``task_seq`` counters on
``wireframes`` mint the human-facing numbers (N-3 / T-7) so they are unique
per wireframe and never reused, even after deleting the newest annotation.

Revision ID: c5f8a2d4e761
Revises: e1c4a7f2b930
Create Date: 2026-09-03
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'c5f8a2d4e761'
down_revision: Union[str, None] = 'e1c4a7f2b930'
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


def _apply_rls(table: str) -> None:
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(RLS_POLICY.format(table=table))


def upgrade() -> None:
    op.create_table(
        "wireframe_annotations",
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('project_id', sa.UUID(), nullable=False),
        sa.Column('wireframe_id', sa.UUID(), nullable=False),
        sa.Column('account_id', sa.UUID(), nullable=False),
        sa.Column('page_id', sa.UUID(), nullable=False),
        sa.Column('kind', sa.String(length=10), nullable=False),
        sa.Column('seq', sa.Integer(), nullable=False),
        sa.Column('target_kind', sa.String(length=10), nullable=False),
        sa.Column('target_id', sa.String(length=64), nullable=False),
        sa.Column('target_cmp_id', sa.String(length=64), nullable=True),
        sa.Column('target_label', sa.String(length=255), nullable=False, server_default=""),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('resolved_at', sa.DateTime(), nullable=True),
        sa.Column('resolved_by', sa.UUID(), nullable=True),
        sa.Column('created_by', sa.UUID(), nullable=True),
        sa.Column('updated_by', sa.UUID(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['wireframe_id'], ['wireframes.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['resolved_by'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['updated_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('wireframe_id', 'kind', 'seq', name='uq_wireframe_annotations_seq'),
    )
    op.create_index(
        'ix_wireframe_annotations_account_wireframe',
        "wireframe_annotations",
        ['account_id', 'wireframe_id'],
        unique=False,
    )
    _apply_rls("wireframe_annotations")

    op.create_table(
        "wireframe_audit_log",
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('project_id', sa.UUID(), nullable=False),
        sa.Column('wireframe_id', sa.UUID(), nullable=False),
        sa.Column('account_id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=True),
        sa.Column('user_name', sa.String(length=255), nullable=True),
        sa.Column('user_email', sa.String(length=255), nullable=True),
        sa.Column('event', sa.String(length=40), nullable=False),
        sa.Column('page_id', sa.UUID(), nullable=True),
        sa.Column('detail', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['wireframe_id'], ['wireframes.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_wireframe_audit_log_account_wireframe',
        "wireframe_audit_log",
        ['account_id', 'wireframe_id', 'created_at'],
        unique=False,
    )
    _apply_rls("wireframe_audit_log")

    op.add_column("wireframes", sa.Column('note_seq', sa.Integer(), nullable=False, server_default="0"))
    op.add_column("wireframes", sa.Column('task_seq', sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("wireframes", 'task_seq')
    op.drop_column("wireframes", 'note_seq')
    op.drop_index('ix_wireframe_audit_log_account_wireframe', table_name="wireframe_audit_log")
    op.drop_table("wireframe_audit_log")
    op.drop_index('ix_wireframe_annotations_account_wireframe', table_name="wireframe_annotations")
    op.drop_table("wireframe_annotations")
