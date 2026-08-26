import os
import sys
from logging.config import fileConfig
from pathlib import Path

from sqlalchemy import engine_from_config, pool

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
