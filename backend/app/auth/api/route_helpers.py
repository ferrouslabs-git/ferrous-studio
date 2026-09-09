from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..models.user import User
from ..models.invitation import Invitation
from ..schemas.invitation import (
    InvitationCreateRequest,
    InvitationCreateResponse,
    InvitationResendResponse,
    InvitationRevokeResponse,
)
from ..security import ScopeContext, TenantContext, has_platform_permission
from ..services.audit_service import log_audit_event
from ..services.auth_config_loader import get_auth_config
from ..services.cognito_admin_service import create_invited_cognito_user_async
from ..services.email_service import send_invitation_email
from ..services.invitation_service import (
    LEGACY_TO_V3,
    PLATFORM_ROLE,
    PLATFORM_SCOPE,
    create_invitation,
    resend_invitation,
    revoke_invitation,
)

import logging

_logger = logging.getLogger(__name__)


def ensure_scope_access(scope_id: UUID, ctx: ScopeContext) -> None:
    if scope_id != ctx.scope_id and not ctx.is_super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Scope mismatch")


def ensure_invitation_authority(invitation: Invitation, ctx: ScopeContext) -> None:
    """Require authority to resend or revoke this particular invitation.

    ``members:manage`` (the organisation admin) covers every invitation in the
    scope. ``members:invite`` alone -- what an otherwise read-only member
    holds -- covers only the invitations that member sent themselves, so one
    member cannot revoke or re-issue another's.

    A 404 rather than a 403: someone who may not act on an invitation has no
    business learning it exists, and the list this is reached from is
    membership-wide.
    """
    if ctx.is_super_admin or ctx.has_permission("members:manage"):
        return
    if invitation.created_by != ctx.user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitation not found")


# DEPRECATED: Use ensure_scope_access. Remove after 2026-05-20.
def ensure_tenant_access(tenant_id: UUID, ctx: TenantContext) -> None:
    if tenant_id != ctx.tenant_id and not ctx.is_platform_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")


async def ensure_platform_admin(
    current_user: User, action: str, db: AsyncSession, permission: str = "accounts:manage"
) -> None:
    """Require an active platform-scope role granting `permission`.

    Resolved from a real Membership row (see PLATFORM_SCOPE_ID / has_platform_
    permission in ../security/dependencies.py) rather than the old
    ``current_user.is_platform_admin`` boolean -- these platform-level routes
    sit outside get_scope_context entirely (it only ever resolves an
    "account" scope), so they need their own permission check.
    """
    if not await has_platform_permission(db, current_user, permission):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Only platform administrators can {action} user accounts",
        )


def ensure_not_self_target(target_user_id: UUID, current_user: User, action: str = "suspend") -> None:
    if current_user.id == target_user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"You cannot {action} your own account",
        )


def build_user_status_response(user: User, message: str, suspended_at: str | None):
    return {
        "user_id": str(user.id),
        "email": user.email,
        "is_platform_admin": user.is_platform_admin,
        "is_active": user.is_active,
        "suspended_at": suspended_at,
        "archived_at": user.archived_at.isoformat() if user.archived_at else None,
        "message": message,
    }


async def create_invitation_response(
    db: AsyncSession,
    tenant_id: UUID | None,
    invite_data: InvitationCreateRequest,
    current_user: User,
    ctx: ScopeContext | None = None,
) -> InvitationCreateResponse:
    """Create an invitation, pre-create its Cognito user and email the link.

    ``tenant_id`` None with ``target_scope_type == PLATFORM_SCOPE`` is a super
    admin invitation. That combination is only reachable from the platform
    invite route: the organisation routes take the scope type from the
    request body, so it is refused here rather than trusted, or an
    organisation admin could mint themselves a super admin.
    """
    # --- Resolve scope fields (defaults from context or legacy) ---
    target_scope_type = invite_data.target_scope_type
    target_scope_id = invite_data.target_scope_id
    target_role_name = invite_data.target_role_name

    if ctx and not target_scope_type:
        target_scope_type = ctx.scope_type
    if ctx and not target_scope_id:
        target_scope_id = ctx.scope_id

    if target_scope_type == PLATFORM_SCOPE:
        if tenant_id is not None or ctx is not None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Super admin invitations are sent from the platform Users page",
            )
        await ensure_platform_admin(current_user, "create super admin", db, permission="platform:configure")
        target_scope_id = None
        target_role_name = PLATFORM_ROLE
    elif target_scope_type not in (None, "account"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only organisation invitations are supported",
        )

    # --- Invite authority check: inviter permissions must be superset of target role ---
    # This subset rule is the whole of the role restriction: an organisation
    # member holds members:invite but not data:write or members:manage, so
    # account_member and account_viewer pass and account_admin does not.
    #
    # Resolve the effective role the same way create_invitation does. Checking
    # only the explicit target_role_name would leave the legacy `role` field as
    # a way round the rule -- {"role": "admin"} with no target_role_name once
    # skipped this branch entirely and was then stored as account_admin.
    if ctx and not ctx.is_super_admin:
        effective_role_name = target_role_name or LEGACY_TO_V3.get(invite_data.role, invite_data.role)
        config = get_auth_config()
        inviter_perms = config.permissions_for_role(ctx.role_name)
        target_perms = config.permissions_for_role(effective_role_name)
        # An unknown role name resolves to an empty permission set, which is a
        # subset of anything -- refuse it rather than let it through.
        if effective_role_name not in config.permission_map or not target_perms.issubset(inviter_perms):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cannot invite with a role that has more permissions than your own",
            )

    invitation, raw_token = await create_invitation(
        db=db,
        tenant_id=tenant_id,
        email=invite_data.email,
        role=invite_data.role,
        created_by=current_user.id,
        target_scope_type=target_scope_type,
        target_scope_id=target_scope_id,
        target_role_name=target_role_name,
        name=invite_data.name,
    )

    settings = get_settings()
    invite_url = f"{settings.frontend_url}/invite/{raw_token}"

    # Pre-create the Cognito user (Cognito's own email suppressed) so the
    # invitation link can offer a set-password form and sign the invitee in
    # directly. Existing accounts are left untouched. If this fails the
    # invitation still stands: /invites/complete retries the creation.
    cognito_result = await create_invited_cognito_user_async(invitation.email)
    if "error" in cognito_result:
        _logger.warning(
            "Cognito pre-creation failed; invitation still created",
            extra={"email": invitation.email, "error": cognito_result["error"]},
        )

    email_result = await send_invitation_email(
        to_email=invitation.email,
        invite_url=invite_url,
        tenant_name=invitation.tenant.name if invitation.tenant else None,
        recipient_name=invitation.name,
    )

    await log_audit_event(
        "invitation_created",
        actor_user_id=str(current_user.id),
        db=db,
        tenant_id=str(tenant_id) if tenant_id else None,
        invited_email=invite_data.email,
        invited_role=invite_data.target_role_name or invite_data.role,
        invitation_id=str(invitation.id),
        email_sent=email_result.sent,
        email_provider=email_result.provider,
    )

    if not email_result.sent:
        await log_audit_event(
            "email_send_failed",
            actor_user_id=str(current_user.id),
            db=db,
            tenant_id=str(tenant_id) if tenant_id else None,
            target_type="invitation",
            target_id=str(invitation.id),
            to_email=invite_data.email,
            provider=email_result.provider,
            error_detail=email_result.detail,
        )

    message = "Invitation created successfully"
    if not email_result.sent:
        message = f"Invitation created; email not sent ({email_result.detail})"

    return InvitationCreateResponse(
        invitation_id=invitation.id,
        tenant_id=invitation.tenant_id,
        email=invitation.email,
        role=invitation.target_role_name,
        token=raw_token,
        expires_at=invitation.expires_at,
        message=message,
        status=invitation.status,
        email_sent=email_result.sent,
        email_detail=email_result.detail,
        target_scope_type=invitation.target_scope_type,
        target_scope_id=invitation.target_scope_id,
        target_role_name=invitation.target_role_name,
    )


async def resend_invitation_response(
    db: AsyncSession, invitation: Invitation, current_user: User
) -> InvitationResendResponse:
    """Mint a fresh token for a pending or expired invitation and email it.
    Shared by the organisation and platform resend routes, which differ only
    in how they look the invitation up."""
    try:
        invitation, raw_token = await resend_invitation(db, invitation)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    settings = get_settings()
    invite_url = f"{settings.frontend_url}/invite/{raw_token}"
    email_result = await send_invitation_email(
        to_email=invitation.email,
        invite_url=invite_url,
        tenant_name=invitation.tenant.name if invitation.tenant else None,
        recipient_name=invitation.name,
    )

    await log_audit_event(
        "invitation_resent",
        actor_user_id=str(current_user.id),
        db=db,
        tenant_id=str(invitation.tenant_id) if invitation.tenant_id else None,
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


async def revoke_invitation_response(
    db: AsyncSession, invitation: Invitation, current_user: User
) -> InvitationRevokeResponse:
    """Revoke a pending invitation; the counterpart of resend_invitation_response."""
    try:
        invitation = await revoke_invitation(db, invitation)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    await log_audit_event(
        "invitation_revoked",
        actor_user_id=str(current_user.id),
        db=db,
        tenant_id=str(invitation.tenant_id) if invitation.tenant_id else None,
        invitation_id=str(invitation.id),
        invited_email=invitation.email,
    )

    return InvitationRevokeResponse(
        invitation_id=invitation.id,
        tenant_id=invitation.tenant_id,
        status="revoked",
        message="Invitation revoked successfully",
    )