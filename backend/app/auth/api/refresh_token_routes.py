from importlib import import_module
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db

from ..models.user import User
from ..security import get_current_user
from ..services.audit_service import log_audit_event

router = APIRouter()


def _api_module():
    return import_module("app.auth.api")


class _StoreRefreshPayload(BaseModel):
    refresh_token: str


@router.post("/cookie/store-refresh")
async def store_refresh_cookie(
    payload: _StoreRefreshPayload,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Store Cognito refresh token in an HttpOnly cookie after login."""
    api_module = _api_module()
    settings = api_module.get_settings()
    cookie_key = await api_module.store_refresh_token(db, payload.refresh_token)
    api_module.set_refresh_cookie(
        response,
        cookie_key,
        secure=settings.cookie_secure,
        cookie_name=settings.resolved_auth_cookie_name,
        cookie_path=settings.resolved_auth_cookie_path,
    )
    csrf_token = api_module.generate_csrf_token()
    api_module.set_csrf_cookie(
        response,
        csrf_token,
        secure=settings.cookie_secure,
        csrf_cookie_name=settings.resolved_auth_csrf_cookie_name,
        cookie_path="/",
    )
    await log_audit_event("refresh_cookie_stored", actor_user_id=str(current_user.id), db=db)
    return {"message": "Refresh token stored"}


@router.post("/token/refresh")
async def token_refresh(
    request: Request,
    response: Response,
    x_requested_with: Optional[str] = Header(None),
    x_csrf_token: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    """Exchange the HttpOnly refresh cookie for a new access token."""
    if not x_requested_with or x_requested_with.lower() != "xmlhttprequest":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="X-Requested-With: XMLHttpRequest header required",
        )

    api_module = _api_module()
    settings = api_module.get_settings()

    csrf_cookie = request.cookies.get(settings.resolved_auth_csrf_cookie_name)
    if not x_csrf_token or not csrf_cookie or x_csrf_token != csrf_cookie:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CSRF token missing or invalid",
        )

    cookie_key = request.cookies.get(settings.resolved_auth_cookie_name)
    if not cookie_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No refresh token cookie present",
        )

    refresh_token = await api_module.get_refresh_token(db, cookie_key)
    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No refresh token cookie present",
        )

    if not settings.cognito_domain or not settings.cognito_client_id:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cognito is not configured on this server",
        )

    try:
        tokens = await api_module.call_cognito_refresh_async(
            refresh_token=refresh_token,
            cognito_domain=settings.cognito_domain,
            client_id=settings.cognito_client_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
        ) from exc

    if tokens.get("refresh_token"):
        new_cookie_key = await api_module.rotate_refresh_token(db, cookie_key, tokens["refresh_token"])
        api_module.set_refresh_cookie(
            response,
            new_cookie_key,
            secure=settings.cookie_secure,
            cookie_name=settings.resolved_auth_cookie_name,
            cookie_path=settings.resolved_auth_cookie_path,
        )

    return {
        "access_token": tokens.get("access_token"),
        "id_token": tokens.get("id_token"),
        "expires_in": tokens.get("expires_in", 3600),
    }


@router.post("/cookie/clear-refresh")
async def clear_refresh(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Expire the HttpOnly refresh-token cookie."""
    api_module = _api_module()
    settings = api_module.get_settings()
    await api_module.revoke_refresh_token(db, request.cookies.get(settings.resolved_auth_cookie_name, ""))
    api_module.clear_refresh_cookie(
        response,
        secure=settings.cookie_secure,
        cookie_name=settings.resolved_auth_cookie_name,
        cookie_path=settings.resolved_auth_cookie_path,
    )
    api_module.clear_csrf_cookie(
        response,
        secure=settings.cookie_secure,
        csrf_cookie_name=settings.resolved_auth_csrf_cookie_name,
        cookie_path="/",
    )
    return {"message": "Refresh cookie cleared"}