"""Comment authorship by an agent.

Software-management stores an agent's id as the comment's free-text
``author``, and its sprint board's "Questions from the agent" card reads
that column to tell an agent's question apart from a human's remark. Here
``author_id`` is a foreign key to ``users`` and a board-token request is
attributed to the token's *creator* (the human who minted it -- see
app/studio/board/agents.py's require_board_token), so an agent's comment
would otherwise be indistinguishable from one that person typed.

This nullable FK records agent authorship explicitly. It is set in
routes.py's create_comment from the board token the request carried
(``ScopeContext.board_token_id`` -> ``board_agents.board_token_id``), and
stays NULL for every human comment. ON DELETE SET NULL, so a question
remains readable after the agent that asked it has been deleted.

Additive and nullable, so it is safe against a live database. No RLS work
-- board_comments already runs FORCE ROW LEVEL SECURITY with its
account_id policy.

Revision ID: bd4067a23a0e
Revises: 6471379b3158
Create Date: 2026-09-11
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "bd4067a23a0e"
down_revision = "6471379b3158"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "board_comments",
        sa.Column("agent_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "board_comments_agent_id_fkey",
        "board_comments",
        "board_agents",
        ["agent_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("board_comments_agent_id_fkey", "board_comments", type_="foreignkey")
    op.drop_column("board_comments", "agent_id")
