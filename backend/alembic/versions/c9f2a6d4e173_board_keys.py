"""Every board gets a project key, so its ids are unique across projects

Board ids were numbered per board, so every project had its own REQ-5 and
nothing in "REQ-5" said which. ``boards.key`` is a short code unique within
the organisation (IA for Invoice Approvals, IA2 for the next one) that
prefixes every id the board renders: IA-REQ-5, IA-E1, IA-REL2. The ids are
not stored anywhere -- each is ``seq`` plus a prefix, built by the model --
so adding the key re-names every id at once and nothing else changes.

Existing boards are keyed from their project's name, oldest board first so
the project that has been around longest keeps the plain key. The derivation
is copied from service.derive_board_key rather than imported, because a
migration must keep meaning what it meant when it was written.

``boards`` is under forced row-level security like every studio table: the
backfill reads with the bypass and writes each board with its own account as
the scope, so WITH CHECK admits it (see a6d3f9c2e814).

Revision ID: c9f2a6d4e173
Revises: b2e8c4f7a519
Create Date: 2026-09-29
"""
import re
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'c9f2a6d4e173'
down_revision: Union[str, None] = 'b2e8c4f7a519'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _derive(name: str, taken: set[str]) -> str:
    words = re.findall(r"[A-Za-z0-9]+", name)
    base = "".join(w[0] for w in words[:4]) if len(words) > 1 else (words[0][:3] if words else "")
    base = base.upper()
    if not base or not base[0].isalpha():
        base = "P" + base
    base = base[:4].ljust(2, "X")
    key, n = base, 2
    while key in taken:
        key, n = f"{base}{n}", n + 1
    return key


def upgrade() -> None:
    op.add_column('boards', sa.Column('key', sa.String(length=6), nullable=True))

    conn = op.get_bind()
    conn.execute(sa.text("SELECT set_config('app.is_super_admin', 'true', true)"))
    # Each board's name is its lineage's newest project version -- the name
    # people see today.
    rows = conn.execute(
        sa.text(
            """
            SELECT b.id, b.account_id,
                   (SELECT p.name FROM projects p
                     WHERE p.lineage_id = b.lineage_id AND p.account_id = b.account_id
                     ORDER BY p.created_at DESC LIMIT 1) AS name
              FROM boards b
             ORDER BY b.created_at, b.id
            """
        )
    ).fetchall()
    taken: dict[str, set[str]] = {}
    for board_id, account_id, name in rows:
        keys = taken.setdefault(str(account_id), set())
        key = _derive(name or "", keys)
        keys.add(key)
        conn.execute(sa.text("SELECT set_config('app.current_scope_id', :scope, true)"), {"scope": str(account_id)})
        conn.execute(sa.text("UPDATE boards SET key = :key WHERE id = :id"), {"key": key, "id": board_id})
    conn.execute(sa.text("SELECT set_config('app.current_scope_id', '', true)"))

    op.alter_column('boards', 'key', nullable=False)
    op.create_unique_constraint('uq_boards_account_key', 'boards', ['account_id', 'key'])
    op.create_check_constraint('ck_boards_key_format', 'boards', "key ~ '^[A-Z][A-Z0-9]{1,5}$'")


def downgrade() -> None:
    op.drop_constraint('ck_boards_key_format', 'boards', type_='check')
    op.drop_constraint('uq_boards_account_key', 'boards', type_='unique')
    op.drop_column('boards', 'key')
