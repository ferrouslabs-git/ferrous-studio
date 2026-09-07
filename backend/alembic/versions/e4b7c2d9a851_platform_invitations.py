"""platform invitations: invite someone straight in as a super admin

Every invitation so far has led into an organisation: ``tenant_id`` and
``target_scope_id`` were both required, and accepting one created a
membership there. A super admin is not a membership at all but a flag on
the user (``users.is_platform_admin``), so inviting one has nowhere to
point. This loosens both columns so a row with ``target_scope_type =
'platform'`` can carry no tenant and no scope id; accepting it sets the
flag instead of inserting a membership.

Nothing is backfilled: every existing invitation keeps its organisation.

Revision ID: e4b7c2d9a851
Revises: d2f7a9c4e163
Create Date: 2026-09-07
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'e4b7c2d9a851'
down_revision: Union[str, None] = 'd2f7a9c4e163'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('invitations', 'tenant_id', existing_type=postgresql.UUID(), nullable=True)
    op.alter_column('invitations', 'target_scope_id', existing_type=postgresql.UUID(), nullable=True)


def downgrade() -> None:
    # Platform invitations have no organisation to fall back to.
    op.execute("DELETE FROM invitations WHERE tenant_id IS NULL OR target_scope_id IS NULL")
    op.alter_column('invitations', 'target_scope_id', existing_type=postgresql.UUID(), nullable=False)
    op.alter_column('invitations', 'tenant_id', existing_type=postgresql.UUID(), nullable=False)
