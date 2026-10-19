"""Feedback as a support desk: statuses, assignee, estimate, resolution time,
comments, the requirement raised from it, and maintenance contracts.

FS-REQ-51..54. Four changes to the feedback tab shipped in c1e7f3a9b264 /
d3a8f1c5b427:

1. **Statuses** (FS-REQ-53). The triage set New/Triaged/Accepted/Declined/Done
   becomes a support desk's: New, EstimatedToConfirm, OnHold, NotABug,
   Confirmed, InProgress, Resolved (labels in statuses.FEEDBACK_STATUS_LABEL).
   The column widens from 10 to 32. Old values map on as
   statuses.LEGACY_FEEDBACK_STATUS records:

       New -> New, Triaged -> EstimatedToConfirm, Accepted -> Confirmed,
       Declined -> NotABug, Done -> Resolved

   The downgrade folds the two new states with no old equivalent back onto
   their neighbours (OnHold -> Triaged, InProgress -> Accepted), so it is
   lossy for those two and knowingly so.

2. **Assignee, estimate and resolution time** (FS-REQ-52), the same shape as a
   requirement's: ``assignee_id`` (users, SET NULL), ``estimate_hours``
   (double precision, NULL = not estimated), and ``resolved_at``, stamped by
   the route on the move into Resolved and cleared on the move out. Reports
   already Done are backfilled with their ``updated_at`` -- the last time
   anything about them changed, which for a closed report is when it was
   closed, near enough.

3. **The requirement raised from it** (FS-REQ-51): ``requirement_id``
   (board_requirements, SET NULL). Comments on a report: the CHECK on
   board_comments.entity_type is recast with 'feedback' added (a CHECK has no
   ALTER, as d3a8f1c5b427 found for attachments).

4. **Maintenance contracts** (FS-REQ-54): board_maintenance_contracts, dated
   rows of hours bought per month, on the board like the reports they pay
   for. RLS in the same shape as every other board table.

Row-level security is forced on board_feedback, and its WITH CHECK refuses a
write from a context with no account scope, so the status rewrite lifts FORCE
for the duration of the transaction exactly as a1f6c3e8b472 does for the work
vocabulary.

Revision ID: f5c2a8d1e937
Revises: e8b4c1f7a352
Create Date: 2026-10-16
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'f5c2a8d1e937'
down_revision: Union[str, None] = 'e8b4c1f7a352'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_OLD_STATUSES = ("New", "Triaged", "Accepted", "Declined", "Done")
_NEW_STATUSES = ("New", "EstimatedToConfirm", "OnHold", "NotABug", "Confirmed", "InProgress", "Resolved")

#: statuses.LEGACY_FEEDBACK_STATUS, frozen here: a migration must not change
#: meaning if the application's table later does.
_UPGRADE_MAP = (
    ("Triaged", "EstimatedToConfirm"),
    ("Accepted", "Confirmed"),
    ("Declined", "NotABug"),
    ("Done", "Resolved"),
)
_DOWNGRADE_MAP = (
    ("EstimatedToConfirm", "Triaged"),
    ("OnHold", "Triaged"),
    ("NotABug", "Declined"),
    ("Confirmed", "Accepted"),
    ("InProgress", "Accepted"),
    ("Resolved", "Done"),
)

_COMMENT_ENTITIES = ("release", "epic", "feature", "requirement", "sprint", "doc")

RLS_POLICY = """
CREATE POLICY {table}_scope ON {table}
    USING (
        current_setting('app.is_super_admin', true) = 'true'
        OR account_id::text = current_setting('app.current_scope_id', true)
    )
    WITH CHECK (
        account_id::text = current_setting('app.current_scope_id', true)
    )
"""


def _values(items: tuple[str, ...]) -> str:
    return ",".join(f"'{v}'" for v in items)


def _apply_rls(table: str) -> None:
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(RLS_POLICY.format(table=table))


def _recast_comment_entities(entities: tuple[str, ...]) -> None:
    op.drop_constraint('ck_board_comments_entity_type', 'board_comments', type_='check')
    op.create_check_constraint(
        'ck_board_comments_entity_type', 'board_comments', f"entity_type IN ({_values(entities)})"
    )


def upgrade() -> None:
    # -- 1. statuses ------------------------------------------------------
    op.execute("ALTER TABLE board_feedback NO FORCE ROW LEVEL SECURITY")
    op.drop_constraint('ck_board_feedback_status', 'board_feedback', type_='check')
    op.alter_column('board_feedback', 'status', type_=sa.String(length=32), existing_nullable=False)

    # -- 2. assignee, estimate, resolution time ---------------------------
    op.add_column('board_feedback', sa.Column('assignee_id', sa.UUID(), nullable=True))
    op.create_foreign_key(
        'fk_board_feedback_assignee', 'board_feedback', 'users', ['assignee_id'], ['id'], ondelete='SET NULL'
    )
    op.add_column('board_feedback', sa.Column('estimate_hours', sa.Float(), nullable=True))
    op.create_check_constraint(
        'ck_board_feedback_estimate_non_negative', 'board_feedback', 'estimate_hours IS NULL OR estimate_hours >= 0'
    )
    op.add_column('board_feedback', sa.Column('resolved_at', sa.DateTime(), nullable=True))

    # Stamp before the rename -- 'Done' is the only record these were closed.
    op.execute("UPDATE board_feedback SET resolved_at = updated_at WHERE status = 'Done'")
    for old, new in _UPGRADE_MAP:
        op.execute(f"UPDATE board_feedback SET status = '{new}' WHERE status = '{old}'")
    op.create_check_constraint(
        'ck_board_feedback_status', 'board_feedback', f"status IN ({_values(_NEW_STATUSES)})"
    )

    # -- 3. the requirement raised from it; comments ----------------------
    op.add_column('board_feedback', sa.Column('requirement_id', sa.UUID(), nullable=True))
    op.create_foreign_key(
        'fk_board_feedback_requirement', 'board_feedback', 'board_requirements',
        ['requirement_id'], ['id'], ondelete='SET NULL',
    )
    op.execute("ALTER TABLE board_feedback FORCE ROW LEVEL SECURITY")
    _recast_comment_entities(_COMMENT_ENTITIES + ("feedback",))

    # -- 4. maintenance contracts -----------------------------------------
    op.create_table(
        'board_maintenance_contracts',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('board_id', sa.UUID(), nullable=False),
        sa.Column('account_id', sa.UUID(), nullable=False),
        sa.Column('start_date', sa.Date(), nullable=False),
        sa.Column('end_date', sa.Date(), nullable=True),
        sa.Column('hours_per_month', sa.Float(), nullable=False),
        sa.Column('created_by', sa.UUID(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.CheckConstraint('hours_per_month >= 0', name='ck_board_maintenance_contracts_hours'),
        sa.CheckConstraint(
            'end_date IS NULL OR end_date >= start_date', name='ck_board_maintenance_contracts_dates'
        ),
        sa.ForeignKeyConstraint(['board_id'], ['boards.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_board_maintenance_contracts_board', 'board_maintenance_contracts', ['board_id', 'start_date']
    )
    _apply_rls('board_maintenance_contracts')


def downgrade() -> None:
    op.drop_index('ix_board_maintenance_contracts_board', table_name='board_maintenance_contracts')
    op.drop_table('board_maintenance_contracts')

    # Comments on reports have to go before the CHECK narrows again. A DELETE
    # needs no WITH CHECK, so the read bypass is enough (b2e8c4f7a519).
    conn = op.get_bind()
    conn.execute(sa.text("SELECT set_config('app.is_super_admin', 'true', true)"))
    conn.execute(sa.text("DELETE FROM board_comments WHERE entity_type = 'feedback'"))
    _recast_comment_entities(_COMMENT_ENTITIES)

    op.execute("ALTER TABLE board_feedback NO FORCE ROW LEVEL SECURITY")
    op.drop_constraint('fk_board_feedback_requirement', 'board_feedback', type_='foreignkey')
    op.drop_column('board_feedback', 'requirement_id')

    op.drop_constraint('ck_board_feedback_status', 'board_feedback', type_='check')
    for new, old in _DOWNGRADE_MAP:
        op.execute(f"UPDATE board_feedback SET status = '{old}' WHERE status = '{new}'")
    op.alter_column('board_feedback', 'status', type_=sa.String(length=10), existing_nullable=False)
    op.create_check_constraint(
        'ck_board_feedback_status', 'board_feedback', f"status IN ({_values(_OLD_STATUSES)})"
    )

    op.drop_column('board_feedback', 'resolved_at')
    op.drop_constraint('ck_board_feedback_estimate_non_negative', 'board_feedback', type_='check')
    op.drop_column('board_feedback', 'estimate_hours')
    op.drop_constraint('fk_board_feedback_assignee', 'board_feedback', type_='foreignkey')
    op.drop_column('board_feedback', 'assignee_id')
    op.execute("ALTER TABLE board_feedback FORCE ROW LEVEL SECURITY")
