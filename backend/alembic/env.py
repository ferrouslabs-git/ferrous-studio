import os
import sys
from logging.config import fileConfig
from pathlib import Path

from sqlalchemy import engine_from_config, pool, text

from alembic import context

# Make the backend package importable (alembic may run from anywhere).
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.config import get_settings  # noqa: E402
from app.database import Base  # noqa: E402
import app.auth.models  # noqa: E402,F401  (tenants/spaces/users/sessions/...)
import app.studio.models  # noqa: E402,F401  (projects/pages/versions/op batches)

config = context.config

# Resolve the DB URL from app settings (DATABASE_URL env), overriding the
# placeholder in alembic.ini. Allow ALEMBIC_DATABASE_URL to take precedence for
# one-off targets (e.g. pointing migrations at staging from a local shell).
db_url = os.getenv("ALEMBIC_DATABASE_URL") or get_settings().database_url
if not db_url:
    raise RuntimeError(
        "No database URL: set DATABASE_URL (or ALEMBIC_DATABASE_URL) before running alembic."
    )
config.set_main_option("sqlalchemy.url", db_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        # A migration maintains the whole database; it is never acting for one
        # organisation, so it must not be filtered by the per-account RLS
        # policies (see 7c41e2a9d0b3 for their shape, which read this same
        # setting as their escape hatch).
        #
        # Without this a data migration silently does nothing on a real
        # deployment. The app roles are plain LOGIN roles and every studio
        # table runs FORCE ROW LEVEL SECURITY, so an UPDATE with no scope set
        # matches zero rows and reports success -- while DDL in the same
        # migration (ADD CONSTRAINT, SET NOT NULL) still validates every row
        # and fails on the data the UPDATE was meant to fix. That asymmetry is
        # what makes it dangerous: it fails loudly only when a constraint
        # happens to follow, and quietly corrupts the rest of the time. It
        # cannot be caught locally either, where the dev database connects as
        # a superuser and RLS never applies (a1f6c3e8b472 passed here and
        # failed on staging for exactly this reason, 2026-09-21).
        connection.execute(text("SELECT set_config('app.is_super_admin', 'true', false)"))
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
