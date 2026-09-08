"""Backfill platform-scope Memberships for existing platform admins

users.is_platform_admin is kept as a synced convenience flag (existing API
responses and the frontend read it directly), but authorisation now resolves
a real Membership row instead -- see PLATFORM_SCOPE_ID and
has_platform_permission in app/auth/security/dependencies.py. Every user with
is_platform_admin = true needs the matching Membership or they lose all
platform-level access the moment this deploys (docs/go-live-and-merge-boards.md
phase 2).

Revision ID: a1c9e4f7b382
Revises: f7a3d8e1c265
Create Date: 2026-09-08
"""
from typing import Sequence, Union

from alembic import op

revision: str = 'a1c9e4f7b382'
down_revision: Union[str, None] = 'f7a3d8e1c265'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

PLATFORM_SCOPE_ID = "00000000-0000-0000-0000-000000000000"

# ON CONFLICT DO NOTHING: idempotent against the existing
# unique_user_role_scope constraint (user_id, role_name, scope_type, scope_id)
# -- safe to run even if a row already exists (e.g. from accepting a platform
# invitation after this migration was written but before it ran).
_UPGRADE_SQL = f"""
INSERT INTO memberships (id, user_id, role_name, scope_type, scope_id, status, created_at)
SELECT gen_random_uuid(), id, 'platform_admin', 'platform', '{PLATFORM_SCOPE_ID}', 'active', now()
FROM users
WHERE is_platform_admin = true
ON CONFLICT ON CONSTRAINT unique_user_role_scope DO NOTHING
"""

_DOWNGRADE_SQL = f"""
DELETE FROM memberships
WHERE scope_type = 'platform' AND scope_id = '{PLATFORM_SCOPE_ID}' AND role_name = 'platform_admin'
"""


def upgrade() -> None:
    op.execute(_UPGRADE_SQL)


def downgrade() -> None:
    op.execute(_DOWNGRADE_SQL)
