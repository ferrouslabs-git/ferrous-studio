from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..models.user import User
from ..schemas.invitation import InvitationCreateRequest, InvitationCreateResponse
from ..security import ScopeContext, TenantContext
from ..services.audit_service import log_audit_event
from ..services.auth_config_loader import get_auth_config
from ..services.email_service import send_invitation_email
from ..services.invitation_service import create_invitation

import logging

_logger = logging.getLogger(__name__)


def ensure_scope_access(scope_id: UUID, ctx: ScopeContext) -> None:
    if scope_id != ctx.scope_id and not ctx.is_super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Scope mismatch")


# DEPRECATED: Use ensure_scope_access. Remove after 2026-05-20.
def ensure_tenant_access(tenant_id: UUID, ctx: TenantContext) -> None:
    if tenant_id != ctx.tenant_id and not ctx.is_platform_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")


def ensure_platform_admin(current_user: User, action: str) -> None:
    if not current_user.is_platform_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Only platform administrators can {action} user accounts",
        )


def ensure_not_self_target(target_user_id: UUID, current_user: User) -> None:
    if current_user.id == target_user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot suspend your own account",
        )


def build_user_status_response(user: User, message: str, suspended_at: str | None):
    return {
        "user_id": str(user.id),
        "email": user.email,
        "is_platform_admin": user.is_platform_admin,
        "is_active": user.is_active,
        "suspended_at": suspended_at,
        "message": message,
    }


async def create_invitation_response(
    db: AsyncSession,
    tenant_id: UUID,
    invite_data: InvitationCreateRequest,
    current_user: User,
    ctx: ScopeContext | None = None,
) -> InvitationCreateResponse:
    # --- Resolve scope fields (defaults from context or legacy) ---
    target_scope_type = invite_data.target_scope_type
    target_scope_id = invite_data.target_scope_id
    target_role_name = invite_data.target_role_name

    if ctx and not target_scope_type:
        target_scope_type = ctx.scope_type
    if ctx and not target_scope_id:
        target_scope_id = ctx.scope_id

    # --- Invite authority check: inviter permissions must be superset of target role ---
    if target_role_name and ctx and not ctx.is_super_admin:
        config = get_auth_config()
        inviter_perms = config.permissions_for_role(ctx.role_name)
        target_perms = config.permissions_for_role(target_role_name)
        if not target_perms.issubset(inviter_perms):
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
    )

    settings = get_settings()
    invite_url = f"{settings.frontend_url}/invite/{raw_token}"

    # In custom_ui mode, pre-create the user in Cognito so the frontend
    # can show a "set password" form instead of the Hosted UI signup page.
    if settings.auth_mode == "custom_ui":
        from ..services.cognito_admin_service import create_invited_cognito_user_async
        cognito_result = await create_invited_cognito_user_async(invitation.email)
        if "error" in cognito_result:
            _logger.warning(
                "Cognito pre-creation failed; invitation still created",
                extra={"email": invitation.email, "error": cognito_result["error"]},
            )

    email_result = await send_invitation_email(
        to_email=invitation.email,
        invite_url=invite_url,
        tenant_name=invitation.tenant.name,
    )

    await log_audit_event(
        "invitation_created",
        actor_user_id=str(current_user.id),
        db=db,
        tenant_id=str(tenant_id),
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
            tenant_id=str(tenant_id),
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