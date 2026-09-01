"""
Invitation service - token-based invitations and acceptance workflow
"""
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from secrets import token_urlsafe
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..models.invitation import Invitation
from ..models.membership import Membership
from ..models.user import User
from ..models.tenant import Tenant
from ..security.jwt_verifier import InvalidTokenError, verify_token_async
from .auth_config_loader import get_auth_config
from .cognito_admin_service import (
    admin_get_user_async,
    admin_initiate_auth_async,
    admin_set_user_password_async,
    create_invited_cognito_user_async,
)
from .user_service import sync_user_from_cognito


class InvitationSignupError(Exception):
    """A step of the set-password sign-up failed; ``detail`` is safe to show."""

    def __init__(self, detail: str, *, status_code: int = 400):
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


# Legacy role → v3 role name mapping (used to derive target_role_name from
# the legacy 'role' API field when callers haven't migrated yet).
_LEGACY_TO_V3 = {
    "owner": "account_admin",
    "admin": "account_admin",
    "member": "account_member",
    "viewer": "account_viewer",
}


def utc_now() -> datetime:
    """Return naive UTC datetime compatible with existing DB DateTime columns."""
    return datetime.now(UTC).replace(tzinfo=None)


def hash_token(token: str) -> str:
    """Return SHA256 hex digest of a token for secure storage."""
    return sha256(token.encode()).hexdigest()


async def create_invitation(
    db: AsyncSession,
    tenant_id: UUID,
    email: str,
    role: str,
    created_by: UUID,
    expires_in_days: int = 2,
    target_scope_type: str | None = None,
    target_scope_id: UUID | None = None,
    target_role_name: str | None = None,
    name: str | None = None,
) -> tuple["Invitation", str]:
    """Create a new invitation token for a user email within a tenant/scope."""
    normalized_email = email.lower().strip()
    normalized_name = (name or "").strip() or None
    now = utc_now()

    result = await db.execute(
        select(Invitation).where(
            Invitation.tenant_id == tenant_id,
            Invitation.email == normalized_email,
            Invitation.accepted_at.is_(None),
            Invitation.revoked_at.is_(None),
            Invitation.expires_at > now,
        )
    )
    existing_pending = result.scalars().all()

    for pending in existing_pending:
        pending.revoked_at = now
        pending.expires_at = now

    raw_token = token_urlsafe(32)
    hashed = hash_token(raw_token)
    resolved_scope_type = target_scope_type or "account"
    resolved_scope_id = target_scope_id or tenant_id
    resolved_role_name = target_role_name or _LEGACY_TO_V3.get(role, role)
    invitation = Invitation(
        tenant_id=tenant_id,
        email=normalized_email,
        name=normalized_name,
        token=hashed,
        token_hash=hashed,
        expires_at=now + timedelta(days=expires_in_days),
        created_by=created_by,
        target_scope_type=resolved_scope_type,
        target_scope_id=resolved_scope_id,
        target_role_name=resolved_role_name,
    )
    db.add(invitation)
    await db.commit()
    await db.refresh(invitation, attribute_names=["tenant"])
    return invitation, raw_token


async def get_invitation_by_token(db: AsyncSession, token: str) -> Invitation | None:
    """Return invitation by token hash, or None if missing."""
    token_hash = hash_token(token)
    result = await db.execute(
        select(Invitation)
        .options(selectinload(Invitation.tenant))
        .where(Invitation.token_hash == token_hash)
    )
    return result.scalar_one_or_none()


async def accept_invitation(db: AsyncSession, invitation: Invitation, user: User) -> Membership:
    """
    Accept an invitation for the authenticated user.

    Rules:
    - Invitation must not be expired
    - Invitation must not already be accepted
    - Invitation email must match current user's email
    - Membership is created or re-activated for the invitation scope
    """
    if invitation.is_expired:
        raise ValueError("Invitation has expired")

    if invitation.is_revoked:
        raise ValueError("Invitation has been revoked")

    if invitation.is_accepted:
        raise ValueError("Invitation has already been accepted")

    if invitation.email.lower().strip() != (user.email or "").lower().strip():
        raise PermissionError("Invitation email does not match authenticated user")

    # Look for existing membership in the target scope
    result = await db.execute(
        select(Membership).where(
            Membership.user_id == user.id,
            Membership.scope_type == invitation.target_scope_type,
            Membership.scope_id == invitation.target_scope_id,
        )
    )
    membership = result.scalar_one_or_none()

    role_name = invitation.target_role_name
    scope_type = invitation.target_scope_type
    scope_id = invitation.target_scope_id

    if membership:
        # Compare permission sets: never downgrade through invitation.
        config = get_auth_config()
        existing_role = membership.role_name
        existing_perms = config.permissions_for_role(existing_role)
        invited_perms = config.permissions_for_role(role_name)

        if not invited_perms.issubset(existing_perms):
            membership.role_name = role_name
            membership.scope_type = scope_type
            membership.scope_id = scope_id
        membership.status = "active"
    else:
        membership = Membership(
            user_id=user.id,
            scope_type=scope_type,
            scope_id=scope_id,
            role_name=role_name,
            status="active",
        )
        db.add(membership)

    invitation.accepted_at = utc_now()

    # The inviter may have typed a name; use it for an account that has none.
    # A name the user set themselves (or one from the identity provider) wins.
    if invitation.name and not (user.name or "").strip():
        user.name = invitation.name

    await db.commit()
    await db.refresh(membership)
    return membership


async def get_tenant_invitation_by_token(db: AsyncSession, tenant_id: UUID, token: str) -> Invitation | None:
    """Return invitation by token hash scoped to a tenant."""
    token_hash = hash_token(token)
    result = await db.execute(
        select(Invitation)
        .options(selectinload(Invitation.tenant))
        .where(
            Invitation.token_hash == token_hash,
            Invitation.tenant_id == tenant_id,
        )
    )
    return result.scalar_one_or_none()


async def get_invitation_by_id(db: AsyncSession, tenant_id: UUID, invitation_id: UUID) -> Invitation | None:
    """Return invitation by its database ID scoped to a tenant."""
    result = await db.execute(
        select(Invitation)
        .options(selectinload(Invitation.tenant))
        .where(
            Invitation.id == invitation_id,
            Invitation.tenant_id == tenant_id,
        )
    )
    return result.scalar_one_or_none()


async def resend_invitation(
    db: AsyncSession,
    invitation: Invitation,
    expires_in_days: int = 2,
) -> tuple["Invitation", str]:
    """Resend a pending or expired invitation by generating a fresh token."""
    if invitation.is_accepted:
        raise ValueError("Accepted invitations cannot be resent")
    if invitation.is_revoked:
        raise ValueError("Revoked invitations cannot be resent")

    now = utc_now()
    raw_token = token_urlsafe(32)
    hashed = hash_token(raw_token)

    invitation.token = hashed
    invitation.token_hash = hashed
    invitation.expires_at = now + timedelta(days=expires_in_days)

    await db.commit()
    await db.refresh(invitation, attribute_names=["tenant"])
    return invitation, raw_token


async def revoke_invitation(db: AsyncSession, invitation: Invitation) -> Invitation:
    """Mark a pending invitation as revoked."""
    if invitation.is_accepted:
        raise ValueError("Accepted invitations cannot be revoked")
    if invitation.is_revoked:
        raise ValueError("Invitation is already revoked")

    now = utc_now()
    invitation.revoked_at = now
    if invitation.expires_at > now:
        invitation.expires_at = now

    await db.commit()
    await db.refresh(invitation)
    return invitation


async def list_tenant_invitations(
    db: AsyncSession,
    tenant_id: UUID,
    *,
    status_filter: str | None = None,
) -> list[dict]:
    """List invitations for a tenant, optionally filtered by status."""
    # Verify tenant exists
    tenant_result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = tenant_result.scalar_one_or_none()
    if not tenant:
        raise ValueError(f"Tenant not found: {tenant_id}")

    result = await db.execute(
        select(Invitation)
        .where(Invitation.tenant_id == tenant_id)
        .order_by(Invitation.created_at.desc())
    )
    invitations = result.scalars().all()

    results = []
    for inv in invitations:
        inv_status = inv.status  # computed property
        if status_filter and inv_status != status_filter:
            continue
        results.append({
            "invitation_id": inv.id,
            "tenant_id": inv.tenant_id,
            "email": inv.email,
            "name": inv.name,
            "role": inv.target_role_name,
            "status": inv_status,
            "target_scope_type": inv.target_scope_type,
            "target_scope_id": inv.target_scope_id,
            "created_at": inv.created_at,
            "expires_at": inv.expires_at,
            "accepted_at": inv.accepted_at,
            "revoked_at": inv.revoked_at,
        })
    return results


def _invitation_dict(inv: Invitation) -> dict:
    return {
        "invitation_id": inv.id,
        "tenant_id": inv.tenant_id,
        "email": inv.email,
        "name": inv.name,
        "role": inv.target_role_name,
        "status": inv.status,
        "target_scope_type": inv.target_scope_type,
        "target_scope_id": inv.target_scope_id,
        "created_at": inv.created_at,
        "expires_at": inv.expires_at,
        "accepted_at": inv.accepted_at,
        "revoked_at": inv.revoked_at,
    }


async def list_platform_invitations(
    db: AsyncSession,
    *,
    status_filter: str | None = None,
) -> list[dict]:
    """Every invitation on the platform, newest first, with the organisation
    name attached so the platform Users page can show where each one leads.
    Status is a computed property, so the filter is applied after the query."""
    result = await db.execute(
        select(Invitation)
        .options(selectinload(Invitation.tenant))
        .order_by(Invitation.created_at.desc())
    )
    results = []
    for inv in result.scalars().all():
        if status_filter and inv.status != status_filter:
            continue
        results.append({**_invitation_dict(inv), "tenant_name": inv.tenant.name if inv.tenant else None})
    return results


# ── Set-password sign-up (invitation link) ───────────────────────────────

# Cognito statuses whose owner already has a working password. The invite
# page shows "sign in to accept" for these instead of the set-password form,
# because setting a password would overwrite the one they already use.
_ESTABLISHED_STATUSES = {"CONFIRMED", "RESET_REQUIRED"}


async def invitation_account_state(email: str) -> str:
    """Return "existing" when the invited address already has a usable Cognito
    login, otherwise "new" (no user yet, or pre-created and awaiting a password)."""
    info = await admin_get_user_async(email)
    if "error" in info:
        return "new"
    return "existing" if info.get("status") in _ESTABLISHED_STATUSES else "new"


async def complete_invitation_signup(
    db: AsyncSession, invitation: Invitation, password: str
) -> tuple[Membership, User, dict]:
    """Turn a pending invitation into a signed-in account in one step.

    1. Refuse if the invitation is not pending.
    2. Make sure a Cognito user exists for the invited address (pre-created at
       invite time normally; created here if that failed). An address that
       already has a password simply gets the new one: the emailed token
       proves ownership of the address exactly as a reset link does.
    3. Set the chosen password as permanent, which also confirms the user.
    4. Sign in server-side (ADMIN_USER_PASSWORD_AUTH) to obtain Cognito tokens.
    5. Provision the local user row from the ID token and accept the invitation.

    Returns (membership, user, tokens).
    """
    if invitation.status != "pending":
        raise InvitationSignupError(f"Invitation is {invitation.status}")

    email = invitation.email
    account = await create_invited_cognito_user_async(email)
    if "error" in account:
        raise InvitationSignupError(account["error"], status_code=502)

    set_result = await admin_set_user_password_async(email, password, permanent=True)
    if "error" in set_result:
        raise InvitationSignupError(set_result["error"])

    tokens = await admin_initiate_auth_async(email, password)
    if "error" in tokens:
        raise InvitationSignupError(tokens["error"], status_code=502)

    try:
        payload = await verify_token_async(tokens["id_token"], allowed_token_uses=("id",))
    except InvalidTokenError as exc:
        raise InvitationSignupError(f"Could not verify sign-in: {exc}", status_code=502) from exc

    user = await sync_user_from_cognito(payload, db)
    membership = await accept_invitation(db, invitation, user)
    return membership, user, tokens
