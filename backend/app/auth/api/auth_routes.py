import os
import re
from typing import Optional

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db

from ..models.membership import Membership
from ..models.tenant import Tenant
from ..models.user import User
from ..schemas import (
    AccountActionResponse,
    AccountChangeEmailRequest,
    AccountConfirmEmailChangeRequest,
    AccountDeleteRequest,
    AccountDisconnectSsoRequest,
    AccountSetPasswordRequest,
    AuthTypeResponse,
)
from ..schemas.user_management import MembershipListResponse
from ..security import InvalidTokenError, get_current_user, verify_token_async
from ..services.user_service import (
    confirm_email_change_for_user,
    disconnect_sso_for_user,
    get_auth_type_from_cognito,
    hard_delete_my_account,
    initiate_email_change_for_user,
    set_password_for_user,
    sync_user_from_cognito,
    update_user_profile,
)

router = APIRouter()

# Template default: this module was originally shared across several sibling
# products behind one Cognito pool, so signup attribution was validated
# against a hardcoded product allowlist. This template gives each app its
# own pool per environment, so there is nothing to disambiguate — any
# reasonably-shaped slug is accepted. If you later share one pool across
# several apps again, replace this with your own allowlist.
_SIGNUP_MODULE_SLUG_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{0,49}$")

def _normalize_signup_module(value: str | None) -> str | None:
    """Normalize module attribution to the canonical hyphen-slug form.

    Accepts either "signup-flow" or "signup_flow" (etc) to keep clients flexible.
    """
    if value is None:
        return None
    s = value.strip()
    if not s:
        return None
    return s.replace("_", "-")


def _normalize_language(value: str | None) -> str | None:
    """Return a normalized short locale like 'en-US' or 'en'."""
    if not value:
        return None
    raw = value.strip()
    if not raw:
        return None
    # Accept-Language can be: "en-GB,en;q=0.9" → take first tag.
    first = raw.split(",")[0].strip()
    if not first:
        return None
    tag = first.split(";")[0].strip()
    if not tag:
        return None
    # Keep it small to fit schema constraints (max_length=10).
    return tag[:10]


def _guess_language_from_country(country: str | None) -> str | None:
    if not country:
        return None
    c = country.strip().upper()
    if not c:
        return None
    if c == "GB":
        return "en-GB"
    if c == "US":
        return "en-US"
    return None


def _detect_language(request: Request) -> str:
    """Return a language for *new* users based on UK vs non-UK origin.

    Client requirement:
    - UK (GB) => en-GB
    - Anything else (including missing country headers) => en-US
    """
    # Proxy/CDN country headers (no external API calls).
    country = (
        request.headers.get("cf-ipcountry")
        or request.headers.get("cloudfront-viewer-country")
        or request.headers.get("x-vercel-ip-country")
        or request.headers.get("x-country")
    )
    guessed = _guess_language_from_country(country)
    if guessed:
        return guessed

    # Safe default (non-UK).
    return "en-US"


class SyncUserBody(BaseModel):
    signup_module: str | None = Field(
        None,
        max_length=50,
        description="Optional free-form attribution slug (e.g. which signup flow was used).",
    )
    language: str | None = Field(None, max_length=10)

    @field_validator("signup_module")
    @classmethod
    def signup_module_must_be_a_slug(cls, v: str | None) -> str | None:
        s = _normalize_signup_module(v)
        if s is None:
            return None
        if not _SIGNUP_MODULE_SLUG_PATTERN.match(s):
            raise ValueError("Invalid signup_module: use lowercase letters, digits and hyphens only.")
        return s


class UpdateProfileRequest(BaseModel):
    name: str | None = Field(None, max_length=255)
    language: str | None = Field(None, max_length=10)


@router.get("/debug-token")
async def debug_token(authorization: Optional[str] = Header(None)):
    """
    Debug endpoint to test JWT token verification.
    Only functional when AUTH_DEBUG=1 is set; returns 404 otherwise.
    """
    if os.getenv("AUTH_DEBUG", "").lower() not in ("1", "true"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        scheme, token = authorization.split()
        if scheme.lower() != "bearer":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication scheme. Use 'Bearer <token>'",
            )
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Authorization header format. Use 'Bearer <token>'",
        )

    try:
        payload = await verify_token_async(token)
        claims = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
        return {
            "status": "valid",
            "message": "Token verified successfully",
            "claims": claims,
        }
    except InvalidTokenError as exc:
        raise exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Token verification failed: {str(exc)}",
            headers={"WWW-Authenticate": "Bearer"},
        )


@router.post("/sync")
async def sync_user(
    request: Request,
    authorization: Optional[str] = Header(None),
    body: Optional[SyncUserBody] = Body(default=None),
    db: AsyncSession = Depends(get_db),
):
    """
    Sync Cognito user to database.
    Called after successful Cognito login.

    Optional JSON body:
    - signup_module: optional free-form attribution slug (lowercase letters/digits/hyphens);
      malformed values return a 422 validation error.
    - language: explicit locale override; if omitted, new users get language from
      CDN/proxy country headers (GB => en-GB; everything else => en-US). Existing users
      keep their stored language unless `language` is sent.

    Phase 3 Test Checkpoint:
    1. Login via Cognito Hosted UI
    2. Get id_token or access_token
    3. Call: curl -X POST -H "Authorization: Bearer <token>" http://localhost:8000/auth/sync
    4. Expected: User created in database

    This endpoint is idempotent - safe to call multiple times.
    Updates email/name if changed in Cognito.

    Returns:
        User details: user_id, email, name
    """
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        scheme, token = authorization.split()
        if scheme.lower() != "bearer":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication scheme. Use 'Bearer <token>'",
            )
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Authorization header format. Use 'Bearer <token>'",
        )

    try:
        token_payload = await verify_token_async(token, allowed_token_uses=("access", "id"))
    except InvalidTokenError as exc:
        raise exc

    try:
        explicit_language = _normalize_language(body.language) if (body and body.language) else None
        signup_module = body.signup_module if body else None
        detected = _detect_language(request)
        # Language: explicit JSON body wins. For new users only, use Accept-Language / CDN country
        # / default so we do not overwrite a user's saved preference on every sync.
        user = await sync_user_from_cognito(
            token_payload,
            db,
            signup_module=signup_module,
            language=explicit_language,
            default_language_if_new=detected,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        )

    return {
        "user_id": str(user.id),
        "email": user.email,
        "name": user.name,
        "cognito_sub": user.cognito_sub,
        "is_platform_admin": user.is_platform_admin,
        "signup_module": user.signup_module,
        "language": user.language,
        "created_at": user.created_at.isoformat(),
        "message": "User synced successfully",
    }


@router.get("/me")
async def get_current_user_profile(current_user: User = Depends(get_current_user)):
    """Get authenticated user profile."""
    return {
        "id": str(current_user.id),
        "email": current_user.email,
        "name": current_user.name,
        "cognito_sub": current_user.cognito_sub,
        "is_platform_admin": current_user.is_platform_admin,
        "signup_module": current_user.signup_module,
        "language": current_user.language,
        "created_at": current_user.created_at.isoformat(),
        "updated_at": current_user.updated_at.isoformat(),
    }


@router.get("/me/auth-type", response_model=AuthTypeResponse)
async def get_my_auth_type(current_user: User = Depends(get_current_user)):
    """Return whether the current user authenticated via SSO or email/password."""
    result = await get_auth_type_from_cognito(current_user.cognito_sub)
    if "error" in result:
        kind = result.get("error_kind")
        if kind == "cognito_user_not_found":
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=result["error"])
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=result["error"])
    return result


@router.post("/account/set-password", response_model=AccountActionResponse)
async def account_set_password(
    body: AccountSetPasswordRequest,
    current_user: User = Depends(get_current_user),
):
    result = await set_password_for_user(cognito_sub=current_user.cognito_sub, password=body.password)
    if "error" in result:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=result["error"])
    return AccountActionResponse(ok=True, message="Password set successfully")


@router.post("/account/disconnect-sso", response_model=AccountActionResponse)
async def account_disconnect_sso(
    body: AccountDisconnectSsoRequest,
    current_user: User = Depends(get_current_user),
):
    result = await disconnect_sso_for_user(user=current_user, password=body.password)
    if "error" in result:
        kind = result.get("error_kind")
        if kind == "invalid_password":
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=result["error"])
        if kind in ("no_password", "not_sso", "bad_identity"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=result["error"])
        if kind == "cognito_user_not_found":
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=result["error"])
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=result["error"])
    return AccountActionResponse(ok=True, message="SSO provider disconnected")


@router.post("/account/change-email", response_model=AccountActionResponse)
async def account_change_email(
    body: AccountChangeEmailRequest,
    authorization: str | None = Header(default=None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Initiate email change flow; Cognito sends verification code to new email."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing Authorization header")
    token = authorization.split(" ", 1)[1].strip()
    result = await initiate_email_change_for_user(access_token=token, new_email=body.new_email, db=db)
    if "error" in result:
        kind = result.get("error_kind")
        if kind == "duplicate_email":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=result["error"])
        if kind == "invalid_email":
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=result["error"])
        if kind == "not_authorized":
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=result["error"])
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=result["error"])
    return AccountActionResponse(ok=True, message="Verification code sent")


@router.post("/account/confirm-email-change", response_model=AccountActionResponse)
async def account_confirm_email_change(
    body: AccountConfirmEmailChangeRequest,
    authorization: str | None = Header(default=None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Confirm email change using verification code, then sync email to local DB."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing Authorization header")
    token = authorization.split(" ", 1)[1].strip()
    result = await confirm_email_change_for_user(
        access_token=token,
        user=current_user,
        db=db,
        confirmation_code=body.confirmation_code,
    )
    if "error" in result:
        kind = result.get("error_kind")
        if kind == "duplicate_email":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=result["error"])
        if kind in ("code_mismatch", "code_expired", "missing_code"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=result["error"])
        if kind == "not_authorized":
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=result["error"])
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=result["error"])
    return AccountActionResponse(ok=True, message="Email updated successfully")


@router.delete("/account", response_model=AccountActionResponse)
async def account_delete(
    body: AccountDeleteRequest = Body(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    confirmation = (body.confirmation or "").strip().upper()
    if confirmation != "DELETE":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Confirmation must be "DELETE"')
    result = await hard_delete_my_account(user=current_user, db=db)
    if "error" in result:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=result["error"])
    return AccountActionResponse(ok=True, message="Account deleted")

@router.patch("/me")
async def update_current_user_profile(
    body: UpdateProfileRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update authenticated user's profile (name, language)."""
    user = await update_user_profile(
        user_id=current_user.id,
        db=db,
        name=body.name,
        language=body.language,
    )
    return {
        "id": str(user.id),
        "email": user.email,
        "name": user.name,
        "cognito_sub": user.cognito_sub,
        "is_platform_admin": user.is_platform_admin,
        "signup_module": user.signup_module,
        "language": user.language,
        "created_at": user.created_at.isoformat(),
        "updated_at": user.updated_at.isoformat(),
    }


@router.get("/me/memberships", response_model=list[MembershipListResponse])
async def get_my_memberships(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all memberships for the authenticated user."""
    result = await db.execute(
        select(Membership).where(
            Membership.user_id == current_user.id, Membership.status == "active"
        )
    )
    memberships = result.scalars().all()
    results = []
    for m in memberships:
        tenant_name = None
        if m.scope_type == "account":
            t_result = await db.execute(select(Tenant).where(Tenant.id == m.scope_id))
            tenant = t_result.scalar_one_or_none()
            if tenant:
                tenant_name = tenant.name
        results.append(
            MembershipListResponse(
                scope_type=m.scope_type,
                scope_id=m.scope_id,
                role=m.role_name,
                status=m.status,
                tenant_id=m.scope_id if m.scope_type == "account" else None,
                tenant_name=tenant_name,
                joined_at=m.created_at,
            )
        )
    return results