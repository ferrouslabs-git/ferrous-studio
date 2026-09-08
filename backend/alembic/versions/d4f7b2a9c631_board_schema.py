"""Board: releases, epics, features, requirements, sprints (phase 3)

Ported from SMA (Fnai-sma/software-management-app, origin/sma/v0) with real
differences, not a literal copy:

- Keyed on (account_id, lineage_id) rather than one board per install: SMA is
  single-board globally, Ferrous is multi-tenant, multi-project. A project
  row *is* one version (versioning deep-copies it); the board is live
  operational state that must survive across versions of the same project
  lineage, so it hangs off lineage_id, not project_id (see
  docs/go-live-and-merge-boards.md's "board per lineage" decision).
- Human ids (E3, REQ-12, ...) come from per-board counter columns on the
  `boards` row, minted under a row lock -- the same pattern this schema
  already uses for wireframes.note_seq/task_seq -- rather than SMA's global
  Postgres sequences (which only work because SMA has exactly one board) or
  its per-epic regex-MAX feature numbering (SMA store.py:810-815; SMA itself
  notes this is race-fragile against concurrent inserts under the same
  epic). Flat, per-board, one counter per entity type.
- requirements.status/priority get real CHECK constraints. SMA has none on
  either column (store.py:253-277) -- confirmed nothing enforces them
  anywhere in that codebase; not something worth reproducing.
- assignee/author/actor are real user_id FKs (Cognito-backed users already
  exist here), not SMA's free-text name fields.
- RLS ships in the phase-2 shape from day one: WITH CHECK never honours the
  platform read-bypass, only USING does (see f7a3d8e1c265).

Explicitly NOT ported (see phase-3 plan): SMA's canvas/board_revision
(whole-board snapshot-on-every-write + TRUNCATE-based restore), agents
(phase 5), users/sessions (Cognito), and the Ticket->Requirement rename
block (a one-time migration of SMA's own data, not a schema decision).

attachments does not exist in SMA (confirmed: it's an unchecked TODO there)
-- designed fresh here, reusing app/studio/storage.py's S3 presigned-URL
helpers and app/studio/documents.py's pending/uploaded confirmation pattern
against the same DOCUMENTS_BUCKET.

Revision ID: d4f7b2a9c631
Revises: a1c9e4f7b382
Create Date: 2026-09-08
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'd4f7b2a9c631'
down_revision: Union[str, None] = 'a1c9e4f7b382'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

JSONB = postgresql.JSONB(astext_type=sa.Text())

# Every board table's RLS policy: read admits the platform bypass, write
# never does (see f7a3d8e1c265's rationale -- shipped correctly from the
# start here rather than retrofitted).
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

# (table, extra columns beyond id/board_id/account_id/created_at/updated_at,
#  extra table args) is more noise than help here -- each table is
# distinct enough to spell out in full below instead.


def _apply_rls(table: str) -> None:
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(RLS_POLICY.format(table=table))


def upgrade() -> None:
    op.create_table(
        'boards',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('account_id', sa.UUID(), nullable=False),
        sa.Column('lineage_id', sa.UUID(), nullable=False),
        sa.Column('release_seq', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('epic_seq', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('feature_seq', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('requirement_seq', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('sprint_seq', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('doc_seq', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['account_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('account_id', 'lineage_id', name='uq_boards_account_lineage'),
    )
    _apply_rls('boards')

    op.create_table(
        'board_releases',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('board_id', sa.UUID(), nullable=False),
        sa.Column('account_id', sa.UUID(), nullable=False),
        sa.Column('seq', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('release_date', sa.Date(), nullable=True),
        sa.Column('description', sa.Text(), nullable=False, server_default=''),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['board_id'], ['boards.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('board_id', 'seq', name='uq_board_releases_seq'),
    )
    _apply_rls('board_releases')

    op.create_table(
        'board_epics',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('board_id', sa.UUID(), nullable=False),
        sa.Column('account_id', sa.UUID(), nullable=False),
        sa.Column('seq', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('summary', sa.Text(), nullable=False, server_default=''),
        sa.Column('phase', sa.String(length=10), nullable=False, server_default='Later'),
        sa.Column('release_id', sa.UUID(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.CheckConstraint("phase IN ('Now','Next','Later')", name='ck_board_epics_phase'),
        sa.ForeignKeyConstraint(['board_id'], ['boards.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['release_id'], ['board_releases.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('board_id', 'seq', name='uq_board_epics_seq'),
    )
    op.create_index('ix_board_epics_release', 'board_epics', ['release_id'])
    _apply_rls('board_epics')

    op.create_table(
        'board_features',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('board_id', sa.UUID(), nullable=False),
        sa.Column('account_id', sa.UUID(), nullable=False),
        sa.Column('epic_id', sa.UUID(), nullable=False),
        sa.Column('seq', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['board_id'], ['boards.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['epic_id'], ['board_epics.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('board_id', 'seq', name='uq_board_features_seq'),
    )
    op.create_index('ix_board_features_epic', 'board_features', ['epic_id'])
    _apply_rls('board_features')

    op.create_table(
        'board_sprints',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('board_id', sa.UUID(), nullable=False),
        sa.Column('account_id', sa.UUID(), nullable=False),
        sa.Column('seq', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('goal', sa.Text(), nullable=False, server_default=''),
        sa.Column('start_date', sa.Date(), nullable=True),
        sa.Column('end_date', sa.Date(), nullable=True),
        sa.Column('state', sa.String(length=10), nullable=False, server_default='planned'),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.CheckConstraint("state IN ('planned','active','done')", name='ck_board_sprints_state'),
        sa.ForeignKeyConstraint(['board_id'], ['boards.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('board_id', 'seq', name='uq_board_sprints_seq'),
    )
    _apply_rls('board_sprints')

    op.create_table(
        'board_requirements',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('board_id', sa.UUID(), nullable=False),
        sa.Column('account_id', sa.UUID(), nullable=False),
        sa.Column('seq', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('body', sa.Text(), nullable=False, server_default=''),
        sa.Column('epic_id', sa.UUID(), nullable=True),
        sa.Column('feature_id', sa.UUID(), nullable=True),
        sa.Column('status', sa.String(length=10), nullable=False, server_default='Todo'),
        sa.Column('priority', sa.String(length=10), nullable=False, server_default='Medium'),
        sa.Column('assignee_id', sa.UUID(), nullable=True),
        sa.Column('release_id', sa.UUID(), nullable=True),
        sa.Column('sprint_id', sa.UUID(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.CheckConstraint("status IN ('Todo','Doing','Done')", name='ck_board_requirements_status'),
        sa.CheckConstraint("priority IN ('Low','Medium','High','Urgent')", name='ck_board_requirements_priority'),
        sa.ForeignKeyConstraint(['board_id'], ['boards.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['epic_id'], ['board_epics.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['feature_id'], ['board_features.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['assignee_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['release_id'], ['board_releases.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['sprint_id'], ['board_sprints.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('board_id', 'seq', name='uq_board_requirements_seq'),
    )
    op.create_index('ix_board_requirements_epic', 'board_requirements', ['epic_id'])
    op.create_index('ix_board_requirements_feature', 'board_requirements', ['feature_id'])
    op.create_index('ix_board_requirements_sprint', 'board_requirements', ['sprint_id'])
    op.create_index('ix_board_requirements_release', 'board_requirements', ['release_id'])
    op.create_index('ix_board_requirements_status', 'board_requirements', ['status'])
    _apply_rls('board_requirements')

    # One row per sprint-membership change; powers burndown by reconstructing
    # "was this requirement in this sprint as of day N" (see service.py).
    # Written on create (initial sprint, even NULL/backlog) and on update only
    # when sprint_id actually changes -- not on every PATCH (ported invariant,
    # SMA store.py:878-881, 894-900: a naive "log on transition to non-null"
    # port would silently break the "born in the backlog" case burndown
    # depends on for total_start).
    op.create_table(
        'board_requirement_sprint_history',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('board_id', sa.UUID(), nullable=False),
        sa.Column('account_id', sa.UUID(), nullable=False),
        sa.Column('requirement_id', sa.UUID(), nullable=False),
        sa.Column('sprint_id', sa.UUID(), nullable=True),
        sa.Column('started_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['board_id'], ['boards.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['requirement_id'], ['board_requirements.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['sprint_id'], ['board_sprints.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_board_rsh_requirement', 'board_requirement_sprint_history', ['requirement_id', 'started_at'])
    op.create_index('ix_board_rsh_sprint', 'board_requirement_sprint_history', ['sprint_id', 'started_at'])
    _apply_rls('board_requirement_sprint_history')

    op.create_table(
        'board_docs',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('board_id', sa.UUID(), nullable=False),
        sa.Column('account_id', sa.UUID(), nullable=False),
        sa.Column('seq', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('body', sa.Text(), nullable=False, server_default=''),
        sa.Column('tags', postgresql.ARRAY(sa.String()), nullable=False, server_default='{}'),
        sa.Column('created_by', sa.UUID(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['board_id'], ['boards.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('board_id', 'seq', name='uq_board_docs_seq'),
    )
    _apply_rls('board_docs')

    # entity_id is deliberately not FK'd -- it points at whichever of the
    # tables above `entity_type` names. Validity is an application-level
    # existence check (a UNION ALL probe, see service.py), matching SMA's own
    # comments.entity_id (store.py:288-294, 583-595): a real polymorphic FK
    # would need a constraint trigger, and SMA never needed one.
    op.create_table(
        'board_comments',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('board_id', sa.UUID(), nullable=False),
        sa.Column('account_id', sa.UUID(), nullable=False),
        sa.Column('entity_type', sa.String(length=20), nullable=False),
        sa.Column('entity_id', sa.UUID(), nullable=False),
        sa.Column('author_id', sa.UUID(), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "entity_type IN ('release','epic','feature','requirement','sprint','doc')",
            name='ck_board_comments_entity_type',
        ),
        sa.ForeignKeyConstraint(['board_id'], ['boards.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['author_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_board_comments_entity', 'board_comments', ['entity_type', 'entity_id'])
    _apply_rls('board_comments')

    op.create_table(
        'board_events',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('board_id', sa.UUID(), nullable=False),
        sa.Column('account_id', sa.UUID(), nullable=False),
        sa.Column('actor_id', sa.UUID(), nullable=True),
        sa.Column('action', sa.String(length=64), nullable=False),
        sa.Column('entity_type', sa.String(length=20), nullable=False),
        sa.Column('entity_id', sa.UUID(), nullable=False),
        sa.Column('detail', JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['board_id'], ['boards.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['actor_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_board_events_entity', 'board_events', ['entity_type', 'entity_id'])
    op.create_index('ix_board_events_board_created', 'board_events', ['board_id', 'created_at'])
    _apply_rls('board_events')

    # Does not exist in SMA (confirmed: an unchecked TODO there, no table, no
    # endpoint, no JS) -- designed fresh, reusing the documents bucket
    # (app/studio/storage.py) and the pending/uploaded confirmation pattern
    # app/studio/documents.py already uses for project_documents.
    op.create_table(
        'board_attachments',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('board_id', sa.UUID(), nullable=False),
        sa.Column('account_id', sa.UUID(), nullable=False),
        sa.Column('entity_type', sa.String(length=20), nullable=False),
        sa.Column('entity_id', sa.UUID(), nullable=False),
        sa.Column('filename', sa.String(length=255), nullable=False),
        sa.Column('content_type', sa.String(length=128), nullable=False),
        sa.Column('size_bytes', sa.BigInteger(), nullable=False),
        sa.Column('s3_key', sa.String(length=512), nullable=False),
        sa.Column('status', sa.String(length=10), nullable=False, server_default='pending'),
        sa.Column('created_by', sa.UUID(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.CheckConstraint("entity_type IN ('release','epic','feature','requirement','doc')", name='ck_board_attachments_entity_type'),
        sa.CheckConstraint("status IN ('pending','uploaded')", name='ck_board_attachments_status'),
        sa.ForeignKeyConstraint(['board_id'], ['boards.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('s3_key', name='uq_board_attachments_s3_key'),
    )
    op.create_index('ix_board_attachments_entity', 'board_attachments', ['entity_type', 'entity_id'])
    _apply_rls('board_attachments')


def downgrade() -> None:
    op.drop_table('board_attachments')
    op.drop_table('board_events')
    op.drop_table('board_comments')
    op.drop_table('board_docs')
    op.drop_table('board_requirement_sprint_history')
    op.drop_table('board_requirements')
    op.drop_table('board_sprints')
    op.drop_table('board_features')
    op.drop_table('board_epics')
    op.drop_table('board_releases')
    op.drop_table('boards')
