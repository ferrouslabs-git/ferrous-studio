"""Helpers shared by the studio routers.

Every route is scoped to an *organisation* via X-Scope-Type/X-Scope-ID and
guarded by ``data:read`` / ``data:write``. Every query filters by
``ctx.scope_id`` explicitly, and the tables also carry row-level-security
policies keyed on the same value -- two layers, always.
"""
import secrets
from typing import Any
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.security.scope_context import ScopeContext

from .models import Project, Wireframe
from .positions import FIRST_KEY, key_after

FIRST_POS = FIRST_KEY


def default_page_document() -> dict[str, Any]:
    """A blank page: one region filling the screen, ready to be split."""
    region_id = f"r-{secrets.token_hex(4)}"
    return {
        "root": {"kind": "region", "id": region_id, "size": {"fr": 1}},
        "regions": {region_id: []},
    }


async def get_project(db: AsyncSession, project_id: UUID, ctx: ScopeContext) -> Project:
    result = await db.execute(select(Project).where(Project.id == project_id, Project.account_id == ctx.scope_id))
    project = result.scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


async def get_wireframe(db: AsyncSession, project: Project, wireframe_id: UUID) -> Wireframe:
    result = await db.execute(
        select(Wireframe).where(
            Wireframe.id == wireframe_id,
            Wireframe.project_id == project.id,
            Wireframe.account_id == project.account_id,
        )
    )
    wireframe = result.scalar_one_or_none()
    if wireframe is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Wireframe not found")
    return wireframe


async def allow_cross_account(db: AsyncSession) -> None:
    """Let this transaction read rows belonging to every organisation.

    The studio tables run ``FORCE ROW LEVEL SECURITY`` and their policies admit
    a row when ``account_id`` matches ``app.current_scope_id`` *or* when
    ``app.is_super_admin`` is true. Only the scope dependencies set those, so a
    platform route that skips this silently reads an empty table -- it is not an
    error, just no rows. Transaction-local, like ``_set_rls_vars``.
    """
    if db.bind and db.bind.dialect.name == "postgresql":
        await db.execute(text("SELECT set_config('app.is_super_admin', 'true', true)"))


async def next_pos(db: AsyncSession, model: Any, *filters: Any) -> str:
    """An ordering key after the last row matching ``filters``."""
    last = (await db.execute(select(func.max(model.pos)).where(*filters))).scalar_one_or_none()
    return key_after(last)
