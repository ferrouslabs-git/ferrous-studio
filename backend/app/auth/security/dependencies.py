"""
Authentication dependencies for FastAPI endpoints
"""
from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import event, text, select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID

from ..database import get_db
from ..security.jwt_verifier import verify_token, verify_token_async
from ..security.tenant_context import TenantContext
from ..security.scope_context import ScopeContext
from ..services.user_service import get_user_by_cognito_sub
from ..services.auth_config_loader import get_auth_config
from ..models.membership import Membership
from ..models.user import User


# OAuth2 bearer token scheme (extracts token from Authorization header)
# auto_error=False lets optional auth dependencies handle missing headers safely.
oauth2_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db)
) -> User:
    """
    Verify JWT token and return current authenticated user.
    """
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Extract token from credentials
    token = credentials.credentials

    # Verify JWT and get payload (raises 401 if invalid).
    # Accept "id" as well as "access": the host app's existing hosted-UI login
    # sends the Cognito ID token, which we reuse (host integration, Decision 1).
    token_payload = await verify_token_async(token, allowed_token_uses=("access", "id"))

    # Load user from database
    user = await get_user_by_cognito_sub(token_payload.sub, db)
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found. Please sync your account first by calling POST /auth/sync"
        )
    
    # A suspended or archived account holds a valid Cognito token but no access.
    if user.archived_at is not None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account archived. Please contact your administrator.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account suspended. Please contact your administrator.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    return user


async def get_current_user_optional(
    credentials: HTTPAuthorizationCredentials = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db)
) -> User | None:
    """
    Optional authentication - returns User if token valid, None if missing/invalid.
    """
    if not credentials:
        return None
    
    try:
        token = credentials.credentials
        token_payload = await verify_token_async(token, allowed_token_uses=("access", "id"))
        return await get_user_by_cognito_sub(token_payload.sub, db)
    except HTTPException:
        return None


# ── Role mapping helpers ─────────────────────────────────────────

_V3_TO_LEGACY_ROLE: dict[str, str] = {
    "account_admin": "admin",
    "account_member": "member",
    "account_viewer": "viewer",
}


# ── Platform layer ────────────────────────────────────────────────
#
# The platform tier has no scope row of its own -- membership needs a
# scope_id (NOT NULL, and part of the (user_id, role_name, scope_type,
# scope_id) uniqueness constraint), so platform-scope memberships use this
# well-known sentinel rather than NULL, which would let the same platform
# role be granted to the same user twice (NULL <> NULL in a unique index).
PLATFORM_SCOPE_ID = UUID("00000000-0000-0000-0000-000000000000")


async def _resolve_platform_roles(db: AsyncSession, user_id: UUID) -> list[str]:
    """Active platform-scope role names for a user (usually 0 or 1)."""
    result = await db.execute(
        select(Membership).where(
            Membership.user_id == user_id,
            Membership.scope_type == "platform",
            Membership.scope_id == PLATFORM_SCOPE_ID,
            Membership.status == "active",
        )
    )
    return [m.role_name for m in result.scalars().all()]


async def has_platform_permission(db: AsyncSession, current_user: User, permission: str) -> bool:
    """Whether the user holds `permission` via an active platform-scope role.

    Used in place of the old blanket ``current_user.is_platform_admin``
    boolean check at platform-level routes (org creation, platform user
    management, ...) -- these sit outside get_scope_context entirely, since
    _parse_scope_headers only ever resolves an "account" scope.
    """
    roles = await _resolve_platform_roles(db, current_user.id)
    if not roles:
        return False
    config = get_auth_config()
    return any(permission in config.permissions_for_role(role) for role in roles)


# ── get_scope_context (v3.0) ─────────────────────────────────────

async def get_scope_context(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ScopeContext:
    """
    Resolve the current request's scope context (v3.0).

    Header precedence:
      1. X-Scope-Type + X-Scope-ID (v3.0); the only scope type is "account"
      2. X-Tenant-ID fallback → scope_type=account (backward compat)

    Returns:
        ScopeContext with resolved roles and permissions.

    Raises:
        HTTPException 400: Missing/invalid scope headers.
        HTTPException 403: No active membership in requested scope.
    """
    if hasattr(request.state, "scope_context"):
        return request.state.scope_context

    scope_type, scope_id = _parse_scope_headers(request)

    # Platform bypass: any active platform-scope role (admin/member/viewer
    # alike) can visit any account scope for support/visibility. is_super_admin
    # still drives the full has_permission() shortcut here, same as before --
    # what changed is that the *write* half of that bypass is now refused by
    # Postgres regardless (RLS WITH CHECK no longer honours app.is_super_admin,
    # only USING/reads do -- see the RLS platform-read-only migration), so
    # granting a platform_viewer or platform_member this same API-level
    # shortcut cannot let them write cross-organisation even though nothing
    # here itself distinguishes their role from platform_admin's.
    platform_roles = await _resolve_platform_roles(db, current_user.id)
    if platform_roles:
        config = get_auth_config()
        resolved: set[str] = set()
        for role in platform_roles:
            resolved |= config.permissions_for_role(role)
        ctx = ScopeContext(
            user_id=current_user.id,
            scope_type=scope_type,
            scope_id=scope_id,
            active_roles=platform_roles,
            resolved_permissions=resolved,
            is_super_admin=True,
        )
        request.state.scope_context = ctx
        await _set_rls_vars(db, scope_type, scope_id, is_super_admin=True)
        return ctx

    # Resolve memberships → roles → permissions
    active_roles = await _resolve_active_roles(db, current_user, scope_type, scope_id)

    if not active_roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access denied: no active membership in this {scope_type}",
        )

    config = get_auth_config()
    resolved: set[str] = set()
    for role in active_roles:
        resolved |= config.permissions_for_role(role)

    ctx = ScopeContext(
        user_id=current_user.id,
        scope_type=scope_type,
        scope_id=scope_id,
        active_roles=active_roles,
        resolved_permissions=resolved,
        is_super_admin=False,
    )
    request.state.scope_context = ctx
    await _set_rls_vars(db, scope_type, scope_id, is_super_admin=False)
    return ctx


def _parse_scope_headers(request: Request) -> tuple[str, UUID]:
    """Extract and validate scope type/id from request headers."""
    scope_type = request.headers.get("X-Scope-Type")
    scope_id_str = request.headers.get("X-Scope-ID")

    # Fallback: X-Tenant-ID → account scope
    if not scope_type:
        tenant_id_str = request.headers.get("X-Tenant-ID")
        if tenant_id_str:
            scope_type = "account"
            scope_id_str = tenant_id_str

    if not scope_type or not scope_id_str:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Scope headers required: X-Scope-Type + X-Scope-ID, or X-Tenant-ID",
        )

    if scope_type != "account":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid X-Scope-Type: '{scope_type}'. Must be 'account'.",
        )

    try:
        scope_id = UUID(scope_id_str)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid scope ID format. Must be a valid UUID.",
        ) from exc

    return scope_type, scope_id


async def _resolve_active_roles(
    db: AsyncSession,
    current_user: User,
    scope_type: str,
    scope_id: UUID,
) -> list[str]:
    """Query memberships and resolve active role names for the requested scope."""
    result = await db.execute(
        select(Membership).where(
            Membership.user_id == current_user.id,
            Membership.scope_type == scope_type,
            Membership.scope_id == scope_id,
            Membership.status == "active",
        )
    )
    return [m.role_name for m in result.scalars().all()]


async def _set_rls_vars(
    db: AsyncSession,
    scope_type: str,
    scope_id: UUID,
    is_super_admin: bool,
) -> None:
    """Set PostgreSQL RLS session variables for row-level security."""
    # For async sessions, check dialect via the engine
    dialect_name = db.bind.dialect.name if db.bind else None
    if dialect_name != "postgresql":
        return

    # set_config(..., is_local=true) rather than SET LOCAL: PostgreSQL's SET
    # grammar only accepts literals, and asyncpg sends bind parameters through
    # unchanged, so "SET LOCAL x = $1" is a syntax error. set_config is a
    # normal function call, takes parameters, and is transaction-scoped in the
    # same way -- it never leaks onto a pooled connection.
    flag = "true" if is_super_admin else "false"
    stmts = [
        (text("SELECT set_config('app.current_scope_type', :st, true)"), {"st": scope_type}),
        (text("SELECT set_config('app.current_scope_id', :sid, true)"), {"sid": str(scope_id)}),
        (text("SELECT set_config('app.is_super_admin', :sa, true)"), {"sa": flag}),
        # Backward compat: existing RLS policies use these variables
        (text("SELECT set_config('app.current_tenant_id', :tid, true)"), {"tid": str(scope_id)}),
        (text("SELECT set_config('app.is_platform_admin', :ia, true)"), {"ia": flag}),
    ]

    for stmt, params in stmts:
        await db.execute(stmt, params)

    # is_local=true means these vars vanish the moment this transaction ends --
    # by design, so they never leak onto a pooled connection a later, unrelated
    # request might reuse. But several routes commit mid-request (e.g. an
    # add()+commit()+refresh() to pick up server-generated defaults), and
    # AsyncSession auto-begins a new transaction the instant the next
    # statement runs on it. That new transaction starts with none of these
    # vars set, so RLS's USING clause matches nothing and the refresh (or any
    # later query) sees zero rows -- e.g. SQLAlchemy's
    # "Could not refresh instance" on a create that just committed fine.
    # Re-apply the same vars at the start of every later transaction this
    # session opens, for as long as this request's session is alive: no route
    # has to know this happens or remember to re-set anything itself.
    @event.listens_for(db.sync_session, "after_begin")
    def _reapply_rls_vars(session, transaction, connection) -> None:
        for stmt, params in stmts:
            connection.execute(stmt, params)


# ──────────────────────────────────────────────────────────────────
# DEPRECATED — thin wrapper around get_scope_context.
# TODO: Remove after 2026-05-20 (60 days from v3.0 release).
# ──────────────────────────────────────────────────────────────────

async def get_tenant_context(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TenantContext:
    """DEPRECATED: Use get_scope_context instead. Remove after 2026-05-20."""
    if hasattr(request.state, "tenant_context"):
        return request.state.tenant_context

    scope_ctx = await get_scope_context(request, current_user, db)

    role = None
    if scope_ctx.active_roles:
        role = _V3_TO_LEGACY_ROLE.get(scope_ctx.active_roles[0])

    ctx = TenantContext(
        user_id=scope_ctx.user_id,
        tenant_id=scope_ctx.scope_id,
        role=role,
        is_platform_admin=scope_ctx.is_super_admin,
    )
    request.state.tenant_context = ctx
    return ctx
