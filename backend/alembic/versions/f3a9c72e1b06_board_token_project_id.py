"""Board token project_id, for the "whoami" lookup.

A board token only ever recorded board_id -- but a board's lineage_id can
match more than one project row across versions, so board_id alone cannot
answer "which exact project is this token for" the way GET /board/whoami
(board/agent_routes.py) needs to. project_id is the exact project row
minting actually saw (create_board_token/create_agent both already resolve
`project` before calling mint_board_token), recorded purely so a caller
holding only the raw token -- e.g. a local agent whose .mcp.json was lost,
or never had FERROUS_STUDIO_PROJECT filled in -- can ask and learn what
belongs there, instead of always needing the id handed to it separately.

Additive and nullable, so it is safe against a live database. Tokens
minted before this exists just have no whoami answer (rejected with a
clean 404, not treated as an error at the schema level) -- there is
nothing to backfill it from.

Revision ID: f3a9c72e1b06
Revises: bd4067a23a0e
Create Date: 2026-09-14
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "f3a9c72e1b06"
down_revision = "bd4067a23a0e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "board_tokens",
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "board_tokens_project_id_fkey",
        "board_tokens",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    op.drop_constraint("board_tokens_project_id_fkey", "board_tokens", type_="foreignkey")
    op.drop_column("board_tokens", "project_id")
