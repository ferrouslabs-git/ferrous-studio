from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db

from ..models.user import User
from ..schemas.invitation import (
    BulkInvitationCreateRequest,
    BulkInvitationCreateResponse,
    BulkInvitationResultItem,
    InvitationCreateRequest,
)
from ..schemas.tenant import (
    TenantCreateRequest,
    TenantCreateResponse,
    TenantDetailResponse,
    TenantInvitationListResponse,
    TenantListResponse,
    TenantUpdateRequest,
)
from ..security import ScopeContext, get_current_user, get_scope_context, has_platform_permission, require_permission
from ..services.audit_service import log_audit_event
from .route_helpers import create_invitation_response, ensure_scope_access
from ..services.invitation_service import create_invitation, list_tenant_invitations
from ..services.tenant_service import (
    create_tenant,
    get_tenant_by_id,
    get_user_tenants,
    update_tenant,
    verify_user_tenant_access,
)

router = APIRouter()


@router.post("/tenants", response_model=TenantCreateResponse)
async def create_new_tenant(
    tenant_data: TenantCreateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Create a new tenant (organisation).

    Platform admins only: organisations are invite-only, so a platform admin
    creates the organisation and invites its owner. Checked directly via
    has_platform_permission rather than the require_permission dependency
    because that resolves an "account" scope from X-Scope-* headers, and
    there is no scope yet when the organisation itself is being created.
    Creator will be assigned 'owner' role automatically.
    """
    if not await has_platform_permission(db, current_user, "accounts:manage"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only platform administrators can create organisations",
        )

    tenant = await create_tenant(
        name=tenant_data.name,
        user=current_user,
        db=db,
    )

    await log_audit_event(
        "tenant_created",
        actor_user_id=str(current_user.id),
        db=db,
        tenant_id=str(tenant.id),
        tenant_name=tenant.name,
    )

    return TenantCreateResponse(
        tenant_id=tenant.id,
        name=tenant.name,
        role="owner",
        message="Tenant created successfully",
    )


@router.get("/tenants/my", response_model=List[TenantListResponse])
async def get_my_tenants(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get all tenants that the current user belongs to."""
    return await get_user_tenants(current_user.id, db)


@router.get("/tenant-context")
async def get_tenant_context_info(ctx: ScopeContext = Depends(get_scope_context)):
    """Test endpoint for scope/tenant-context middleware and role resolution."""
    return {
        "user_id": str(ctx.user_id),
        "tenant_id": str(ctx.scope_id),
        "scope_type": ctx.scope_type,
        "scope_id": str(ctx.scope_id),
        "active_roles": ctx.active_roles,
        "role": ctx.active_roles[0] if ctx.active_roles else None,
        "is_platform_admin": ctx.is_super_admin,
        "message": "Tenant context validated successfully",
    }


# ── Single tenant detail ────────────────────────────────────────


@router.get("/tenants/{tenant_id}", response_model=TenantDetailResponse)
async def get_tenant_detail(
    tenant_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get details for a single tenant. Requires membership or platform admin."""
    if not await has_platform_permission(db, current_user, "accounts:read") and not await verify_user_tenant_access(current_user.id, tenant_id, db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this tenant")

    tenant = await get_tenant_by_id(tenant_id, db)
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")

    from ..models.membership import Membership
    active_memberships = [m for m in tenant.memberships if m.status == "active"]
    member_count = len(active_memberships)
    admin_count = sum(1 for m in active_memberships if m.role_name in ("account_admin", "admin"))

    return TenantDetailResponse(
        id=tenant.id,
        name=tenant.name,
        status=tenant.status,
        created_at=tenant.created_at,
        updated_at=tenant.updated_at,
        member_count=member_count,
        admin_count=admin_count,
    )


# ── Update tenant ────────────────────────────────────────────────


@router.patch("/tenants/{tenant_id}", response_model=TenantDetailResponse)
async def update_tenant_detail(
    tenant_id: UUID,
    payload: TenantUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update the organisation's name. Requires account_admin role or platform admin."""
    if not await has_platform_permission(db, current_user, "accounts:manage"):
        from ..services.tenant_service import get_user_tenant_role
        role = await get_user_tenant_role(current_user.id, tenant_id, db)
        if role not in ("account_admin", "admin"):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only organisation admins or platform admins can update organisation details",
            )

    if payload.name is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A name must be provided",
        )

    try:
        tenant = await update_tenant(tenant_id, db, name=payload.name)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    await log_audit_event(
        "tenant_updated",
        actor_user_id=str(current_user.id),
        db=db,
        tenant_id=str(tenant.id),
        updated_fields={k: v for k, v in payload.model_dump().items() if v is not None},
    )

    from ..models.membership import Membership
    active_memberships = [m for m in tenant.memberships if m.status == "active"]
    member_count = len(active_memberships)
    admin_count = sum(1 for m in active_memberships if m.role_name in ("account_admin", "admin"))

    return TenantDetailResponse(
        id=tenant.id,
        name=tenant.name,
        status=tenant.status,
        created_at=tenant.created_at,
        updated_at=tenant.updated_at,
        member_count=member_count,
        admin_count=admin_count,
    )


# ── List tenant invitations ─────────────────────────────────────


@router.get("/tenants/{tenant_id}/invitations", response_model=list[TenantInvitationListResponse])
async def list_invitations_for_tenant(
    tenant_id: UUID,
    status_filter: str | None = Query(None, alias="status", description="Filter by status: pending, accepted, expired, revoked"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List invitations for a tenant. Requires membership or platform admin."""
    if not await has_platform_permission(db, current_user, "accounts:read") and not await verify_user_tenant_access(current_user.id, tenant_id, db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this tenant")

    try:
        return await list_tenant_invitations(db, tenant_id, status_filter=status_filter)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


# ── Bulk invite ──────────────────────────────────────────────────


@router.post(
    "/tenants/{tenant_id}/invitations/bulk",
    response_model=BulkInvitationCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def bulk_create_invitations(
    tenant_id: UUID,
    payload: BulkInvitationCreateRequest,
    ctx: ScopeContext = Depends(require_permission("members:invite")),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Send up to 50 invitations in one request.

    Same authorisation as the single-invite endpoint: `members:invite` in the
    active scope, and each target role must be a subset of the inviter's own
    permissions (enforced inside create_invitation_response).
    """
    ensure_scope_access(tenant_id, ctx)

    results: list[BulkInvitationResultItem] = []
    for item in payload.invitations:
        try:
            invite_data = InvitationCreateRequest(
                email=item.email,
                role=item.role,
                target_role_name=item.target_role_name,
            )
            resp = await create_invitation_response(db, tenant_id, invite_data, current_user, ctx)
            results.append(BulkInvitationResultItem(email=item.email, success=True, invitation_id=resp.invitation_id))
        except HTTPException as exc:
            results.append(BulkInvitationResultItem(email=item.email, success=False, error=str(exc.detail)))
        except Exception as exc:
            results.append(BulkInvitationResultItem(email=item.email, success=False, error=str(exc)))

    succeeded = sum(1 for r in results if r.success)
    return BulkInvitationCreateResponse(
        tenant_id=tenant_id,
        total=len(results),
        succeeded=succeeded,
        failed=len(results) - succeeded,
        results=results,
    )