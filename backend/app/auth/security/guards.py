"""
Permission-based authorization guards (v3.0)

Guards are FastAPI dependencies that enforce permissions via ScopeContext.
The new pattern checks resolved_permissions rather than role name strings.

New guards (use these) — depend on get_scope_context, return ScopeContext:
    require_permission(perm)         — single permission check
    require_any_permission(perms)    — any one of listed permissions
    require_all_permissions(perms)   — all listed permissions
    require_super_admin              — is_super_admin only

Deprecated guards (60-day window → remove after 2026-05-20):
    require_role, require_min_role   — role-name based (emit DeprecationWarning)
    require_owner/admin/member/viewer — use legacy bridge, return TenantContext

Example Usage:
    @router.delete("/users/{user_id}")
    async def remove_user(
        ctx: ScopeContext = Depends(require_permission("members:manage")),
        db: Session = Depends(get_db),
    ):
        ...
"""
import warnings
from typing import Callable

from fastapi import Depends, HTTPException, status

from .scope_context import ScopeContext
from .tenant_context import TenantContext
from .dependencies import get_scope_context, get_tenant_context


# ── New permission-based guards ──────────────────────────────────


def require_permission(permission: str) -> Callable:
    """Require a single permission in the caller's ScopeContext."""
    def checker(ctx: ScopeContext = Depends(get_scope_context)) -> ScopeContext:
        if not ctx.has_permission(permission):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required permission: {permission}",
            )
        return ctx
    return checker


def require_any_permission(permissions: list[str]) -> Callable:
    """Require at least one of the listed permissions."""
    def checker(ctx: ScopeContext = Depends(get_scope_context)) -> ScopeContext:
        if not ctx.has_any_permission(permissions):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required one of: {', '.join(permissions)}",
            )
        return ctx
    return checker


def require_all_permissions(permissions: list[str]) -> Callable:
    """Require all of the listed permissions."""
    def checker(ctx: ScopeContext = Depends(get_scope_context)) -> ScopeContext:
        if not ctx.has_all_permissions(permissions):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required all of: {', '.join(permissions)}",
            )
        return ctx
    return checker


def require_super_admin(ctx: ScopeContext = Depends(get_scope_context)) -> ScopeContext:
    """Require is_super_admin (platform admin)."""
    if not ctx.is_super_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Super admin required.",
        )
    return ctx


# ── Compatibility bridge (deprecated guards only) ────────────────
# Translates legacy TenantContext → ScopeContext with hardcoded permissions.
# Used only by deprecated guards below. New guards use get_scope_context directly.

_LEGACY_ROLE_PERMISSIONS: dict[str, set[str]] = {
    "owner": {
        "account:delete", "account:read", "spaces:create",
        "members:manage", "members:invite",
        "data:read", "data:write",
    },
    "admin": {
        "account:read", "spaces:create",
        "members:manage", "members:invite",
        "data:read", "data:write",
    },
    "member": {
        "account:read",
        "data:read", "data:write",
    },
    "viewer": {
        "account:read",
        "data:read",
    },
}


def _bridge_to_scope(ctx: TenantContext) -> ScopeContext:
    """Build a minimal ScopeContext from a legacy TenantContext."""
    return ScopeContext(
        user_id=ctx.user_id,
        scope_type="account",
        scope_id=ctx.tenant_id,
        active_roles=[ctx.role] if ctx.role else [],
        resolved_permissions=_LEGACY_ROLE_PERMISSIONS.get(ctx.role, set()) if ctx.role else set(),
        is_super_admin=ctx.is_platform_admin,
    )


# ── Deprecated guards ────────────────────────────────────────────
# ──────────────────────────────────────────────────────────────────
# DEPRECATED — 60-day migration window.
# TODO: Remove after 2026-05-20 (60 days from v3.0 release 2026-03-20).
# After that date, delete everything below this line.
# ──────────────────────────────────────────────────────────────────

# Role hierarchy for comparison (used only by deprecated require_min_role)
ROLE_HIERARCHY = {
    "owner": 4,
    "admin": 3,
    "member": 2,
    "viewer": 1,
}


def require_role(*allowed_roles: str) -> Callable:
    """DEPRECATED: Use require_permission() instead. Remove after 2026-05-20."""
    def role_checker(ctx: TenantContext = Depends(get_tenant_context)) -> TenantContext:
        warnings.warn(
            "require_role() is deprecated. Use require_permission() instead.",
            DeprecationWarning, stacklevel=2,
        )
        if ctx.is_platform_admin:
            return ctx
        if ctx.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required role: {' or '.join(allowed_roles)}. Your role: {ctx.role}",
            )
        return ctx
    return role_checker


def require_min_role(min_role: str) -> Callable:
    """DEPRECATED: Use require_permission() instead. Remove after 2026-05-20."""
    if min_role not in ROLE_HIERARCHY:
        raise ValueError(f"Invalid role: {min_role}. Must be one of: {', '.join(ROLE_HIERARCHY.keys())}")

    min_level = ROLE_HIERARCHY[min_role]

    def role_checker(ctx: TenantContext = Depends(get_tenant_context)) -> TenantContext:
        warnings.warn(
            f"require_min_role('{min_role}') is deprecated. Use require_permission() instead.",
            DeprecationWarning, stacklevel=2,
        )
        if ctx.is_platform_admin:
            return ctx
        user_level = ROLE_HIERARCHY.get(ctx.role, 0)
        if user_level < min_level:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required minimum role: {min_role}. Your role: {ctx.role}",
            )
        return ctx
    return role_checker


def _deprecated_guard(permission: str, old_name: str) -> Callable:
    """Create a deprecated convenience guard that wraps require_permission logic."""
    def wrapper(ctx: TenantContext = Depends(get_tenant_context)) -> TenantContext:
        warnings.warn(
            f"{old_name} is deprecated. Use require_permission('{permission}') instead.",
            DeprecationWarning, stacklevel=2,
        )
        scope = _bridge_to_scope(ctx)
        if not scope.has_permission(permission) and not scope.is_super_admin:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required permission: {permission}",
            )
        return ctx
    return wrapper


require_owner = _deprecated_guard("account:delete", "require_owner")
require_admin = _deprecated_guard("members:manage", "require_admin")
require_member = _deprecated_guard("data:write", "require_member")
require_viewer = _deprecated_guard("data:read", "require_viewer")


def check_permission(ctx: TenantContext, permission: str) -> bool:
    """DEPRECATED: Use ScopeContext.has_permission() instead. Remove after 2026-05-20."""
    warnings.warn(
        "check_permission() is deprecated. Use ScopeContext.has_permission() instead.",
        DeprecationWarning, stacklevel=2,
    )
    scope = _bridge_to_scope(ctx)
    return scope.has_permission(permission)
