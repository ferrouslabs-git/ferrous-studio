"""RLS: platform-admin bypass is read-only, not read/write

Every studio table's ``{table}_scope`` policy today has an *identical*
USING and WITH CHECK clause: ``app.is_super_admin = 'true' OR account_id =
current_scope_id``. That means a platform admin's bypass -- meant for
cross-organisation support/visibility -- can currently also *write* into any
organisation's rows, not merely read them. Nothing in the application relies
on a platform admin writing cross-organisation today; this closes that gap
at the database layer regardless of what the Python authorisation code does
or how it evolves (see docs/go-live-and-merge-boards.md phase 2.2).

Only WITH CHECK changes -- USING (read access) is untouched, so existing
cross-organisation reads (``allow_cross_account`` etc.) keep working exactly
as before.

Revision ID: f7a3d8e1c265
Revises: e4b7c2d9a851
Create Date: 2026-09-08
"""
from typing import Sequence, Union

from alembic import op

revision: str = 'f7a3d8e1c265'
down_revision: Union[str, None] = 'e4b7c2d9a851'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Ground truth as of this migration: every table with a `{table}_scope` RLS
# policy, keyed on `account_id` (confirmed via `SELECT * FROM pg_policies`
# against a fresh local database rather than traced by hand through history,
# since earlier migrations rename/drop tables -- e.g. requirement_extractions
# and requirement_items no longer exist).
SCOPED_TABLES = (
    "datasets",
    "github_installations",
    "personas",
    "project_diagrams",
    "project_documents",
    "project_op_batches",
    "project_pages",
    "project_versions",
    "projects",
    "use_case_actors",
    "use_cases",
    "wireframe_actors",
    "wireframe_annotations",
    "wireframe_audit_log",
    "wireframe_personas",
    "wireframes",
)

_WRITE_CHECK_NEW = "account_id::text = current_setting('app.current_scope_id', true)"
_WRITE_CHECK_OLD = (
    "current_setting('app.is_super_admin', true) = 'true' "
    "OR account_id::text = current_setting('app.current_scope_id', true)"
)


def upgrade() -> None:
    for table in SCOPED_TABLES:
        op.execute(f"ALTER POLICY {table}_scope ON {table} WITH CHECK ({_WRITE_CHECK_NEW})")


def downgrade() -> None:
    for table in SCOPED_TABLES:
        op.execute(f"ALTER POLICY {table}_scope ON {table} WITH CHECK ({_WRITE_CHECK_OLD})")
