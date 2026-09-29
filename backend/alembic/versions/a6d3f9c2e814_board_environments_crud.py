"""Board environments become a list the project keeps, not three fixed slots

c1e7f3a9b264 fixed the environments at UAT, Staging and Production so that
reports stayed comparable. Projects turned out to need more than three (a
demo site, a second region, a partner sandbox), so the list is now the
board's own: named, ordered, added and removed on the project details page.

What stays the same is the slug. Feedback still names its environment by
slug and never by FK -- a report outlives the link it was raised against --
so the slug remains the stable key: renaming an environment changes only its
``label``, and a custom one gets a slug minted once from its first label.

What changes:

- ``label`` and ``position`` columns; the three CHECKs pinning the slug to
  uat/staging/production (here and on board_feedback) are dropped.
- A row no longer means "has an address". An environment can exist before
  anyone knows its URL, so ``url = ''`` is now the unset state and the
  non-blank CHECK goes.
- Every existing board gets the three original environments as rows (keeping
  any address already set), so nothing on screen changes until someone edits
  the list. New boards are seeded the same way (service.get_or_create_board).

Row-level security is forced on these tables and its WITH CHECK only admits a
row whose account matches the scope, so the backfill sets both the read
bypass and, per board, the scope before writing (see e1c4a7f2b930).

Downgrade drops the added environments and any unset rows, and restores the
CHECKs. The one on board_feedback comes back NOT VALID: a report raised
against an environment that no longer exists after the downgrade is kept,
not deleted, and simply is not re-checked.

Revision ID: a6d3f9c2e814
Revises: e9b1d4c7a350
Create Date: 2026-09-29
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'a6d3f9c2e814'
down_revision: Union[str, None] = 'e9b1d4c7a350'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

DEFAULTS = (("uat", "UAT"), ("staging", "Staging"), ("production", "Production"))


def upgrade() -> None:
    op.add_column('board_environments', sa.Column('label', sa.String(length=64), nullable=False, server_default=''))
    op.add_column('board_environments', sa.Column('position', sa.Integer(), nullable=False, server_default='0'))
    op.drop_constraint('ck_board_environments_slug', 'board_environments', type_='check')
    op.drop_constraint('ck_board_environments_url_present', 'board_environments', type_='check')
    op.drop_constraint('ck_board_feedback_environment', 'board_feedback', type_='check')

    conn = op.get_bind()
    conn.execute(sa.text("SELECT set_config('app.is_super_admin', 'true', true)"))
    boards = conn.execute(sa.text("SELECT id, account_id FROM boards")).fetchall()
    for board_id, account_id in boards:
        conn.execute(sa.text("SELECT set_config('app.current_scope_id', :scope, true)"), {"scope": str(account_id)})
        existing = {
            slug
            for (slug,) in conn.execute(
                sa.text("SELECT slug FROM board_environments WHERE board_id = :b"), {"b": board_id}
            )
        }
        for position, (slug, label) in enumerate(DEFAULTS):
            if slug in existing:
                conn.execute(
                    sa.text(
                        "UPDATE board_environments SET label = :label, position = :position "
                        "WHERE board_id = :b AND slug = :slug"
                    ),
                    {"label": label, "position": position, "b": board_id, "slug": slug},
                )
            else:
                conn.execute(
                    sa.text(
                        "INSERT INTO board_environments "
                        "(id, board_id, account_id, slug, label, position, url, created_at, updated_at) "
                        "VALUES (gen_random_uuid(), :b, :a, :slug, :label, :position, '', now(), now())"
                    ),
                    {"b": board_id, "a": account_id, "slug": slug, "label": label, "position": position},
                )

    # Leave no board's scope behind for whatever migration runs next in this
    # transaction (env.py keeps only the read bypass set for the whole run).
    conn.execute(sa.text("SELECT set_config('app.current_scope_id', '', true)"))

    op.alter_column('board_environments', 'label', server_default=None)
    op.alter_column('board_environments', 'position', server_default=None)
    op.create_check_constraint('ck_board_environments_label_present', 'board_environments', "label <> ''")


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text("SELECT set_config('app.is_super_admin', 'true', true)"))
    # DELETE's USING admits the bypass; no WITH CHECK applies to a delete.
    conn.execute(
        sa.text("DELETE FROM board_environments WHERE url = '' OR slug NOT IN ('uat', 'staging', 'production')")
    )
    op.drop_constraint('ck_board_environments_label_present', 'board_environments', type_='check')
    op.execute(
        "ALTER TABLE board_feedback ADD CONSTRAINT ck_board_feedback_environment "
        "CHECK (environment IN ('uat','staging','production')) NOT VALID"
    )
    op.create_check_constraint('ck_board_environments_url_present', 'board_environments', "url <> ''")
    op.create_check_constraint(
        'ck_board_environments_slug', 'board_environments', "slug IN ('uat','staging','production')"
    )
    op.drop_column('board_environments', 'position')
    op.drop_column('board_environments', 'label')
