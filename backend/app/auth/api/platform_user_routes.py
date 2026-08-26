from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db

from ..models.user import User
from ..schemas.user_management import PlatformUserResponse
from ..security import get_current_user
from ..services.audit_service import log_audit_event
from ..services.user_service import (
    delete_user,
    demote_from_platform_admin,
    get_user_by_id,
    promote_to_platform_admin,
    suspend_user,
    unsuspend_user,
)
from ..services.cognito_admin_service import (
    admin_delete_user_by_username_async,
    admin_disable_user_async,
    admin_enable_user_async,
    admin_get_user_async,
    admin_link_provider_for_user_async,
    list_users_by_email_async,
    admin_reset_user_password_async,
)
from ..services.user_management_service import list_platform_users
from .route_helpers import build_user_status_response, ensure_not_self_target, ensure_platform_admin

router = APIRouter()

def _get_attr(user_obj: dict, name: str) -> str | None:
    for a in user_obj.get("Attributes") or []:
        if a.get("Name") == name:
            return a.get("Value")
    return None


@router.post("/platform/users/{user_id}/cognito/consolidate")
async def consolidate_federated_user(
    user_id: UUID,
    confirm_delete_federated: bool = Query(
        False,
        description="If true, deletes the existing federated (google_*/microsoft_*) user profile before linking (destructive).",
    ),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Consolidate a federated user into a local profile using AdminLinkProviderForUser.

    Follows AWS guidance: if the federated profile already exists, linking typically requires deleting it first.
    This endpoint is platform-admin only and is intended for controlled migrations.
    """
    ensure_platform_admin(current_user, "consolidate Cognito identities for")

    user = await get_user_by_id(user_id, db)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    listed = await list_users_by_email_async(user.email, limit=20)
    if "error" in listed:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=listed["error"])

    users = listed.get("users") or []
    if not users:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No Cognito users found for this email")

    federated = None
    local = None
    for u in users:
        uname = u.get("Username") or ""
        identities = _get_attr(u, "identities")
        if identities and (uname.startswith("google_") or uname.startswith("microsoft_")):
            federated = u
        if not identities and uname and uname == _get_attr(u, "sub"):
            # native/local profile tends to have Username == sub UUID
            local = u

    if not federated:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No federated (SSO) Cognito user found to consolidate")
    if not local:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No local/native Cognito user found for this email (create one first)")

    import json as _json
    identities_raw = _get_attr(federated, "identities") or "[]"
    try:
        identities = _json.loads(identities_raw)
    except Exception:
        identities = []
    if not isinstance(identities, list) or not identities or not isinstance(identities[0], dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Federated user identities attribute is missing or invalid")

    provider_name = identities[0].get("providerName")
    provider_user_id = identities[0].get("userId")
    if not provider_name or not provider_user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Federated identity missing providerName/userId")

    destination_username = local.get("Username")
    federated_username = federated.get("Username")

    if not confirm_delete_federated:
        return {
            "ok": False,
            "message": "Dry run. Set confirm_delete_federated=true to perform deletion + link.",
            "email": user.email,
            "destination_username": destination_username,
            "federated_username": federated_username,
            "provider_name": provider_name,
            "provider_user_id": provider_user_id,
        }

    # 1) Delete federated profile (AWS doc requirement for post-first-signin linking)
    del_res = await admin_delete_user_by_username_async(federated_username)
    if "error" in del_res:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=del_res["error"])

    # 2) Link provider → destination
    link_res = await admin_link_provider_for_user_async(
        destination_username=destination_username,
        provider_name=provider_name,
        provider_user_id=provider_user_id,
    )
    if "error" in link_res:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=link_res["error"])

    # 3) Update DB cognito_sub to the destination sub so future tokens map correctly.
    user.cognito_sub = _get_attr(local, "sub") or destination_username
    await db.commit()
    await db.refresh(user)

    await log_audit_event(
        "cognito_user_consolidated",
        actor_user_id=str(current_user.id),
        db=db,
        target_user_id=str(user_id),
        target_email=user.email,
    )

    return {
        "ok": True,
        "email": user.email,
        "destination_username": destination_username,
        "deleted_federated_username": federated_username,
        "linked_provider": provider_name,
        "db_cognito_sub": user.cognito_sub,
        "message": "Consolidation complete. User should sign out and sign in again.",
    }


@router.get("/platform/users", response_model=list[PlatformUserResponse])
async def get_platform_users(
    role: str | None = Query(None, description="Filter by role name (e.g. account_owner)"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all users across the platform. Supports ?role= filter (platform admin only)."""
    if not current_user.is_platform_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only platform administrators can view all users",
        )
    return await list_platform_users(db, role=role)


@router.get("/platform/users/{user_id}", response_model=PlatformUserResponse)
async def get_platform_user_detail(
    user_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get details for a single user including memberships (platform admin only)."""
    ensure_platform_admin(current_user, "view user details for")

    user = await get_user_by_id(user_id, db)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    memberships = [
        {
            "tenant_id": m.scope_id if m.scope_type == "account" else None,
            "tenant_name": m.tenant.name if m.tenant and m.scope_type == "account" else None,
            "role": m.role_name,
            "status": m.status,
            "joined_at": m.created_at,
            "scope_type": m.scope_type,
            "scope_id": m.scope_id,
        }
        for m in user.memberships
    ]

    return PlatformUserResponse(
        user_id=user.id,
        email=user.email,
        name=user.name,
        is_platform_admin=user.is_platform_admin,
        is_active=user.is_active,
        suspended_at=user.suspended_at,
        created_at=user.created_at,
        updated_at=user.updated_at,
        memberships=memberships,
    )


@router.patch("/users/{user_id}/suspend")
async def suspend_user_account(
    user_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Suspend a user account (platform admin only)."""
    ensure_platform_admin(current_user, "suspend")
    ensure_not_self_target(user_id, current_user)

    try:
        suspended_user = await suspend_user(user_id, db)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        )

    await log_audit_event(
        "user_suspended",
        actor_user_id=str(current_user.id),
        db=db,
        target_user_id=str(user_id),
        target_email=suspended_user.email,
    )

    return build_user_status_response(
        suspended_user,
        "User account suspended successfully",
        suspended_user.suspended_at.isoformat() if suspended_user.suspended_at else None,
    )


@router.patch("/users/{user_id}/unsuspend")
async def unsuspend_user_account(
    user_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Unsuspend a user account (platform admin only)."""
    ensure_platform_admin(current_user, "unsuspend")

    try:
        unsuspended_user = await unsuspend_user(user_id, db)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        )

    await log_audit_event(
        "user_unsuspended",
        actor_user_id=str(current_user.id),
        db=db,
        target_user_id=str(user_id),
        target_email=unsuspended_user.email,
    )

    return build_user_status_response(
        unsuspended_user,
        "User account unsuspended successfully",
        None,
    )


@router.patch("/platform/users/{user_id}/promote")
async def promote_platform_admin_account(
    user_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Grant platform admin access to another user (platform admin only)."""
    ensure_platform_admin(current_user, "promote")

    try:
        promoted_user = await promote_to_platform_admin(user_id, db)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc

    await log_audit_event(
        "user_promoted_to_platform_admin",
        actor_user_id=str(current_user.id),
        db=db,
        target_user_id=str(user_id),
        target_email=promoted_user.email,
    )

    return build_user_status_response(
        promoted_user,
        "Super admin access granted successfully",
        promoted_user.suspended_at.isoformat() if promoted_user.suspended_at else None,
    )


@router.patch("/platform/users/{user_id}/demote")
async def demote_platform_admin_account(
    user_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove platform admin access from another user (platform admin only)."""
    ensure_platform_admin(current_user, "demote")
    if current_user.id == user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot revoke your own super admin access",
        )

    try:
        demoted_user = await demote_from_platform_admin(user_id, db)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST if "last platform administrator" in str(exc) else status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc

    await log_audit_event(
        "user_demoted_from_platform_admin",
        actor_user_id=str(current_user.id),
        db=db,
        target_user_id=str(user_id),
        target_email=demoted_user.email,
    )

    return build_user_status_response(
        demoted_user,
        "Super admin access removed successfully",
        demoted_user.suspended_at.isoformat() if demoted_user.suspended_at else None,
    )


# ── User deletion ───────────────────────────────────────────────


@router.delete("/platform/users/{user_id}")
async def delete_platform_user(
    user_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Permanently delete a user from Cognito and the database (platform admin only).

    Removes the user from Cognito, revokes all sessions, deletes memberships,
    anonymizes invitations, and deletes the local User record. Irreversible.
    """
    ensure_platform_admin(current_user, "delete")
    ensure_not_self_target(user_id, current_user)

    try:
        result = await delete_user(user_id, db)
    except ValueError as exc:
        detail = str(exc)
        code = status.HTTP_404_NOT_FOUND
        if "platform admin" in detail or "last owner" in detail or "Cognito" in detail:
            code = status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=code, detail=detail) from exc

    await log_audit_event(
        "user_permanently_deleted",
        actor_user_id=str(current_user.id),
        db=db,
        target_user_id=str(user_id),
        target_email=result["email"],
    )

    return {
        "user_id": result["user_id"],
        "email": result["email"],
        "message": "User permanently deleted from Cognito and database",
    }


# ── Cognito admin operations ────────────────────────────────────


@router.post("/platform/users/{user_id}/cognito/disable")
async def disable_cognito_user(
    user_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Disable a user in Cognito — blocks sign-in but preserves the account (platform admin only)."""
    ensure_platform_admin(current_user, "disable Cognito account for")

    user = await get_user_by_id(user_id, db)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    result = await admin_disable_user_async(user.email)
    if "error" in result:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=result["error"])

    await log_audit_event(
        "cognito_user_disabled",
        actor_user_id=str(current_user.id),
        db=db,
        target_user_id=str(user_id),
        target_email=user.email,
    )

    return {"user_id": str(user_id), "email": user.email, "message": "Cognito account disabled"}


@router.post("/platform/users/{user_id}/cognito/enable")
async def enable_cognito_user(
    user_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Re-enable a disabled Cognito user (platform admin only)."""
    ensure_platform_admin(current_user, "enable Cognito account for")

    user = await get_user_by_id(user_id, db)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    result = await admin_enable_user_async(user.email)
    if "error" in result:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=result["error"])

    await log_audit_event(
        "cognito_user_enabled",
        actor_user_id=str(current_user.id),
        db=db,
        target_user_id=str(user_id),
        target_email=user.email,
    )

    return {"user_id": str(user_id), "email": user.email, "message": "Cognito account enabled"}


@router.get("/platform/users/{user_id}/cognito")
async def get_cognito_user_status(
    user_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Look up a user's status in Cognito (platform admin only)."""
    ensure_platform_admin(current_user, "view Cognito status for")

    user = await get_user_by_id(user_id, db)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    result = await admin_get_user_async(user.email)
    if "error" in result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=result["error"])

    return {
        "user_id": str(user_id),
        "email": user.email,
        "cognito_status": result.get("status"),
        "cognito_enabled": result.get("enabled"),
        "cognito_created_at": str(result.get("created_at")) if result.get("created_at") else None,
    }


@router.post("/platform/users/{user_id}/cognito/reset-password")
async def reset_cognito_user_password(
    user_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Force a password reset for a user — Cognito sends them a reset code (platform admin only)."""
    ensure_platform_admin(current_user, "reset password for")

    user = await get_user_by_id(user_id, db)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    result = await admin_reset_user_password_async(user.email)
    if "error" in result:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=result["error"])

    await log_audit_event(
        "cognito_password_reset_forced",
        actor_user_id=str(current_user.id),
        db=db,
        target_user_id=str(user_id),
        target_email=user.email,
    )

    return {"user_id": str(user_id), "email": user.email, "message": "Password reset initiated — user will receive a reset code via email"}