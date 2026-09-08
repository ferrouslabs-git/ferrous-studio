"""Board feedback: deployed environments and the reports raised against them

Two tables, both hanging off `boards` -- i.e. off the project *lineage*, not
off a `projects` row -- for the reason the board itself does (see
d4f7b2a9c631): a project row is one design version and versioning deep-copies
it, whereas a deployed environment is one address for the whole product and a
report about UAT is not a fact about any one version of the design. Copying
either per version would hand v1 and v2 different UAT links and leave a locked
version unable to correct a wrong one.

board_environments holds only the environments that have actually been given a
URL: absent row means "not set up yet", never a row holding ''. The three
slugs are fixed by a CHECK rather than user-defined, because a report has to
name the environment it was seen in and a free-form list would make one
organisation's reports incomparable with its own six months later.

board_feedback carries `raised_by_name`/`raised_by_email` alongside the
`raised_by` FK, snapshotting the reporter at write time exactly as
wireframe_audit_log does, so a report still says who filed it after that
person's user row is deleted (the FK is ON DELETE SET NULL).

RLS in the same shape as every other board table: read admits the platform
bypass, write never does (f7a3d8e1c265).

Revision ID: c1e7f3a9b264
Revises: b8e2c5f174ad
Create Date: 2026-09-08
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'c1e7f3a9b264'
down_revision: Union[str, None] = 'b8e2c5f174ad'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

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
    # One more human-id counter on the board row, minted under the same row
    # lock as the rest (service.py's _next_seq).
    op.add_column('boards', sa.Column('feedback_seq', sa.Integer(), nullable=False, server_default='0'))

    op.create_table(
        'board_environments',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('board_id', sa.UUID(), nullable=False),
        sa.Column('account_id', sa.UUID(), nullable=False),
        sa.Column('slug', sa.String(length=16), nullable=False),
        sa.Column('url', sa.String(length=1024), nullable=False),
        sa.Column('updated_by', sa.UUID(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.CheckConstraint("slug IN ('uat','staging','production')", name='ck_board_environments_slug'),
        sa.CheckConstraint("url <> ''", name='ck_board_environments_url_present'),
        sa.ForeignKeyConstraint(['board_id'], ['boards.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['updated_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('board_id', 'slug', name='uq_board_environments_slug'),
    )
    _apply_rls('board_environments')

    op.create_table(
        'board_feedback',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('board_id', sa.UUID(), nullable=False),
        sa.Column('account_id', sa.UUID(), nullable=False),
        sa.Column('seq', sa.Integer(), nullable=False),
        sa.Column('environment', sa.String(length=16), nullable=False),
        sa.Column('kind', sa.String(length=16), nullable=False, server_default='feedback'),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('detail', sa.Text(), nullable=False, server_default=''),
        sa.Column('status', sa.String(length=10), nullable=False, server_default='New'),
        sa.Column('raised_by', sa.UUID(), nullable=True),
        # Snapshotted at write time so the trail survives user deletion.
        sa.Column('raised_by_name', sa.String(length=255), nullable=True),
        sa.Column('raised_by_email', sa.String(length=255), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        # The environment is a slug, not an FK to board_environments: a report
        # outlives the link it was raised against, and clearing a wrong URL
        # must not take the reports with it.
        sa.CheckConstraint("environment IN ('uat','staging','production')", name='ck_board_feedback_environment'),
        sa.CheckConstraint("kind IN ('feedback','bug','requirement')", name='ck_board_feedback_kind'),
        sa.CheckConstraint(
            "status IN ('New','Triaged','Accepted','Declined','Done')", name='ck_board_feedback_status'
        ),
        sa.ForeignKeyConstraint(['board_id'], ['boards.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['raised_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('board_id', 'seq', name='uq_board_feedback_seq'),
    )
    op.create_index('ix_board_feedback_environment', 'board_feedback', ['board_id', 'environment'])
    op.create_index('ix_board_feedback_status', 'board_feedback', ['board_id', 'status'])
    _apply_rls('board_feedback')


def downgrade() -> None:
    op.drop_index('ix_board_feedback_status', table_name='board_feedback')
    op.drop_index('ix_board_feedback_environment', table_name='board_feedback')
    op.drop_table('board_feedback')
    op.drop_table('board_environments')
    op.drop_column('boards', 'feedback_seq')
