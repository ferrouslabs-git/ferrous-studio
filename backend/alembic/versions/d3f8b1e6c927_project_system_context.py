"""The requirements that are not use cases: physical setup, hosting, goals, example data.

Requested 2026-09-18. A use case says what the system does for someone; none
of these do, and there was nowhere to write them down -- they ended up in a
project description, or nowhere.

Four free-text fields on ``projects`` rather than a side table: they are
singleton, optional, per-project attributes exactly like ``description`` and
``rationale`` beside them, and a one-row child table would buy a join and a
"create it if it is missing" dance for nothing. All nullable: none of them
apply to every project, and an empty field must read as "not asked" rather
than as an answer of "".

Free text, not numbers, for both goals. "Under 200 ms at the 95th percentile
on a 4G connection" and "no worse than the manual process" are both real
answers to a latency goal, and a numeric column could hold neither.

``project_documents.purpose`` splits the example-data files off from the
project's documents: same table, same hardened upload path (allow-list by
extension and MIME, magic-byte check, random key, presigned PUT), two lists.
Defaults to 'document', so every existing row stays in the Documents tab
where it was uploaded.

Revision ID: d3f8b1e6c927
Revises: c7a2e9d4b158
Create Date: 2026-09-18
"""
from alembic import op
import sqlalchemy as sa

revision = "d3f8b1e6c927"
down_revision = "c7a2e9d4b158"
branch_labels = None
depends_on = None


FIELDS = ("physical_setup", "hosting", "latency_goal", "accuracy_goal")


def upgrade() -> None:
    for field in FIELDS:
        op.add_column("projects", sa.Column(field, sa.Text(), nullable=True))
    op.add_column(
        "project_documents",
        sa.Column("purpose", sa.String(length=20), nullable=False, server_default="document"),
    )
    # Both lists read by purpose, so it leads the index they already had.
    op.create_index(
        "ix_project_documents_purpose",
        "project_documents",
        ["account_id", "project_id", "purpose", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_project_documents_purpose", table_name="project_documents")
    op.drop_column("project_documents", "purpose")
    for field in FIELDS:
        op.drop_column("projects", field)
