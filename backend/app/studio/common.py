"""Helpers shared by the studio routers.

Every route is scoped to an *organisation* via X-Scope-Type/X-Scope-ID and
guarded by ``data:read`` / ``data:write``. Every query filters by
``ctx.scope_id`` explicitly, and the tables also carry row-level-security
policies keyed on the same value -- two layers, always.
"""
import secrets
from typing import Any, Callable
from uuid import UUID

from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.database import get_db
from app.auth.security.dependencies import get_current_user, get_scope_context
from app.auth.security.scope_context import ScopeContext

from .board.agents import TOKEN_PREFIX, require_board_token
from .board.models import Board
from .models import Project, ProjectPage, Wireframe
from .positions import FIRST_KEY, key_after

FIRST_POS = FIRST_KEY


#: The first region of a wireframe's shell page holds the navigation; every
#: other page is content until something names it. Mirrors the frontend's
#: SHELL_REGION_LABEL / DEFAULT_REGION_LABEL (model/tree.ts).
SHELL_REGION_LABEL = "Nav"
DEFAULT_REGION_LABEL = "Content"


def default_page_document(label: str = DEFAULT_REGION_LABEL) -> dict[str, Any]:
    """A blank page: one named region filling the screen, ready to be split.

    Mirrors the frontend's blankDocument (model/tree.ts) — keep them in step.
    Clients that know what links to the page send their own document with the
    region already named after it ("Users > Edit"); this is the fallback.
    """
    region_id = f"r-{secrets.token_hex(4)}"
    return {
        "root": {"kind": "region", "id": region_id, "label": label, "size": {"fr": 1}},
        "regions": {region_id: []},
    }


async def get_project(db: AsyncSession, project_id: UUID, ctx: ScopeContext) -> Project:
    result = await db.execute(select(Project).where(Project.id == project_id, Project.account_id == ctx.scope_id))
    project = result.scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    if ctx.board_id is not None:
        # A board token is scoped to exactly one project's board at mint
        # time (ctx.board_id, set only on that path -- see board/agents.py).
        # Without this, the account_id-only filter above would let the same
        # token reach every other project in the account too -- board
        # routes already confine themselves via board/routes.py's _board(),
        # but every route resolving a project through here needs the same
        # confinement now that a board token can reach beyond board
        # endpoints (require_studio_permission, below).
        board = (await db.execute(select(Board).where(Board.id == ctx.board_id))).scalar_one_or_none()
        if board is None or board.lineage_id != project.lineage_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Board token is not valid for this project"
            )
    return project


async def get_writable_project(db: AsyncSession, project_id: UUID, ctx: ScopeContext) -> Project:
    """A project that may be edited, i.e. one that is not a frozen version.

    Versioning a project locks the version it was taken from, so it stays a
    faithful record of what was agreed; unlocking is explicit. 423 rather than
    409 because this is a real lock with an affordance to release it, and
    because 409 already means an op conflict, a diagram version conflict and
    "archive it first" elsewhere in this API -- the studio outbox and the
    diagram editor both branch on it.

    Every route that writes something belonging to a project resolves it
    through here rather than ``get_project``; ``tests/test_lock_coverage.py``
    holds the list of deliberate exceptions.
    """
    project = await get_project(db, project_id, ctx)
    if project.locked_at is not None:
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail="This version is locked. Unlock it to make changes.",
        )
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


async def get_wireframe_page(
    db: AsyncSession, ctx: ScopeContext, wireframe_id: UUID, page_id: UUID, lock: bool = False
) -> ProjectPage:
    stmt = select(ProjectPage).where(
        ProjectPage.id == page_id,
        ProjectPage.wireframe_id == wireframe_id,
        ProjectPage.account_id == ctx.scope_id,
    )
    if lock:
        # FOR NO KEY UPDATE, not FOR UPDATE: no key columns change, and the
        # stronger lock would block unrelated inserts referencing this row.
        stmt = stmt.with_for_update(key_share=True)
    page = (await db.execute(stmt)).scalar_one_or_none()
    if page is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Page not found")
    return page


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


async def adopt_account_scope(db: AsyncSession, account_id: UUID) -> None:
    """Run this transaction as one organisation, with no scope headers.

    Only the OAuth-style callback needs this. It arrives as a top-level browser
    navigation, so it carries neither a bearer token nor X-Scope-ID, and the
    scope dependencies that normally set these variables never run -- leaving
    the studio tables reading as empty and refusing every insert.

    The organisation therefore comes from the signed ``state`` the callback
    carries, which is why that signature is checked *before* this is called.
    Transaction-local, like ``allow_cross_account``.
    """
    if db.bind and db.bind.dialect.name == "postgresql":
        await db.execute(text("SELECT set_config('app.current_scope_type', 'account', true)"))
        await db.execute(text("SELECT set_config('app.current_scope_id', :sid, true)"), {"sid": str(account_id)})
        await db.execute(text("SELECT set_config('app.is_super_admin', 'false', true)"))
        # Backward compat: older policies read these names (see _set_rls_vars).
        await db.execute(text("SELECT set_config('app.current_tenant_id', :tid, true)"), {"tid": str(account_id)})
        await db.execute(text("SELECT set_config('app.is_platform_admin', 'false', true)"))


def require_studio_permission(permission: str) -> Callable:
    """Accept EITHER a human Cognito login OR a board token, resolving to the
    same narrowly-permissioned ScopeContext either way -- board tokens exist
    specifically for a non-browser client (an MCP server, an agent) that
    will never have a Cognito session. Originally board-route-only
    (board/auth.py's require_board_permission); moved here once a board
    token needed to reach wireframe/diagram routes too, not just board
    ones -- get_project's own board_id check above is what actually keeps a
    token confined to the one project it was minted for.
    """

    async def checker(
        request: Request,
        authorization: str | None = Header(None),
        db: AsyncSession = Depends(get_db),
    ) -> ScopeContext:
        raw = ""
        if authorization and authorization.lower().startswith("bearer "):
            raw = authorization.split(None, 1)[1].strip()

        if raw.startswith(TOKEN_PREFIX):
            ctx, token = await require_board_token(authorization=authorization, db=db)
            if not ctx.has_permission(permission):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Access denied. Required permission: {permission}",
                )
            ctx.board_id = token.board_id
            ctx.board_token_id = token.id
            return ctx

        # Human path: the same two steps get_current_user/get_scope_context
        # normally run as, called directly rather than through Depends() so
        # this one dependency can choose between the two auth schemes --
        # FastAPI resolves a route's dependency tree once, before the route
        # body runs, so there's no way to make oauth2_scheme itself
        # conditional on what the header looks like.
        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=raw) if raw else None
        current_user = await get_current_user(credentials=credentials, db=db)
        ctx = await get_scope_context(request=request, current_user=current_user, db=db)
        if not ctx.has_permission(permission):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required permission: {permission}",
            )
        return ctx

    return checker


async def next_pos(db: AsyncSession, model: Any, *filters: Any) -> str:
    """An ordering key after the last row matching ``filters``."""
    last = (await db.execute(select(func.max(model.pos)).where(*filters))).scalar_one_or_none()
    return key_after(last)
