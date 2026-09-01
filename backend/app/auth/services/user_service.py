"""
User service - handles user sync and lookup operations
"""
import asyncio
import json
import logging

import boto3
from botocore.exceptions import ClientError
from sqlalchemy import select, func, update, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from typing import Optional
from uuid import UUID
from datetime import datetime, UTC

from ..config import get_settings
from ..models.user import User
from ..models.membership import Membership
from ..models.session import Session as AuthSession
from ..models.invitation import Invitation
from ..schemas.token import TokenPayload
from .cognito_admin_service import (
    admin_delete_user_async,
    admin_delete_user_by_username_async,
    admin_disable_provider_for_user_async,
    admin_get_user_async,
    admin_set_user_password_async,
    admin_disable_user_async,
    initiate_auth_async,
    list_users_by_email_async,
    update_user_attributes_async,
    verify_user_attribute_async,
)

logger = logging.getLogger(__name__)


def utc_now() -> datetime:
    """Return current UTC datetime without timezone info (for SQLAlchemy)."""
    return datetime.now(UTC).replace(tzinfo=None)


async def sync_user_from_cognito(
    token_payload: TokenPayload,
    db: AsyncSession,
    signup_module: Optional[str] = None,
    language: Optional[str] = None,
    *,
    default_language_if_new: str = "en-US",
) -> User:
    """
    Sync Cognito user to database.
    Creates new user if doesn't exist, updates if exists.
    Idempotent - safe to call multiple times.

    ``language`` updates an existing user only when non-None (explicit override).
    New users get ``language`` if set, otherwise ``default_language_if_new``.
    
    Handles edge case where Cognito user was deleted/recreated with same email
    but different cognito_sub by updating the existing DB user's cognito_sub.
    """
    if not token_payload.email:
        logger.warning(
            "sync_user_from_cognito missing email claim sub=%s token_use=%s",
            getattr(token_payload, "sub", None),
            getattr(token_payload, "token_use", None),
        )
        raise ValueError("Token missing email claim for user provisioning")
    
    logger.info(
        "sync_user_from_cognito start sub=%s email=%s signup_module=%s language=%s",
        token_payload.sub,
        token_payload.email,
        signup_module,
        language,
    )

    user = await get_user_by_cognito_sub(token_payload.sub, db)
    
    if user:
        if token_payload.email:
            user.email = token_payload.email
        if token_payload.name:
            user.name = token_payload.name
        if signup_module is not None:
            user.signup_module = signup_module
        if language is not None:
            user.language = language
        await db.commit()
        await db.refresh(user)
        logger.info("sync_user_from_cognito updated user_id=%s", str(user.id))
    else:
        user = await get_user_by_email(token_payload.email, db)
        
        if user:
            user.cognito_sub = token_payload.sub
            if token_payload.name:
                user.name = token_payload.name
            if signup_module is not None:
                user.signup_module = signup_module
            if language is not None:
                user.language = language
            await db.commit()
            await db.refresh(user)
            logger.info(
                "sync_user_from_cognito relinked user_id=%s (matched by email)",
                str(user.id),
            )
        else:
            user = User(
                cognito_sub=token_payload.sub,
                email=token_payload.email,
                name=token_payload.name if token_payload.name else None,
                signup_module=signup_module,
                language=language or default_language_if_new or "en-US",
            )
            db.add(user)
            await db.commit()
            await db.refresh(user)
            logger.info("sync_user_from_cognito created user_id=%s", str(user.id))
    
    return user


async def get_user_by_cognito_sub(cognito_sub: str, db: AsyncSession) -> Optional[User]:
    """Get user by Cognito sub (unique identifier)."""
    result = await db.execute(select(User).where(User.cognito_sub == cognito_sub))
    return result.scalar_one_or_none()


async def update_user_profile(
    user_id: UUID,
    db: AsyncSession,
    name: Optional[str] = None,
    language: Optional[str] = None,
) -> User:
    """Update editable user profile fields (name, language)."""
    user = await get_user_by_id(user_id, db)
    if not user:
        raise ValueError(f"User {user_id} not found")
    if name is not None:
        user.name = name
    if language is not None:
        user.language = language
    await db.commit()
    await db.refresh(user)
    return user


async def get_user_by_id(user_id: UUID, db: AsyncSession) -> Optional[User]:
    """Get user by internal UUID."""
    result = await db.execute(
        select(User)
        .options(
            selectinload(User.memberships).selectinload(Membership.tenant)
        )
        .where(User.id == user_id)
    )
    return result.scalar_one_or_none()


async def get_user_by_email(email: str, db: AsyncSession) -> Optional[User]:
    """Get user by email address."""
    result = await db.execute(select(User).where(User.email == email))
    return result.scalar_one_or_none()


def _normalize_auth_provider(provider_name: str | None) -> str | None:
    if not provider_name:
        return None
    raw = provider_name.strip()
    if not raw:
        return None
    if raw.lower() == "google":
        return "Google"
    if raw.lower() == "microsoft":
        return "microsoft"
    return None


def _parse_cognito_identities(raw: str | None) -> list[dict]:
    if not raw:
        return []
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            return [x for x in data if isinstance(x, dict)]
    except Exception:
        return []
    return []



def _password_reauth_candidates(user: User) -> list[str]:
    """Try both email and cognito_sub for USER_PASSWORD_AUTH.

    Pool Username can be email (custom_ui) or sub UUID (hosted/federated). Trying both
    makes disconnect flow more robust across pool configs.
    """
    out: list[str] = []
    for raw in (user.email, user.cognito_sub):
        if not raw:
            continue
        s = raw.strip()
        if s and s not in out:
            out.append(s)
    return out


async def set_password_for_user(*, cognito_sub: str, password: str) -> dict:
    """Set a permanent password for the Cognito user."""
    try:
        result = await admin_set_user_password_async(cognito_sub, password, permanent=True)
    except Exception as exc:
        return {"error": f"Cognito set-password failed: {type(exc).__name__}: {exc}"}
    if "error" in result:
        return {"error": result["error"]}
    return {"ok": True}


async def _verify_password_for_user(user: User, password: str) -> dict:
    """Re-authenticate a user by verifying their password via Cognito."""
    last_error: str | None = None
    for username in _password_reauth_candidates(user):
        try:
            result = await initiate_auth_async(username, password)
        except Exception as exc:
            return {"error": f"Cognito re-auth failed: {type(exc).__name__}: {exc}", "error_kind": "cognito_call_failed"}

        if result.get("authenticated") is True:
            return {"ok": True}
        if result.get("challenge") == "NEW_PASSWORD_REQUIRED":
            # Password is still not permanent/usable as re-auth proof.
            last_error = "New password required"
            continue
        if "error" in result:
            last_error = result["error"]
            continue
    return {"error": last_error or "Invalid password", "error_kind": "invalid_password"}


async def disconnect_sso_for_user(*, user: User, password: str) -> dict:
    """Disconnect an OAuth provider for an SSO user after password re-auth."""
    # Determine current SSO state from Cognito
    auth_state = await get_auth_type_from_cognito(user.cognito_sub)
    if "error" in auth_state:
        return auth_state

    if auth_state.get("auth_type") != "sso":
        return {"error": "User is not an SSO account", "error_kind": "not_sso"}
    if auth_state.get("has_password") is not True:
        return {"error": "Cannot disconnect SSO without a password set", "error_kind": "no_password"}

    # Re-authenticate with password
    reauth = await _verify_password_for_user(user, password)
    if "error" in reauth:
        return reauth

    # Fetch identities so we can get provider subject
    cog = await admin_get_user_async(user.cognito_sub)
    if "error" in cog:
        return {"error": cog["error"], "error_kind": "cognito_user_not_found"}
    attributes = cog.get("attributes") or {}
    identities = _parse_cognito_identities(attributes.get("identities"))
    if not identities:
        return {"error": "No SSO identity found to disconnect", "error_kind": "not_sso"}

    identity = identities[0]
    provider_name_raw = identity.get("providerName")
    provider_name = provider_name_raw.strip() if isinstance(provider_name_raw, str) else None
    provider_subject_raw = identity.get("userId")
    provider_subject = provider_subject_raw.strip() if isinstance(provider_subject_raw, str) else None

    if not provider_name or not provider_subject:
        return {"error": "SSO identity missing providerName/userId", "error_kind": "bad_identity"}

    try:
        res = await admin_disable_provider_for_user_async(
            provider_name=provider_name,
            provider_subject=provider_subject,
        )
    except Exception as exc:
        return {"error": f"Cognito disconnect failed: {type(exc).__name__}: {exc}", "error_kind": "cognito_call_failed"}

    if "error" in res:
        return {"error": res["error"], "error_kind": "cognito_call_failed"}
    return {"ok": True}


async def initiate_email_change_for_user(*, access_token: str, new_email: str, db: AsyncSession) -> dict:
    """Start email change flow by updating Cognito email attribute.

    Cognito will send a verification code to the new email (pool must be configured accordingly).
    """
    new_email_norm = (new_email or "").strip().lower()
    if not new_email_norm or "@" not in new_email_norm:
        return {"error": "Invalid email format", "error_kind": "invalid_email"}

    # Fast pre-check: local DB unique constraint friendliness.
    exists = await db.execute(select(User.id).where(func.lower(User.email) == new_email_norm))
    if exists.scalar_one_or_none() is not None:
        return {"error": "An account with this email already exists", "error_kind": "duplicate_email"}

    # Cognito pre-check (best-effort, avoids triggering email on known duplicates).
    cog_list = await list_users_by_email_async(new_email_norm, limit=1)
    if "error" not in cog_list:
        users = cog_list.get("users") or []
        if users:
            return {"error": "An account with this email already exists", "error_kind": "duplicate_email"}

    res = await update_user_attributes_async(
        access_token=access_token,
        attributes=[
            {"Name": "email", "Value": new_email_norm},
        ],
    )
    if "error" in res:
        return res
    return {"ok": True}


async def confirm_email_change_for_user(*, access_token: str, user: User, db: AsyncSession, confirmation_code: str) -> dict:
    """Confirm email change using Cognito verification code, then sync new email into DB."""
    code = (confirmation_code or "").strip()
    if not code:
        return {"error": "Confirmation code is required", "error_kind": "missing_code"}

    verified = await verify_user_attribute_async(
        access_token=access_token,
        attribute_name="email",
        code=code,
    )
    if "error" in verified:
        return verified

    # Pull latest email from Cognito and store it in local DB.
    cog = await admin_get_user_async(user.cognito_sub)
    if "error" in cog:
        return {"error": cog["error"], "error_kind": "cognito_user_not_found"}
    attributes = cog.get("attributes") or {}
    new_email = attributes.get("email")
    if not new_email:
        return {"error": "Email change verified but email attribute is missing", "error_kind": "missing_email"}

    new_email_norm = new_email.strip().lower()
    if not new_email_norm:
        return {"error": "Email change verified but email attribute is empty", "error_kind": "missing_email"}

    # Ensure DB doesn't already have this email (race/edge case).
    exists = await db.execute(select(User.id).where(func.lower(User.email) == new_email_norm, User.id != user.id))
    if exists.scalar_one_or_none() is not None:
        return {"error": "An account with this email already exists", "error_kind": "duplicate_email"}

    user.email = new_email_norm
    await db.commit()
    await db.refresh(user)
    return {"ok": True, "email": user.email}


async def soft_delete_my_account(*, user: User, db: AsyncSession) -> dict:
    """Soft-delete: deactivate locally + disable Cognito user + revoke sessions.

    This keeps the DB row and Cognito identity for potential recovery / audit needs,
    but prevents further sign-in and API usage.
    """
    # Mark user inactive (soft delete)
    user.is_active = False
    user.suspended_at = utc_now()
    await db.commit()
    await db.refresh(user)

    # Disable Cognito (best-effort).
    # Note: Cognito "Username" might be email or sub depending on pool config; try both.
    disable_email = await admin_disable_user_async(user.email)
    if "error" in disable_email:
        disable_sub = await admin_disable_user_async(user.cognito_sub)
        if "error" in disable_sub:
            logger.warning(
                "Soft delete: failed to disable Cognito user",
                extra={"user_id": str(user.id), "email": user.email, "cognito_sub": user.cognito_sub},
            )

    # Revoke all sessions in DB (and invalidate Cognito tokens best-effort).
    # We reuse the existing helper to sign out from Cognito.
    try:
        await db.execute(
            update(AuthSession)
            .where(AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None))
            .values(revoked_at=utc_now())
        )
        await db.commit()
    except Exception:
        logger.exception("Soft delete: failed to revoke DB sessions", extra={"user_id": str(user.id)})

    await cognito_global_sign_out(user.email, user.cognito_sub)
    return {"ok": True}


async def hard_delete_my_account(*, user: User, db: AsyncSession) -> dict:
    """Hard-delete: globally sign out, remove Cognito identity, then drop DB row.

    Related rows (memberships, sessions, referrals…) are cleaned up via the
    ON DELETE CASCADE / SET NULL foreign-key rules declared on those tables.
    """
    user_id = user.id
    user_email = user.email
    user_sub = user.cognito_sub

    # Global sign-out first so in-flight tokens stop working before the user row disappears.
    await cognito_global_sign_out(user_email, user_sub)

    # Cognito pool "Username" can be either the email or the sub depending on pool config — try both.
    cognito_deleted = False
    if user_email:
        res = await admin_delete_user_async(user_email)
        if "error" not in res:
            cognito_deleted = True
        else:
            logger.warning(
                "Hard delete: admin_delete_user(email) failed; will retry with cognito_sub",
                extra={"user_id": str(user_id), "email": user_email, "error": res.get("error")},
            )
    if not cognito_deleted and user_sub:
        res_sub = await admin_delete_user_by_username_async(user_sub)
        if "error" in res_sub:
            logger.error(
                "Hard delete: failed to delete Cognito user by sub",
                extra={"user_id": str(user_id), "cognito_sub": user_sub, "error": res_sub.get("error")},
            )
            return {"error": res_sub["error"], "error_kind": "cognito_delete_failed"}

    # Drop the DB row — FK cascades remove memberships / sessions / referrals.
    try:
        await db.delete(user)
        await db.commit()
    except Exception as exc:
        await db.rollback()
        logger.exception("Hard delete: failed to delete DB user row", extra={"user_id": str(user_id)})
        return {"error": f"Database delete failed: {type(exc).__name__}: {exc}", "error_kind": "db_delete_failed"}

    return {"ok": True}


async def get_auth_type_from_cognito(cognito_username: str) -> dict:
    """Return auth type details based on Cognito AdminGetUser.

    Returns:
      { auth_type: "sso"|"email", provider: "Google"|"microsoft"|None, has_password: bool }
    """
    try:
        result = await admin_get_user_async(cognito_username)
    except Exception as exc:
        # e.g. NoCredentialsError / network issues / unexpected boto errors
        return {"error": f"Cognito lookup failed: {type(exc).__name__}: {exc}", "error_kind": "cognito_call_failed"}

    if "error" in result:
        return {"error": result["error"], "error_kind": "cognito_user_not_found"}

    status = result.get("status")
    attributes = result.get("attributes") or {}

    # Debug logging to help diagnose issues with auth type detection
    logger.info(
        "auth_type_lookup status=%s attributes=%s result=%s",
        status,
        attributes,
        result,
    )

    identities = _parse_cognito_identities(attributes.get("identities"))
    provider = None
    if identities:
        provider = _normalize_auth_provider(identities[0].get("providerName"))

    auth_type = "sso" if identities else "email"
    # Cognito marks pure federated accounts as EXTERNAL_PROVIDER. If identities exist but status
    # changes later (linked password), we still consider auth_type sso but has_password true.
    
    if status == "EXTERNAL_PROVIDER":
        has_password = False
    elif status == "FORCE_CHANGE_PASSWORD":
        has_password = False
    else:
        has_password = True

    # has_password = status != "EXTERNAL_PROVIDER"

    return {"auth_type": auth_type, "provider": provider, "has_password": has_password}


async def suspend_user(user_id: UUID, db: AsyncSession) -> User:
    """
    Suspend a user account.

    Also calls Cognito AdminUserGlobalSignOut to invalidate all
    outstanding refresh tokens so the user cannot silently re-acquire
    new access tokens after suspension.
    """
    user = await get_user_by_id(user_id, db)
    if not user:
        raise ValueError(f"User {user_id} not found")
    
    user.is_active = False
    user.suspended_at = utc_now()
    await db.commit()
    await db.refresh(user)

    # AdminUserGlobalSignOut requires Cognito's "Username" field. That may be email (custom_ui /
    # USER_PASSWORD_AUTH) or the user's sub UUID (Hosted UI / federated sign-in). Try both.
    await cognito_global_sign_out(user.email, user.cognito_sub)

    return user


def _cognito_username_candidates(email: str | None, cognito_sub: str | None) -> list[str]:
    """Ordered unique usernames to try for AdminUserGlobalSignOut."""
    out: list[str] = []
    for raw in (email, cognito_sub):
        if not raw:
            continue
        s = raw.strip()
        if s and s not in out:
            out.append(s)
    return out


def _try_cognito_global_sign_out(username: str) -> bool:
    """Call AdminUserGlobalSignOut for one username. Returns True on success."""
    settings = get_settings()
    if not settings.cognito_user_pool_id:
        logger.debug("Cognito user pool not configured; skipping global sign-out")
        return False

    try:
        client = boto3.client("cognito-idp", region_name=settings.cognito_region)
        client.admin_user_global_sign_out(
            UserPoolId=settings.cognito_user_pool_id,
            Username=username,
        )
        logger.info("Cognito global sign-out succeeded for username=%s", username)
        return True
    except ClientError as exc:
        code = exc.response["Error"]["Code"]
        msg = exc.response["Error"]["Message"]
        if code == "UserNotFoundException":
            logger.debug(
                "Cognito global sign-out: no user with Username=%s (try alternate identifier)",
                username,
            )
        else:
            logger.warning("Cognito global sign-out failed for %s: %s", username, msg)
        return False
    except Exception:
        logger.exception("Unexpected error during Cognito global sign-out")
        return False


async def cognito_global_sign_out(email: str | None, cognito_sub: str | None = None) -> None:
    """Invalidate Cognito refresh tokens across devices (AdminUserGlobalSignOut).

    Tries ``email`` first, then ``cognito_sub`` if different — covers both email-based and
    sub-based Cognito usernames. Best-effort: does not raise.
    """
    for username in _cognito_username_candidates(email, cognito_sub):
        if await asyncio.to_thread(_try_cognito_global_sign_out, username):
            return
    logger.warning(
        "Cognito global sign-out failed for all username candidates (email=%s, cognito_sub=%s)",
        email,
        cognito_sub,
    )


async def unsuspend_user(user_id: UUID, db: AsyncSession) -> User:
    """Unsuspend a user account."""
    user = await get_user_by_id(user_id, db)
    if not user:
        raise ValueError(f"User {user_id} not found")
    
    user.is_active = True
    user.suspended_at = None
    await db.commit()
    await db.refresh(user)
    return user


async def promote_to_platform_admin(user_id: UUID, db: AsyncSession) -> User:
    """Grant platform admin access to a user."""
    user = await get_user_by_id(user_id, db)
    if not user:
        raise ValueError(f"User {user_id} not found")

    user.is_platform_admin = True
    await db.commit()
    await db.refresh(user)
    return user


async def demote_from_platform_admin(user_id: UUID, db: AsyncSession) -> User:
    """Remove platform admin access from a user while preserving at least one admin."""
    user = await get_user_by_id(user_id, db)
    if not user:
        raise ValueError(f"User {user_id} not found")

    if user.is_platform_admin:
        result = await db.execute(
            select(func.count()).select_from(User).where(User.is_platform_admin.is_(True))
        )
        admin_count = result.scalar()
        if admin_count <= 1:
            raise ValueError("Cannot remove the last platform administrator")

    user.is_platform_admin = False
    await db.commit()
    await db.refresh(user)
    return user


async def delete_user(user_id: UUID, db: AsyncSession) -> dict:
    """Permanently delete a user from Cognito and the local database.

    Performs full cleanup in order:
    1. Delete user from Cognito user pool
    2. Revoke all local sessions
    3. Remove all memberships
    4. Anonymize invitations created by this user
    5. Delete the User record

    Raises ValueError if the user is a platform admin (must be demoted first)
    or the last owner of any tenant.
    """
    from .cognito_admin_service import admin_delete_user as cognito_delete

    user = await get_user_by_id(user_id, db)
    if not user:
        raise ValueError(f"User {user_id} not found")

    if user.is_platform_admin:
        raise ValueError("Cannot delete a platform admin. Demote them first.")

    # Check that the user is not the last admin of any organisation
    result = await db.execute(
        select(Membership).where(
            Membership.user_id == user_id,
            Membership.status == "active",
            Membership.scope_type == "account",
            Membership.role_name.in_(["admin", "account_admin"]),
        )
    )
    admin_memberships = result.scalars().all()

    for m in admin_memberships:
        count_result = await db.execute(
            select(func.count()).select_from(Membership).where(
                Membership.scope_type == "account",
                Membership.scope_id == m.scope_id,
                Membership.status == "active",
                Membership.role_name.in_(["admin", "account_admin"]),
            )
        )
        if (count_result.scalar() or 0) <= 1:
            raise ValueError(
                f"User is the last admin of organisation {m.scope_id}. Promote another admin first."
            )

    # 1. Delete from Cognito (blocking boto3, offload to thread)
    cognito_result = await asyncio.to_thread(cognito_delete, user.email)
    if "error" in cognito_result:
        raise ValueError(f"Cognito deletion failed: {cognito_result['error']}")

    # 2. Revoke all sessions
    await db.execute(delete(AuthSession).where(AuthSession.user_id == user_id))

    # 3. Remove all memberships
    await db.execute(delete(Membership).where(Membership.user_id == user_id))

    # 4. Nullify invitations created by this user (preserve audit trail)
    await db.execute(
        update(Invitation).where(Invitation.created_by == user_id).values(created_by=None)
    )

    # 5. Delete the user record
    await db.delete(user)
    await db.commit()

    logger.info("Permanently deleted user", extra={"user_id": str(user_id), "email": user.email})

    return {
        "deleted": True,
        "user_id": str(user_id),
        "email": user.email,
        "cognito_deleted": cognito_result.get("deleted", False),
    }
