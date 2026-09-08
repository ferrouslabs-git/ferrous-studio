"""Board route auth: accept EITHER a human Cognito login OR a board token,
resolving to the same narrowly-permissioned ScopeContext either way.

This is what closes the gap Phase 3 shipped with: a board token could be
minted, but nothing accepted it -- every board route required a Cognito
JWT regardless. board_tokens exist specifically for a non-browser client
(an MCP server, an agent) that will never have one.

Deliberately not a change to require_permission itself, which every other
route in the app (personas, documents, ...) also depends on -- a board
token must only ever unlock board:read/board:write on board routes, never
anything else. See ScopeContext.board_id: set only on the token path, and
checked in routes.py's _board() against the actual resolved board so a
token minted for one project can never reach another.
"""
from __future__ import annotations

from typing import Callable

from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.database import get_db
from app.auth.security.dependencies import get_current_user, get_scope_context
from app.auth.security.scope_context import ScopeContext

from .agents import TOKEN_PREFIX, require_board_token


def require_board_permission(permission: str) -> Callable:
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
