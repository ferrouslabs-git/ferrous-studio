from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db

from ..schemas.user_management import (
    RemoveUserResponse,
    TenantUserResponse,
    UpdateUserRoleRequest,
    UpdateUserRoleResponse,
)
from ..security import ScopeContext, require_permission
from ..services.audit_service import log_audit_event
from ..services.user_management_service import (
    list_tenant_users,
    reactivate_user_in_tenant,
    remove_user_from_tenant,
    update_user_role,
)
from .route_helpers import ensure_scope_access

router = APIRouter()


@router.get("/tenants/{tenant_id}/users", response_model=List[TenantUserResponse])
async def get_tenant_users(
    tenant_id: UUID,
    role: str | None = Query(None, description="Filter by role name (e.g. account_owner, account_admin)"),
    user_status: str | None = Query(None, alias="status", description="Filter by membership status: active, removed"),
    ctx: ScopeContext = Depends(require_permission("account:read")),
    db: AsyncSession = Depends(get_db),
):
    """List users in tenant. Supports ?role= and ?status= filters."""
    ensure_scope_access(tenant_id, ctx)
    return await list_tenant_users(db, tenant_id, role=role, status_filter=user_status)


@router.patch("/tenants/{tenant_id}/users/{user_id}/role", response_model=UpdateUserRoleResponse)
async def patch_tenant_user_role(
    tenant_id: UUID,
    user_id: UUID,
    payload: UpdateUserRoleRequest,
    ctx: ScopeContext = Depends(require_permission("members:manage")),
    db: AsyncSession = Depends(get_db),
):
    """Update user's tenant role (admin+)."""
    ensure_scope_access(tenant_id, ctx)
    try:
        membership = await update_user_role(
            db,
            tenant_id,
            user_id,
            payload.role,
            actor_role=ctx.active_roles[0] if ctx.active_roles else None,
            actor_is_platform_admin=ctx.is_super_admin,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found in tenant")

    await log_audit_event(
        "tenant_user_role_updated",
        actor_user_id=str(ctx.user_id),
        db=db,
        tenant_id=str(tenant_id),
        target_user_id=str(user_id),
        new_role=payload.role,
    )

    return UpdateUserRoleResponse(
        user_id=membership.user_id,
        tenant_id=tenant_id,
        role=membership.role_name,
        message="User role updated successfully",
    )


@router.delete("/tenants/{tenant_id}/users/{user_id}", response_model=RemoveUserResponse)
async def delete_tenant_user(
    tenant_id: UUID,
    user_id: UUID,
    ctx: ScopeContext = Depends(require_permission("members:manage")),
    db: AsyncSession = Depends(get_db),
):
    """Soft-remove user from tenant (admin+)."""
    ensure_scope_access(tenant_id, ctx)
    try:
        membership = await remove_user_from_tenant(db, tenant_id, user_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found in tenant")

    await log_audit_event(
        "tenant_user_removed",
        actor_user_id=str(ctx.user_id),
        db=db,
        tenant_id=str(tenant_id),
        target_user_id=str(user_id),
        resulting_status=membership.status,
    )

    return RemoveUserResponse(
        user_id=membership.user_id,
        tenant_id=tenant_id,
        status=membership.status,
        message="User removed from tenant",
    )


# ── Deactivate / Reactivate membership ───────────────────────────


@router.patch("/tenants/{tenant_id}/users/{user_id}/deactivate", response_model=RemoveUserResponse)
async def deactivate_tenant_user(
    tenant_id: UUID,
    user_id: UUID,
    ctx: ScopeContext = Depends(require_permission("members:manage")),
    db: AsyncSession = Depends(get_db),
):
    """Deactivate a user's membership in this tenant (admin+). Same as soft-remove."""
    ensure_scope_access(tenant_id, ctx)
    try:
        membership = await remove_user_from_tenant(db, tenant_id, user_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found in tenant")

    await log_audit_event(
        "tenant_user_deactivated",
        actor_user_id=str(ctx.user_id),
        db=db,
        tenant_id=str(tenant_id),
        target_user_id=str(user_id),
    )

    return RemoveUserResponse(
        user_id=membership.user_id,
        tenant_id=tenant_id,
        status=membership.status,
        message="User deactivated in tenant",
    )


@router.patch("/tenants/{tenant_id}/users/{user_id}/reactivate", response_model=RemoveUserResponse)
async def reactivate_tenant_user(
    tenant_id: UUID,
    user_id: UUID,
    ctx: ScopeContext = Depends(require_permission("members:manage")),
    db: AsyncSession = Depends(get_db),
):
    """Reactivate a previously deactivated user's membership (admin+)."""
    ensure_scope_access(tenant_id, ctx)
    membership = await reactivate_user_in_tenant(db, tenant_id, user_id)

    if not membership:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No deactivated membership found for this user in tenant",
        )

    await log_audit_event(
        "tenant_user_reactivated",
        actor_user_id=str(ctx.user_id),
        db=db,
        tenant_id=str(tenant_id),
        target_user_id=str(user_id),
    )

    return RemoveUserResponse(
        user_id=membership.user_id,
        tenant_id=tenant_id,
        status=membership.status,
        message="User reactivated in tenant",
    )