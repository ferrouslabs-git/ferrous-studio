from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db

from ..models.user import User
from ..config import get_settings
from ..schemas.invitation import (
    InvitationAcceptRequest,
    InvitationAcceptResponse,
    InvitationCompleteRequest,
    InvitationCompleteResponse,
    InvitationCreateRequest,
    InvitationCreateResponse,
    InvitationPreviewResponse,
    InvitationResendResponse,
    InvitationRevokeResponse,
)
from ..security import ScopeContext, get_current_user, require_permission
from ..services.audit_service import log_audit_event
from ..services.email_service import send_invitation_email
from ..services.invitation_service import (
    InvitationSignupError,
    accept_invitation,
    complete_invitation_signup,
    invitation_account_state,
    get_invitation_by_id,
    get_invitation_by_token,
    get_tenant_invitation_by_token,
    resend_invitation,
    revoke_invitation,
)
from .route_helpers import create_invitation_response, ensure_scope_access

router = APIRouter()


@router.post("/invite", response_model=InvitationCreateResponse)
async def invite_user_to_tenant(
    invite_data: InvitationCreateRequest,
    ctx: ScopeContext = Depends(require_permission("members:invite")),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create an invitation for a user to join the current scope."""
    return await create_invitation_response(db, ctx.scope_id, invite_data, current_user, ctx)


@router.post("/tenants/{tenant_id}/invite", response_model=InvitationCreateResponse)
async def invite_user_to_explicit_tenant(
    tenant_id: UUID,
    invite_data: InvitationCreateRequest,
    ctx: ScopeContext = Depends(require_permission("members:invite")),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create an invitation using explicit tenant path parameter."""
    ensure_scope_access(tenant_id, ctx)
    return await create_invitation_response(db, tenant_id, invite_data, current_user, ctx)


@router.get("/invites/{token}", response_model=InvitationPreviewResponse)
async def preview_invitation(token: str, db: AsyncSession = Depends(get_db)):
    """Get invitation details by token for pre-accept preview."""
    invitation = await get_invitation_by_token(db, token)
    if not invitation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitation not found")

    return InvitationPreviewResponse(
        token=token,
        tenant_id=invitation.tenant_id,
        tenant_name=invitation.tenant.name,
        email=invitation.email,
        name=invitation.name,
        role=invitation.target_role_name,
        expires_at=invitation.expires_at,
        status=invitation.status,
        is_expired=invitation.is_expired,
        is_accepted=invitation.is_accepted,
        account_state=await invitation_account_state(invitation.email),
    )


@router.post("/invites/complete", response_model=InvitationCompleteResponse)
async def complete_invitation_token(
    payload: InvitationCompleteRequest,
    db: AsyncSession = Depends(get_db),
):
    """Public: set the invitee's password, sign them in and accept the invitation.

    This is the landing action of the emailed invitation link. For an address
    that already has an account it sets the new password (the link proves
    ownership, like a reset link); a visitor already signed in as the invitee
    uses /invites/accept instead.
    """
    invitation = await get_invitation_by_token(db, payload.token)
    if not invitation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitation not found")

    try:
        membership, user, tokens = await complete_invitation_signup(db, invitation, payload.password)
    except InvitationSignupError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc

    await log_audit_event(
        "invitation_accepted",
        actor_user_id=str(user.id),
        db=db,
        tenant_id=str(invitation.tenant_id),
        invitation_id=str(invitation.id),
        role=membership.role_name,
        via="set_password",
    )

    return InvitationCompleteResponse(
        tenant_id=invitation.tenant_id,
        role=membership.role_name,
        email=user.email,
        access_token=tokens["access_token"],
        id_token=tokens["id_token"],
        refresh_token=tokens.get("refresh_token"),
        expires_in=int(tokens.get("expires_in") or 3600),
        message="Account created and invitation accepted",
    )


@router.delete("/tenants/{tenant_id}/invites/{token}", response_model=InvitationRevokeResponse)
async def revoke_tenant_invitation(
    tenant_id: UUID,
    token: str,
    ctx: ScopeContext = Depends(require_permission("members:invite")),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Revoke a pending invitation token for a tenant (admin+)."""
    ensure_scope_access(tenant_id, ctx)
    invitation = await get_tenant_invitation_by_token(db, tenant_id, token)
    if not invitation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitation not found")

    try:
        invitation = await revoke_invitation(db, invitation)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    await log_audit_event(
        "invitation_revoked",
        actor_user_id=str(current_user.id),
        db=db,
        tenant_id=str(tenant_id),
        invitation_id=str(invitation.id),
        invited_email=invitation.email,
    )

    return InvitationRevokeResponse(
        invitation_id=invitation.id,
        tenant_id=invitation.tenant_id,
        status="revoked",
        message="Invitation revoked successfully",
    )


@router.post("/tenants/{tenant_id}/invites/{token}/resend", response_model=InvitationResendResponse)
async def resend_tenant_invitation(
    tenant_id: UUID,
    token: str,
    ctx: ScopeContext = Depends(require_permission("members:invite")),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Resend a pending or expired invitation with a fresh token and email."""
    ensure_scope_access(tenant_id, ctx)
    invitation = await get_tenant_invitation_by_token(db, tenant_id, token)
    if not invitation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitation not found")

    try:
        invitation, raw_token = await resend_invitation(db, invitation)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    settings = get_settings()
    invite_url = f"{settings.frontend_url}/invite/{raw_token}"
    email_result = await send_invitation_email(
        to_email=invitation.email,
        invite_url=invite_url,
        tenant_name=invitation.tenant.name,
    )

    await log_audit_event(
        "invitation_resent",
        actor_user_id=str(current_user.id),
        db=db,
        tenant_id=str(tenant_id),
        invitation_id=str(invitation.id),
        invited_email=invitation.email,
        email_sent=email_result.sent,
    )

    message = "Invitation resent successfully"
    if not email_result.sent:
        message = f"Invitation renewed; email not sent ({email_result.detail})"

    return InvitationResendResponse(
        invitation_id=invitation.id,
        tenant_id=invitation.tenant_id,
        email=invitation.email,
        token=raw_token,
        expires_at=invitation.expires_at,
        message=message,
        status=invitation.status,
        email_sent=email_result.sent,
        email_detail=email_result.detail,
    )


@router.post("/tenants/{tenant_id}/invitations/{invitation_id}/resend", response_model=InvitationResendResponse)
async def resend_invitation_by_id(
    tenant_id: UUID,
    invitation_id: UUID,
    ctx: ScopeContext = Depends(require_permission("members:invite")),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Resend a pending or expired invitation looked up by row ID (admin+)."""
    ensure_scope_access(tenant_id, ctx)
    invitation = await get_invitation_by_id(db, tenant_id, invitation_id)
    if not invitation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitation not found")

    try:
        invitation, raw_token = await resend_invitation(db, invitation)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    settings = get_settings()
    invite_url = f"{settings.frontend_url}/invite/{raw_token}"
    email_result = await send_invitation_email(
        to_email=invitation.email,
        invite_url=invite_url,
        tenant_name=invitation.tenant.name,
    )

    await log_audit_event(
        "invitation_resent",
        actor_user_id=str(current_user.id),
        db=db,
        tenant_id=str(tenant_id),
        invitation_id=str(invitation.id),
        invited_email=invitation.email,
        email_sent=email_result.sent,
    )

    message = "Invitation resent successfully"
    if not email_result.sent:
        message = f"Invitation renewed; email not sent ({email_result.detail})"

    return InvitationResendResponse(
        invitation_id=invitation.id,
        tenant_id=invitation.tenant_id,
        email=invitation.email,
        token=raw_token,
        expires_at=invitation.expires_at,
        message=message,
        status=invitation.status,
        email_sent=email_result.sent,
        email_detail=email_result.detail,
    )


@router.post("/invites/accept", response_model=InvitationAcceptResponse)
async def accept_invitation_token(
    payload: InvitationAcceptRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Accept an invitation token for the authenticated user."""
    invitation = await get_invitation_by_token(db, payload.token)
    if not invitation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitation not found")

    try:
        membership = await accept_invitation(db, invitation, current_user)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc

    await log_audit_event(
        "invitation_accepted",
        actor_user_id=str(current_user.id),
        db=db,
        tenant_id=str(invitation.tenant_id),
        invitation_id=str(invitation.id),
        role=membership.role_name,
    )

    return InvitationAcceptResponse(
        tenant_id=invitation.tenant_id,
        role=membership.role_name,
        message="Invitation accepted successfully",
        scope_type=membership.scope_type,
        scope_id=membership.scope_id,
        role_name=membership.role_name,
    )

@router.delete("/tenants/{tenant_id}/invitations/{invitation_id}", response_model=InvitationRevokeResponse)
async def revoke_invitation_by_id(
    tenant_id: UUID,
    invitation_id: UUID,
    ctx: ScopeContext = Depends(require_permission("members:invite")),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Revoke a pending invitation looked up by row ID (admin+).

    The invitation list endpoint deliberately never returns tokens, so a UI
    working from that list needs an ID-addressed revoke to pair with the
    ID-addressed resend above.
    """
    ensure_scope_access(tenant_id, ctx)
    invitation = await get_invitation_by_id(db, tenant_id, invitation_id)
    if not invitation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitation not found")

    try:
        invitation = await revoke_invitation(db, invitation)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    await log_audit_event(
        "invitation_revoked",
        actor_user_id=str(current_user.id),
        db=db,
        tenant_id=str(tenant_id),
        invitation_id=str(invitation.id),
        invited_email=invitation.email,
    )

    return InvitationRevokeResponse(
        invitation_id=invitation.id,
        tenant_id=invitation.tenant_id,
        status="revoked",
        message="Invitation revoked successfully",
    )
