"""
Custom UI auth endpoints — active only when AUTH_MODE=custom_ui.

These endpoints proxy Cognito API calls so the frontend never needs
AWS credentials.  They produce the same Cognito JWTs as the Hosted UI
flow, so all downstream middleware (verify_token, get_current_user,
tenant context, guards, etc.) works unchanged.

Security notes:
- Rate limiting is applied by the existing RateLimitMiddleware.
- Passwords are validated by Cognito's password policy — not echoed/logged.
- Temp passwords for invited users are never returned to the client.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, EmailStr, Field

from ..config import get_settings
from ..services.cognito_admin_service import (
    confirm_forgot_password_async,
    confirm_sign_up_async,
    forgot_password_async,
    initiate_auth_async,
    resend_confirmation_code_async,
    respond_to_new_password_challenge_async,
    sign_up_user_async,
)

router = APIRouter()


def _require_custom_ui() -> None:
    if get_settings().auth_mode != "custom_ui":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Custom UI endpoints are disabled. Set AUTH_MODE=custom_ui to enable.",
        )


# ── Request / Response schemas ───────────────────────────────────

class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1, max_length=256)


class LoginResponse(BaseModel):
    authenticated: bool
    access_token: str | None = None
    id_token: str | None = None
    refresh_token: str | None = None
    expires_in: int | None = None
    challenge: str | None = None
    session: str | None = None


class SignupRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=256)


class SignupResponse(BaseModel):
    user_sub: str | None = None
    confirmed: bool = False
    needs_confirmation: bool = False


class ConfirmRequest(BaseModel):
    email: EmailStr
    code: str = Field(..., min_length=1, max_length=10)


class SetPasswordRequest(BaseModel):
    email: EmailStr
    new_password: str = Field(..., min_length=8, max_length=256)
    session: str = Field(..., min_length=1)


class ResendCodeRequest(BaseModel):
    email: EmailStr


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ConfirmForgotPasswordRequest(BaseModel):
    email: EmailStr
    code: str = Field(..., min_length=1, max_length=10)
    new_password: str = Field(..., min_length=8, max_length=256)


# ── Endpoints ────────────────────────────────────────────────────

@router.post("/custom/login", response_model=LoginResponse)
async def custom_login(body: LoginRequest):
    """Authenticate with email + password (USER_PASSWORD_AUTH flow).

    Returns tokens on success, or a challenge object if the user must
    set a new password (invitation flow).
    """
    _require_custom_ui()
    result = await initiate_auth_async(body.email, body.password)

    if "error" in result:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=result["error"],
        )

    return LoginResponse(**result)


@router.post("/custom/signup", response_model=SignupResponse)
async def custom_signup(body: SignupRequest):
    """Self-service signup (Cognito SignUp API).

    User may need to confirm their email via a code sent by Cognito.
    """
    _require_custom_ui()
    result = await sign_up_user_async(body.email, body.password)

    if "error" in result:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result["error"],
        )

    return SignupResponse(
        user_sub=result.get("user_sub"),
        confirmed=result.get("confirmed", False),
        needs_confirmation=not result.get("confirmed", False),
    )


@router.post("/custom/confirm")
async def custom_confirm(body: ConfirmRequest):
    """Confirm email address after self-service signup."""
    _require_custom_ui()
    result = await confirm_sign_up_async(body.email, body.code)

    if "error" in result:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result["error"],
        )

    return {"confirmed": True, "message": "Email confirmed. You can now sign in."}


@router.post("/custom/set-password", response_model=LoginResponse)
async def custom_set_password(body: SetPasswordRequest):
    """Complete NEW_PASSWORD_REQUIRED challenge (invitation flow).

    Called after /custom/login returns challenge='NEW_PASSWORD_REQUIRED'.
    The session token from that response is required.
    """
    _require_custom_ui()
    result = await respond_to_new_password_challenge_async(
        body.email, body.new_password, body.session,
    )

    if "error" in result:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result["error"],
        )

    return LoginResponse(**result)


@router.post("/custom/resend-code")
async def custom_resend_code(body: ResendCodeRequest):
    """Resend email confirmation code for unconfirmed users."""
    _require_custom_ui()
    result = await resend_confirmation_code_async(body.email)

    if "error" in result:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result["error"],
        )

    return {"sent": True, "message": "Confirmation code sent to your email."}


@router.post("/custom/forgot-password")
async def custom_forgot_password(body: ForgotPasswordRequest):
    """Initiate forgot-password flow — sends a reset code to the user's email."""
    _require_custom_ui()
    result = await forgot_password_async(body.email)

    if "error" in result:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result["error"],
        )

    return {"sent": True, "message": "If the account exists, a reset code has been sent."}


@router.post("/custom/confirm-forgot-password")
async def custom_confirm_forgot_password(body: ConfirmForgotPasswordRequest):
    """Complete forgot-password with reset code + new password."""
    _require_custom_ui()
    result = await confirm_forgot_password_async(body.email, body.code, body.new_password)

    if "error" in result:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result["error"],
        )

    return {"confirmed": True, "message": "Password reset successful. You can now sign in."}
