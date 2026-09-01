"""
Custom UI auth endpoints — the app's own sign-in page.

/custom/login, /custom/forgot-password and /custom/confirm-forgot-password
back the branded sign-in and password-reset forms in the React app and are
always on. Self-service sign-up (/custom/signup, /custom/confirm,
/custom/resend-code, /custom/set-password) stays behind AUTH_MODE=custom_ui:
accounts are created by invitation (see invitation_routes.py).

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
    admin_initiate_auth_async,
    confirm_forgot_password_async,
    confirm_sign_up_async,
    forgot_password_async,
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
    """Authenticate with email + password.

    Uses the server-side ADMIN_USER_PASSWORD_AUTH flow (the app client does
    not allow passwords straight from the browser). An invited user who has
    not yet set a password through their invitation link gets a
    NEW_PASSWORD_REQUIRED challenge from Cognito; that is reported as a
    sign-in error pointing them back to the link.
    """
    result = await admin_initiate_auth_async(body.email, body.password)

    if "error" in result:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=result["error"],
        )
    if result.get("challenge") == "NEW_PASSWORD_REQUIRED":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="This account has not been set up yet. Open the link in your invitation email to choose a password.",
        )
    if not result.get("authenticated"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Sign-in needs an unsupported step ({result.get('challenge')})",
        )

    return LoginResponse(**{k: v for k, v in result.items() if k in LoginResponse.model_fields})


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
    result = await confirm_forgot_password_async(body.email, body.code, body.new_password)

    if "error" in result:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result["error"],
        )

    return {"confirmed": True, "message": "Password reset successful. You can now sign in."}
