"""connect a project to a GitHub repository

Two parts. ``github_installations`` records an organisation's GitHub App
installation -- one row per organisation, carrying the public installation id
and nothing secret (tokens are minted per request from the App's private key,
which lives in the environment). It takes the standard studio RLS policy keyed
on ``account_id`` (see ``b7e2c4d9a1f3``), so one organisation can never read
another's connection.

The rest hangs off ``projects``: which repository this project is being built
into. ``repo_id`` is the durable identity -- a repository can be renamed or
transferred and only the numeric id survives -- with the full name cached
beside it so the details page renders without calling GitHub. No branch is
stored: branches are GitHub's to manage, and a copy here would only go stale.

Nothing is backfilled: every existing project is simply unlinked.

Revision ID: c8a3f5d1e746
Revises: b6e1d3a9f724
Create Date: 2026-09-07
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c8a3f5d1e746'
down_revision: Union[str, None] = 'b6e1d3a9f724'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

RLS_POLICY = """
CREATE POLICY github_installations_scope ON github_installations
    USING (
        current_setting('app.is_super_admin', true) = 'true'
        OR account_id::text = current_setting('app.current_scope_id', true)
    )
    WITH CHECK (
        current_setting('app.is_super_admin', true) = 'true'
        OR account_id::text = current_setting('app.current_scope_id', true)
    )
"""


def upgrade() -> None:
    op.create_table(
        'github_installations',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('account_id', sa.UUID(), nullable=False),
        sa.Column('installation_id', sa.BigInteger(), nullable=False),
        sa.Column('account_login', sa.String(length=255), nullable=True),
        sa.Column('account_type', sa.String(length=32), nullable=True),
        sa.Column('repository_selection', sa.String(length=16), nullable=True),
        sa.Column('connected_by', sa.UUID(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['account_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['connected_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        # One installation per organisation: reconnecting updates this row
        # rather than leaving two rows and no rule for which one wins.
        sa.UniqueConstraint('account_id', name='uq_github_installations_account'),
    )
    op.execute("ALTER TABLE github_installations ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE github_installations FORCE ROW LEVEL SECURITY")
    op.execute(RLS_POLICY)

    op.add_column('projects', sa.Column('repo_id', sa.BigInteger(), nullable=True))
    op.add_column('projects', sa.Column('repo_full_name', sa.String(length=255), nullable=True))
    op.add_column('projects', sa.Column('repo_linked_at', sa.DateTime(), nullable=True))
    op.add_column('projects', sa.Column('repo_linked_by', sa.UUID(), nullable=True))
    op.create_foreign_key(
        'fk_projects_repo_linked_by_users', 'projects', 'users', ['repo_linked_by'], ['id'], ondelete='SET NULL'
    )


def downgrade() -> None:
    op.drop_constraint('fk_projects_repo_linked_by_users', 'projects', type_='foreignkey')
    op.drop_column('projects', 'repo_linked_by')
    op.drop_column('projects', 'repo_linked_at')
    op.drop_column('projects', 'repo_full_name')
    op.drop_column('projects', 'repo_id')
    op.drop_table('github_installations')
