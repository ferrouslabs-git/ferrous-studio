"""SQLAlchemy foundation, shared by every module (app/auth/, app/example/, and
whatever domain code you add). One declarative ``Base`` so Alembic autogenerate
sees every table.

Two engines share the same DATABASE_URL:

* **sync** — for any code (scripts, sync repositories) that wants a plain
  blocking session.
* **async** — used by app/auth/ (``db: AsyncSession = Depends(get_db)``) and
  recommended for new feature code too.

The sync stack uses psycopg3 (``postgresql+psycopg://``); the async stack uses
asyncpg (``postgresql+asyncpg://``), derived from the same DATABASE_URL.
asyncpg is used for async because psycopg's async mode is incompatible with the
default Windows event loop, whereas asyncpg is not.

Unlike processmapper (one shared database across dev/staging/prod, selected via
a DB_SCHEMA-driven Postgres schema + search_path), this template follows the
newer one-database-per-environment pattern documented in
infra/docs/onboarding-runbook.md: DATABASE_URL alone selects the environment,
so there is no schema/search_path pinning here — everything lives in `public`.
"""
from __future__ import annotations

from collections.abc import AsyncIterator, Iterator

from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings

_settings = get_settings()
_url = _settings.database_url


def _async_url(url: str) -> str:
    """Translate the sync DATABASE_URL to its asyncpg form."""
    if not url:
        return url
    if "+psycopg" in url:
        return url.replace("+psycopg", "+asyncpg")
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


class Base(DeclarativeBase):
    """Declarative base shared by every ORM model (app/auth/ + app/example/ + yours)."""


# ── sync stack ────────────────────────────────────────────────────────────
# create_engine opens no connection until first use, so building at import is
# safe. With no DATABASE_URL set, everything stays None and only fails loudly
# if a session is actually requested.
#
# Pool sizes: the RDS role backing DATABASE_URL is created with
# CONNECTION LIMIT 20 (infra/terraform/scripts/create-rds-roles.sh). A rolling
# deploy runs the replacement task before draining the old one, so two tasks'
# pools are live at once — this must stay comfortably under 20 even doubled.
# get_sync_db is unused in-container (only backend/scripts/bootstrap_admin.py
# uses SessionLocal, standalone), so this is cheap insurance rather than load
# capacity: pool_size=2, max_overflow=2 (4 per task, 8 across a deploy overlap).
sync_engine = (
    create_engine(_url, pool_pre_ping=True, pool_size=2, max_overflow=2, future=True) if _url else None
)
SessionLocal = (
    sessionmaker(bind=sync_engine, autoflush=False, expire_on_commit=False, future=True)
    if sync_engine is not None
    else None
)

# ── async stack (app/auth/, and recommended for new feature code) ─────────
# pool_size=4, max_overflow=4 (8 per task, 16 across a deploy overlap, headroom
# under the role's CONNECTION LIMIT 20). Note RateLimitMiddleware
# (app/main.py) opens its own session per request via this same engine, so an
# /api/um/* request holds two concurrent checkouts, not one.
async_engine = (
    create_async_engine(_async_url(_url), pool_pre_ping=True, pool_size=4, max_overflow=4, future=True)
    if _url
    else None
)
AsyncSessionLocal = (
    async_sessionmaker(bind=async_engine, expire_on_commit=False, class_=AsyncSession)
    if async_engine is not None
    else None
)

# app/auth/database.py imports ``engine`` paired with ``AsyncSessionLocal``.
engine = async_engine


def get_sync_db() -> Iterator[Session]:
    """Sync session dependency (always closed)."""
    if SessionLocal is None:
        raise RuntimeError(
            "DATABASE_URL is not configured but a Postgres session was requested."
        )
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


async def get_db() -> AsyncIterator[AsyncSession]:
    """Async session dependency used by app/auth/ and app/example/."""
    if AsyncSessionLocal is None:
        raise RuntimeError(
            "DATABASE_URL is not configured but an async Postgres session was requested."
        )
    async with AsyncSessionLocal() as session:
        yield session
