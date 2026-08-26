from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db

from ..models.audit_event import AuditEvent
from ..models.user import User
from ..schemas.tenant import PlatformTenantResponse, TenantStatusResponse
from ..security import get_current_user
from ..services.audit_service import list_audit_events, log_audit_event
from ..services.cleanup_service import run_cleanup
from ..services.tenant_service import delete_tenant, list_platform_tenants, suspend_tenant, unsuspend_tenant
from .route_helpers import ensure_platform_admin

router = APIRouter()


@router.get("/platform/tenants", response_model=list[PlatformTenantResponse])
async def get_platform_tenants(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all tenants across the platform (super admin only)."""
    ensure_platform_admin(current_user, "view tenants")
    return await list_platform_tenants(db)


@router.patch("/platform/tenants/{tenant_id}/suspend", response_model=TenantStatusResponse)
async def suspend_tenant_account(
    tenant_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Suspend a tenant (super admin only)."""
    ensure_platform_admin(current_user, "suspend tenant")

    try:
        tenant = await suspend_tenant(tenant_id, db)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    await log_audit_event(
        "tenant_suspended",
        actor_user_id=str(current_user.id),
        db=db,
        tenant_id=str(tenant.id),
        tenant_name=tenant.name,
    )

    return TenantStatusResponse(
        tenant_id=tenant.id,
        status=tenant.status,
        message="Tenant suspended successfully",
    )


@router.patch("/platform/tenants/{tenant_id}/unsuspend", response_model=TenantStatusResponse)
async def unsuspend_tenant_account(
    tenant_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Unsuspend a tenant (super admin only)."""
    ensure_platform_admin(current_user, "unsuspend tenant")

    try:
        tenant = await unsuspend_tenant(tenant_id, db)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    await log_audit_event(
        "tenant_unsuspended",
        actor_user_id=str(current_user.id),
        db=db,
        tenant_id=str(tenant.id),
        tenant_name=tenant.name,
    )

    return TenantStatusResponse(
        tenant_id=tenant.id,
        status=tenant.status,
        message="Tenant unsuspended successfully",
    )


@router.get("/platform/invitations/failed")
async def get_failed_invitation_emails(
    limit: int = Query(50, ge=1, le=200),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List recent invitation email failures (platform admin only).

    Returns audit events where ``action == 'email_send_failed'``,
    ordered by most recent first.
    """
    ensure_platform_admin(current_user, "view failed invitation emails")

    result = await db.execute(
        select(AuditEvent)
        .where(AuditEvent.action == "email_send_failed")
        .order_by(AuditEvent.timestamp.desc())
        .limit(limit)
    )
    events = result.scalars().all()

    return [
        {
            "id": str(e.id),
            "timestamp": e.timestamp.isoformat() if e.timestamp else None,
            "tenant_id": str(e.tenant_id) if e.tenant_id else None,
            "invitation_id": (e.metadata_json or {}).get("target_id"),
            "to_email": (e.metadata_json or {}).get("to_email"),
            "provider": (e.metadata_json or {}).get("provider"),
            "error_detail": (e.metadata_json or {}).get("error_detail"),
        }
        for e in events
    ]


# ── Audit event query ────────────────────────────────────────────


@router.get("/platform/audit-events")
async def query_audit_events(
    action: str | None = Query(None, description="Filter by action name"),
    actor_user_id: str | None = Query(None, description="Filter by actor UUID"),
    tenant_id: str | None = Query(None, description="Filter by tenant UUID"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Query audit events with optional filters (platform admin only)."""
    ensure_platform_admin(current_user, "query audit events")
    return await list_audit_events(
        db,
        action=action,
        actor_user_id=actor_user_id,
        tenant_id=tenant_id,
        limit=limit,
        offset=offset,
    )


# ── Admin cleanup ────────────────────────────────────────────────


@router.post("/platform/cleanup")
async def trigger_cleanup(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Trigger cleanup of expired tokens, invitations, and rate-limit hits (platform admin only)."""
    ensure_platform_admin(current_user, "trigger cleanup")

    result = await run_cleanup(db)
    await db.commit()

    await log_audit_event(
        "platform_cleanup_triggered",
        actor_user_id=str(current_user.id),
        db=db,
        refresh_tokens=result.refresh_tokens,
        invitations=result.invitations,
        rate_limit_hits=result.rate_limit_hits,
        audit_events=result.audit_events,
    )

    return {
        "message": "Cleanup completed",
        "removed": {
            "refresh_tokens": result.refresh_tokens,
            "invitations": result.invitations,
            "rate_limit_hits": result.rate_limit_hits,
            "audit_events": result.audit_events,
        },
    }


# ── Permanent tenant deletion ────────────────────────────────────


@router.delete("/platform/tenants/{tenant_id}")
async def delete_tenant_permanently(
    tenant_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Permanently delete a tenant and all associated data (platform admin only). Irreversible."""
    ensure_platform_admin(current_user, "delete tenant")

    try:
        result = await delete_tenant(tenant_id, db)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    await log_audit_event(
        "tenant_permanently_deleted",
        actor_user_id=str(current_user.id),
        db=db,
        tenant_id=str(tenant_id),
        tenant_name=result["name"],
    )

    return {
        "tenant_id": result["tenant_id"],
        "name": result["name"],
        "message": "Tenant permanently deleted",
    }
