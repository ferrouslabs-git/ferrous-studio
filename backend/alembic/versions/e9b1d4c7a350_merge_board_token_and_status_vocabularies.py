"""Merge the two branches that both grew out of bd4067a23a0e.

Two migrations were written against the same parent on the same day and never
met until now:

- ``f3a9c72e1b06`` (board token project_id) went to main and is already
  applied to staging.
- ``a1f6c3e8b472`` (the board's status vocabularies) sat uncommitted in a
  working copy for a week, and the sprint-1 chain grew on top of it --
  b5c9e2a7f314, c7a2e9d4b158, d3f8b1e6c927.

So there are two heads, and ``alembic upgrade head`` refuses to guess between
them. This is the merge, not a re-pointed ``down_revision``, because the two
lineages have real databases on them and only a merge brings both forward:
staging sits on f3a9c72e1b06 alone and needs the four it has never seen,
while the local development databases sit on d3f8b1e6c927 and never got the
board token's project_id column. Re-pointing would leave whichever side it
was not pointed at quietly missing a column, with alembic reporting success.

The two branches touch disjoint tables (board_tokens on one side;
board_requirements, board_epics, board_sprints, board_releases,
use_case_actors, projects, project_documents on the other), so there is
nothing to reconcile here and this revision does no work of its own.

Revision ID: e9b1d4c7a350
Revises: d3f8b1e6c927, f3a9c72e1b06
Create Date: 2026-09-21
"""
from typing import Sequence, Union

revision: str = "e9b1d4c7a350"
down_revision: Union[str, Sequence[str], None] = ("d3f8b1e6c927", "f3a9c72e1b06")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Nothing to do: the two branches are disjoint."""


def downgrade() -> None:
    """Nothing to undo; splitting back into two heads is the caller's business."""
