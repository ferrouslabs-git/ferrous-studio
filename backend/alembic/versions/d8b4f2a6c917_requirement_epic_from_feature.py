"""A requirement under a feature carries that feature's epic as its own

A requirement filed under a feature alone (the board MCP's create_requirement
takes "at most one of epic_id/feature_id") was stored with ``epic_id`` NULL,
its epic only derivable through the feature. Screens that read the
requirement's own ``epic_id`` then showed it as having no epic, and picking
the epic there cleared the feature. The API now stamps the feature's epic on
every write; this backfills the rows written before that.

Row-level security is forced on ``board_requirements`` and its WITH CHECK only
admits the row's own organisation, so FORCE is lifted for this transaction
and put back before it ends (as ``b5d1f7e3a926``). Nothing to undo: the
downgrade leaves the stamped epics in place, which is still a valid state.

Revision ID: d8b4f2a6c917
Revises: c3e8a5f1d620
Create Date: 2026-11-25
"""
from typing import Sequence, Union

from alembic import op

revision: str = 'd8b4f2a6c917'
down_revision: Union[str, None] = 'c3e8a5f1d620'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE board_requirements NO FORCE ROW LEVEL SECURITY")
    # board_features is only read; reading needs the flag alone.
    op.execute("SELECT set_config('app.is_super_admin', 'true', true)")
    op.execute(
        """
        UPDATE board_requirements r
           SET epic_id = f.epic_id
          FROM board_features f
         WHERE r.feature_id = f.id
           AND r.epic_id IS DISTINCT FROM f.epic_id
        """
    )
    op.execute("ALTER TABLE board_requirements FORCE ROW LEVEL SECURITY")


def downgrade() -> None:
    pass
