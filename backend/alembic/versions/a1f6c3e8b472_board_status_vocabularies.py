"""Board: one work-status vocabulary, one delivery-status vocabulary.

Requested 2026-09-14. Three changes that only make sense together:

1. **Requirements** get the renamed work vocabulary --
   Todo/Doing/Review -> NotStarted/InProgress/ToTest, with Done and Blocked
   unchanged. A pure rename: the five states map one-to-one, so the data
   migrates by UPDATE and nothing is lost. ``blocked_from`` carries the same
   values and is rewritten alongside. Both columns widen to 20 ("NotStarted"
   is already 10, which leaves no room at all).

2. **Epics** lose ``status`` entirely, and features never had one: both are
   now rolled up from the requirements beneath them
   (statuses.roll_up_status) and served read-only. The dropped column held a
   hand-advanced Readiness/Implementation/ReleasedToUAT/HumanValidation/Done
   lifecycle -- a second, unchecked claim about the same work the
   requirements already described. Its "can't be Done while requirements
   aren't" guard (a 409 in update_epic) goes with it; the roll-up cannot
   make that claim in the first place.

   This is the one irreversible part. The downgrade restores the column and
   its default, but the lifecycle values themselves are gone -- they were
   never derivable from anything else. See downgrade()'s note.

3. **Sprints and releases** gain a delivery status --
   NotStarted/InProgress/ToTest/DeployedToUAT/DeployedToStaging/DeployedToLive
   -- set by hand and deliberately non-linear. The sprint's old
   ``state`` (planned/active/done) is *not* that field: its values carried
   side effects (only an "active" sprint could be worked; "done" emptied the
   sprint back to the backlog), and a freely-settable label must not fire
   those. So ``state`` becomes ``status`` for its label half, and the side
   effects move to a new ``closed_at``.

   Mapping: planned -> NotStarted, active -> InProgress, done -> InProgress
   with ``closed_at`` stamped. A closed sprint deliberately does NOT become
   "DeployedToLive": nothing in the old model recorded where its work went,
   and inventing a deployment claim is worse than leaving one to be set.

   A release's status starts from what *was* recorded: DeployedToLive where
   ``shipped_at`` is set, NotStarted otherwise. ``shipped_at`` stays, now
   stamped by the route the first time the status reaches DeployedToLive,
   and never cleared by moving away again.

Revision ID: a1f6c3e8b472
Revises: bd4067a23a0e
Create Date: 2026-09-14

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'a1f6c3e8b472'
down_revision: Union[str, None] = 'bd4067a23a0e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Todo/Doing/Review -> NotStarted/InProgress/ToTest; Done and Blocked keep
# their names. Applied to status and blocked_from alike.
_WORK_RENAMES = (("Todo", "NotStarted"), ("Doing", "InProgress"), ("Review", "ToTest"))

_OLD_WORK = "'Todo','Doing','Review','Blocked','Done'"
_NEW_WORK = "'NotStarted','InProgress','ToTest','Blocked','Done'"
_DELIVERY = "'NotStarted','InProgress','ToTest','DeployedToUAT','DeployedToStaging','DeployedToLive'"
_OLD_EPIC = "'Readiness','Implementation','ReleasedToUAT','HumanValidation','Done'"
_OLD_SPRINT_STATE = "'planned','active','done'"

#: The tables this migration rewrites rows in. Every one runs FORCE ROW LEVEL
#: SECURITY, and their policy is deliberately asymmetric -- USING lets a
#: super-admin context read across accounts, WITH CHECK does not let it write:
#:
#:     USING      (is_super_admin OR account_id = current scope)
#:     WITH CHECK (account_id = current scope)
#:
#: which is right for the application and wrong for a migration. A migration
#: maintains the whole database and belongs to no account, so with no scope
#: set its UPDATEs match nothing (and with only is_super_admin set they are
#: refused by WITH CHECK). Either way the DDL that follows still validates
#: every row and fails on the data the UPDATE was supposed to fix.
#:
#: Lifting FORCE for the duration is the narrowest fix: it is scoped to this
#: transaction, needs no new role or policy, and rolls back with everything
#: else if the migration fails. Nothing here is account-specific -- it is a
#: vocabulary rename over every row.
_RLS_TABLES = ("board_requirements", "board_sprints", "board_releases")


def _unforce_rls() -> None:
    for table in _RLS_TABLES:
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")


def _reforce_rls() -> None:
    for table in _RLS_TABLES:
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")


def upgrade() -> None:
    _unforce_rls()
    # -- 1. requirements: rename the work vocabulary ----------------------
    # Constraint first: it still names the old set, and every UPDATE below
    # would fail against it.
    op.drop_constraint('ck_board_requirements_status', 'board_requirements', type_='check')
    op.alter_column('board_requirements', 'status', type_=sa.String(length=20), existing_nullable=False)
    op.alter_column('board_requirements', 'blocked_from', type_=sa.String(length=20), existing_nullable=True)
    for old, new in _WORK_RENAMES:
        op.execute(f"UPDATE board_requirements SET status = '{new}' WHERE status = '{old}'")
        op.execute(f"UPDATE board_requirements SET blocked_from = '{new}' WHERE blocked_from = '{old}'")
    op.execute("ALTER TABLE board_requirements ALTER COLUMN status SET DEFAULT 'NotStarted'")
    op.create_check_constraint('ck_board_requirements_status', 'board_requirements', f"status IN ({_NEW_WORK})")

    # -- 2. epics: status becomes derived, so the column goes -------------
    op.drop_constraint('ck_board_epics_status', 'board_epics', type_='check')
    op.drop_column('board_epics', 'status')

    # -- 3a. sprints: state -> status, plus closed_at ---------------------
    op.drop_constraint('ck_board_sprints_state', 'board_sprints', type_='check')
    op.add_column('board_sprints', sa.Column('closed_at', sa.DateTime(), nullable=True))
    op.alter_column('board_sprints', 'state', new_column_name='status', type_=sa.String(length=20),
                    existing_nullable=False)
    # Stamp the close BEFORE the values are rewritten -- 'done' is the only
    # record that these sprints were ever finished.
    op.execute("UPDATE board_sprints SET closed_at = updated_at WHERE status = 'done'")
    op.execute("UPDATE board_sprints SET status = 'NotStarted' WHERE status = 'planned'")
    op.execute("UPDATE board_sprints SET status = 'InProgress' WHERE status IN ('active', 'done')")
    op.execute("ALTER TABLE board_sprints ALTER COLUMN status SET DEFAULT 'NotStarted'")
    op.create_check_constraint('ck_board_sprints_status', 'board_sprints', f"status IN ({_DELIVERY})")

    # -- 3b. releases: a delivery status, seeded from shipped_at ----------
    op.add_column(
        'board_releases',
        sa.Column('status', sa.String(length=20), nullable=False, server_default='NotStarted'),
    )
    op.execute("UPDATE board_releases SET status = 'DeployedToLive' WHERE shipped_at IS NOT NULL")
    op.create_check_constraint('ck_board_releases_status', 'board_releases', f"status IN ({_DELIVERY})")
    _reforce_rls()


def downgrade() -> None:
    _unforce_rls()
    # -- 3b. releases -----------------------------------------------------
    op.drop_constraint('ck_board_releases_status', 'board_releases', type_='check')
    op.drop_column('board_releases', 'status')

    # -- 3a. sprints ------------------------------------------------------
    # closed_at is the only thing that distinguishes a finished sprint from
    # a running one, so it drives the 'done' half of the mapping back. The
    # delivery statuses beyond InProgress have no old equivalent at all and
    # collapse to 'active'.
    op.drop_constraint('ck_board_sprints_status', 'board_sprints', type_='check')
    op.execute("UPDATE board_sprints SET status = 'planned' WHERE status = 'NotStarted'")
    op.execute("UPDATE board_sprints SET status = 'active' WHERE status <> 'planned'")
    op.execute("UPDATE board_sprints SET status = 'done' WHERE closed_at IS NOT NULL")
    op.alter_column('board_sprints', 'status', new_column_name='state', type_=sa.String(length=10),
                    existing_nullable=False)
    op.execute("ALTER TABLE board_sprints ALTER COLUMN state SET DEFAULT 'planned'")
    op.create_check_constraint('ck_board_sprints_state', 'board_sprints', f"state IN ({_OLD_SPRINT_STATE})")
    op.drop_column('board_sprints', 'closed_at')

    # -- 2. epics ---------------------------------------------------------
    # Lossy, and knowingly so: the hand-set lifecycle values were never
    # derivable from the requirements, so every epic comes back at
    # 'Readiness' whatever it was before. Recorded here rather than papered
    # over -- a downgrade restores the shape, not the judgements.
    op.add_column(
        'board_epics',
        sa.Column('status', sa.String(length=20), nullable=False, server_default='Readiness'),
    )
    op.create_check_constraint('ck_board_epics_status', 'board_epics', f"status IN ({_OLD_EPIC})")

    # -- 1. requirements --------------------------------------------------
    op.drop_constraint('ck_board_requirements_status', 'board_requirements', type_='check')
    for old, new in _WORK_RENAMES:
        op.execute(f"UPDATE board_requirements SET status = '{old}' WHERE status = '{new}'")
        op.execute(f"UPDATE board_requirements SET blocked_from = '{old}' WHERE blocked_from = '{new}'")
    op.alter_column('board_requirements', 'status', type_=sa.String(length=10), existing_nullable=False)
    op.alter_column('board_requirements', 'blocked_from', type_=sa.String(length=10), existing_nullable=True)
    op.execute("ALTER TABLE board_requirements ALTER COLUMN status SET DEFAULT 'Todo'")
    op.create_check_constraint('ck_board_requirements_status', 'board_requirements', f"status IN ({_OLD_WORK})")
    _reforce_rls()
