"""Usability studies: studies, their files, participants, task results and observations.

A study is one round of usability testing for a project. It hangs off the
project's lineage (account_id, lineage_id), like the board, because a project
row is one frozen design version and a round of testing is live state that
must outlast it. So none of these tables has a project_id, and versioning
neither copies nor skips them.

Every table is organisation-scoped with the usual forced row-level-security
policy. The participant page has no session; it finds its row by token with a
cross-account read and then adopts that row's organisation (see
app/studio/usability/routes.py, _session).

Additive and new: nothing existing changes.

Revision ID: c3e8a5f1d620
Revises: b5e1c7a9d204
Create Date: 2026-11-24
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "c3e8a5f1d620"
down_revision = "b5e1c7a9d204"
branch_labels = None
depends_on = None

TABLES = (
    "usability_studies",
    "usability_study_files",
    "usability_participants",
    "usability_task_results",
    "usability_observations",
)

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


def upgrade() -> None:
    op.create_table(
        "usability_studies",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("account_id", sa.UUID(), nullable=False),
        sa.Column("lineage_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("persona", sa.String(length=255), nullable=True),
        sa.Column("duration", sa.String(length=64), nullable=True),
        sa.Column("app_url", sa.String(length=500), nullable=True),
        sa.Column("content", postgresql.JSONB(), nullable=False),
        sa.Column("consent_version", sa.Integer(), nullable=False),
        sa.Column("participant_seq", sa.Integer(), nullable=False),
        sa.Column("created_by", sa.UUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("status IN ('open', 'closed')", name="ck_usability_studies_status"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_usability_studies_account_lineage", "usability_studies", ["account_id", "lineage_id"])

    op.create_table(
        "usability_study_files",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("account_id", sa.UUID(), nullable=False),
        sa.Column("study_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=120), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["study_id"], ["usability_studies.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("study_id", "name", name="uq_usability_study_files_name"),
    )
    op.create_index("ix_usability_study_files_account_study", "usability_study_files", ["account_id", "study_id"])

    op.create_table(
        "usability_participants",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("account_id", sa.UUID(), nullable=False),
        sa.Column("study_id", sa.UUID(), nullable=False),
        sa.Column("code", sa.String(length=8), nullable=False),
        sa.Column("token", sa.String(length=64), nullable=False),
        sa.Column("scheduled_at", sa.String(length=40), nullable=True),
        sa.Column("role", sa.String(length=255), nullable=True),
        sa.Column("company", sa.String(length=255), nullable=True),
        sa.Column("characteristics", sa.Text(), nullable=True),
        sa.Column("app_url", sa.String(length=500), nullable=True),
        sa.Column("account_email", sa.String(length=255), nullable=True),
        sa.Column("account_password", sa.String(length=255), nullable=True),
        sa.Column("account_notes", sa.Text(), nullable=True),
        sa.Column("consent_name", sa.String(length=255), nullable=True),
        sa.Column("consent_at", sa.DateTime(), nullable=True),
        sa.Column("consent_version", sa.Integer(), nullable=True),
        sa.Column("words", postgresql.JSONB(), nullable=False),
        sa.Column("top_words", postgresql.JSONB(), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("session_notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["study_id"], ["usability_studies.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token", name="uq_usability_participants_token"),
        sa.UniqueConstraint("study_id", "code", name="uq_usability_participants_code"),
    )
    op.create_index("ix_usability_participants_account_study", "usability_participants", ["account_id", "study_id"])

    op.create_table(
        "usability_task_results",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("account_id", sa.UUID(), nullable=False),
        sa.Column("participant_id", sa.UUID(), nullable=False),
        sa.Column("task_id", sa.String(length=16), nullable=False),
        sa.Column("rating", sa.Integer(), nullable=True),
        sa.Column("answer", sa.Text(), nullable=True),
        sa.Column("time_seconds", sa.Integer(), nullable=True),
        sa.Column("errors", sa.Integer(), nullable=True),
        sa.Column("success", sa.String(length=16), nullable=True),
        sa.Column("observations", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("rating IS NULL OR rating BETWEEN 1 AND 10", name="ck_usability_task_results_rating"),
        sa.CheckConstraint(
            "success IS NULL OR success IN ('complete', 'help', 'fail')", name="ck_usability_task_results_success"
        ),
        sa.ForeignKeyConstraint(["participant_id"], ["usability_participants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("participant_id", "task_id", name="uq_usability_task_results_task"),
    )
    op.create_index(
        "ix_usability_task_results_account_participant", "usability_task_results", ["account_id", "participant_id"]
    )

    op.create_table(
        "usability_observations",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("account_id", sa.UUID(), nullable=False),
        sa.Column("study_id", sa.UUID(), nullable=False),
        sa.Column("task_id", sa.String(length=16), nullable=True),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("solution", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("participant_ids", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["study_id"], ["usability_studies.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_usability_observations_account_study", "usability_observations", ["account_id", "study_id"])

    for table in TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(RLS_POLICY.format(table=table))


def downgrade() -> None:
    for table in reversed(TABLES):
        op.drop_table(table)
