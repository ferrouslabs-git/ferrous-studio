from datetime import datetime
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db

from ..models.user import User
from ..schemas.audit import AuditActor, OrgAuditEventRead, OrgAuditPage
from ..schemas.user_management import (
    RemoveUserResponse,
    TenantUserResponse,
    UpdateTenantUserRequest,
    UpdateUserRoleRequest,
    UpdateUserRoleResponse,
)
from ..security import ScopeContext, require_permission
from ..services.audit_service import log_audit_event, org_audit_query
from ..services.user_management_service import (
    list_tenant_users,
    reactivate_user_in_tenant,
    remove_user_from_tenant,
    update_tenant_user_name,
    update_user_role,
)
from .route_helpers import ensure_scope_access

router = APIRouter()


@router.get("/tenants/{tenant_id}/users", response_model=List[TenantUserResponse])
async def get_tenant_users(
    tenant_id: UUID,
    role: str | None = Query(None, description="Filter by role name (e.g. account_admin, account_member)"),
    user_status: str | None = Query(None, alias="status", description="Filter by membership status: active, removed, or all"),
    ctx: ScopeContext = Depends(require_permission("account:read")),
    db: AsyncSession = Depends(get_db),
):
    """List users in tenant. Supports ?role= and ?status= filters."""
    ensure_scope_access(tenant_id, ctx)
    return await list_tenant_users(db, tenant_id, role=role, status_filter=user_status)


@router.patch("/tenants/{tenant_id}/users/{user_id}", response_model=UpdateUserRoleResponse)
async def patch_tenant_user(
    tenant_id: UUID,
    user_id: UUID,
    payload: UpdateTenantUserRequest,
    ctx: ScopeContext = Depends(require_permission("members:manage")),
    db: AsyncSession = Depends(get_db),
):
    """Edit a member's name and/or role in one call (admin+)."""
    ensure_scope_access(tenant_id, ctx)
    fields = payload.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nothing to update")

    membership = None
    if "name" in fields:
        membership = await update_tenant_user_name(db, tenant_id, user_id, fields["name"])
        if not membership:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found in tenant")

    if fields.get("role") is not None:
        try:
            membership = await update_user_role(
                db,
                tenant_id,
                user_id,
                fields["role"],
                actor_role=ctx.active_roles[0] if ctx.active_roles else None,
                actor_is_platform_admin=ctx.is_super_admin,
            )
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        if not membership:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found in tenant")

    await log_audit_event(
        "tenant_user_updated",
        actor_user_id=str(ctx.user_id),
        db=db,
        tenant_id=str(tenant_id),
        target_user_id=str(user_id),
        fields=sorted(fields.keys()),
    )

    return UpdateUserRoleResponse(
        user_id=membership.user_id,
        tenant_id=tenant_id,
        role=membership.role_name,
        message="User updated successfully",
    )


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


@router.get("/tenants/{tenant_id}/audit-events", response_model=OrgAuditPage)
async def list_org_audit_events(
    tenant_id: UUID,
    limit: int = Query(50, ge=1, le=200),
    before: datetime | None = None,
    action: str | None = None,
    ctx: ScopeContext = Depends(require_permission("audit:read")),
    db: AsyncSession = Depends(get_db),
) -> OrgAuditPage:
    """This organisation's history: memberships, invitations, GitHub.

    ``audit_events`` has no RLS (platform rows have a NULL ``tenant_id``, and
    the platform listing runs without scope variables), so ``ensure_scope_access``
    plus the ``tenant_id`` filter inside ``org_audit_query`` are the only thing
    standing between an admin and another organisation's log -- see the tests
    that pin the query.

    ``ip_address`` is deliberately not returned here; the platform-level
    listing keeps it.
    """
    ensure_scope_access(tenant_id, ctx)
    stmt = org_audit_query(tenant_id, before=before, action=action, limit=limit)
    rows = list((await db.execute(stmt)).scalars().all())
    has_more = len(rows) > limit
    rows = rows[:limit]

    actor_ids = {row.actor_user_id for row in rows if row.actor_user_id}
    actors: dict[UUID, User] = {}
    if actor_ids:
        found = (await db.execute(select(User).where(User.id.in_(actor_ids)))).scalars().all()
        actors = {user.id: user for user in found}

    events = [
        OrgAuditEventRead(
            id=row.id,
            action=row.action,
            actor=(
                AuditActor(
                    id=row.actor_user_id,
                    name=actors[row.actor_user_id].name if row.actor_user_id in actors else None,
                    email=actors[row.actor_user_id].email if row.actor_user_id in actors else None,
                )
                if row.actor_user_id
                else None
            ),
            target_type=row.target_type,
            target_id=row.target_id,
            metadata=row.metadata_json or {},
            timestamp=row.timestamp,
        )
        for row in rows
    ]
    return OrgAuditPage(
        events=events,
        has_more=has_more,
        next_before=rows[-1].timestamp if rows and has_more else None,
    )