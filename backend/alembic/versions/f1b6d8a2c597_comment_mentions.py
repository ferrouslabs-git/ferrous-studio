"""Who a board comment has told they were @-mentioned (FS-REQ-80).

The mentions themselves are tokens in the comment's body; this records who
has already been sent a Slack message for them, so editing a comment only
notifies the people it newly mentions.

Additive with a server default, so safe against a live database: existing
comments read as having told nobody, and nothing is sent for them until an
edit adds a mention. board_comments already runs FORCE ROW LEVEL SECURITY;
a new column changes nothing about its policies.

Revision ID: f1b6d8a2c597
Revises: e3a7c1f9b482
Create Date: 2026-11-05
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "f1b6d8a2c597"
down_revision = "e3a7c1f9b482"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "board_comments",
        sa.Column(
            "mentioned_user_ids",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("board_comments", "mentioned_user_ids")
