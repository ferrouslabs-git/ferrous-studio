"""Feedback: severity, the page it happened on, and screenshots

Three additions to the feedback tab shipped in c1e7f3a9b264, which recorded
what someone thought and which environment they were on, but not how bad it
was, which page, or what they actually saw.

`severity` is the *reporter's* claim about impact, which is why it sits beside
`kind` rather than beside `status`: an admin may correct it exactly as they may
correct a title, but it is not a triage outcome. `status` remains the only
thing triage moves, and FeedbackCreate still refuses to accept one.

`page_url` is the exact page, the environment address being only the base. It
carries no CHECK on the scheme -- `board_environments.url` has none either, and
the http/https rule lives in one pydantic helper shared by both. Note the
deliberate asymmetry with that table: here `''` means "not given", whereas for
an environment the *absence of a row* is the unset state (which is why
ck_board_environments_url_present forbids `''` there).

Screenshots reuse `board_attachments` wholesale rather than growing a table of
their own -- the pending/uploaded S3 flow, the RLS policy and the presign
helpers are all already right. Only the entity_type CHECK stands in the way,
and Postgres has no ALTER CONSTRAINT for a CHECK, so it is dropped and recast
with 'feedback' added. The constraint was created in d4f7b2a9c631, which is
left untouched.

Revision ID: d3a8f1c5b427
Revises: c1e7f3a9b264
Create Date: 2026-09-08
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'd3a8f1c5b427'
down_revision: Union[str, None] = 'c1e7f3a9b264'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

#: Kept in one place because upgrade() and downgrade() must recast the same
#: constraint with and without 'feedback'. Order matches d4f7b2a9c631's
#: original, so a downgrade restores that constraint verbatim.
ATTACHMENT_ENTITIES = ("release", "epic", "feature", "requirement", "doc")


def _recast_attachment_entity_check(entities: tuple[str, ...]) -> None:
    values = ",".join(f"'{e}'" for e in entities)
    op.drop_constraint('ck_board_attachments_entity_type', 'board_attachments', type_='check')
    op.create_check_constraint(
        'ck_board_attachments_entity_type', 'board_attachments', f"entity_type IN ({values})"
    )


def upgrade() -> None:
    op.add_column(
        'board_feedback', sa.Column('severity', sa.String(length=16), nullable=False, server_default='medium')
    )
    op.create_check_constraint(
        'ck_board_feedback_severity', 'board_feedback', "severity IN ('low','medium','high','critical')"
    )
    op.add_column(
        'board_feedback', sa.Column('page_url', sa.String(length=1024), nullable=False, server_default='')
    )
    _recast_attachment_entity_check(ATTACHMENT_ENTITIES + ("feedback",))


def downgrade() -> None:
    # The rows have to go before the constraint is re-narrowed, or ADD
    # CONSTRAINT fails validating the very rows this migration made possible.
    # This orphans the S3 objects they point at: downgrade is a development
    # path here, not a production one.
    op.execute("DELETE FROM board_attachments WHERE entity_type = 'feedback'")
    _recast_attachment_entity_check(ATTACHMENT_ENTITIES)
    op.drop_constraint('ck_board_feedback_severity', 'board_feedback', type_='check')
    op.drop_column('board_feedback', 'page_url')
    op.drop_column('board_feedback', 'severity')
