from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db

from ..models.user import User
from ..schemas.session import SessionListItemResponse, SessionRegisterRequest, SessionRotateRequest
from ..security import get_current_user
from ..services.audit_service import log_audit_event
from ..services.session_service import (
    create_user_session,
    list_user_sessions,
    revoke_all_user_sessions,
    revoke_user_session,
    rotate_user_session,
)
from ..services.user_service import cognito_global_sign_out

router = APIRouter()


@router.get("/sessions", response_model=list[SessionListItemResponse])
async def get_my_sessions(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    include_revoked: bool = False,
    limit: int = 50,
    x_current_session_id: Optional[str] = Header(None),
):
    """List current user's device sessions for visibility and self-service revocation."""
    safe_limit = min(max(limit, 1), 200)

    current_session_id: UUID | None = None
    if x_current_session_id:
        try:
            current_session_id = UUID(x_current_session_id)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid X-Current-Session-ID format",
            ) from exc

    sessions = await list_user_sessions(
        db=db,
        user_id=current_user.id,
        include_revoked=include_revoked,
        limit=safe_limit,
    )

    return [
        SessionListItemResponse(
            session_id=str(session.id),
            user_id=str(session.user_id),
            user_agent=session.user_agent,
            ip_address=session.ip_address,
            device_info=session.device_info,
            created_at=session.created_at.isoformat(),
            expires_at=session.expires_at.isoformat() if session.expires_at else None,
            revoked_at=session.revoked_at.isoformat() if session.revoked_at else None,
            is_current=(current_session_id == session.id) if current_session_id else False,
            is_revoked=session.revoked_at is not None,
        )
        for session in sessions
    ]


@router.delete("/sessions/all")
async def revoke_all_sessions(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    x_current_session_id: Optional[str] = Header(None),
):
    """Revoke server-tracked sessions and invalidate Cognito refresh tokens (all devices).

    DB: marks sessions revoked (optionally keeps ``X-Current-Session-ID``). Cognito:
    ``AdminUserGlobalSignOut`` using email and cognito_sub so stolen refresh tokens stop working.
    """
    keep_session_id: UUID | None = None
    if x_current_session_id:
        try:
            keep_session_id = UUID(x_current_session_id)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid X-Current-Session-ID format",
            ) from exc

    revoked_count = await revoke_all_user_sessions(
        db=db,
        user_id=current_user.id,
        except_session_id=keep_session_id,
    )

    # Also invalidate Cognito tokens so other devices are logged out immediately.
    # This is best-effort; DB session revocation still succeeds even if Cognito call fails.
    await cognito_global_sign_out(current_user.email, current_user.cognito_sub)

    await log_audit_event(
        "all_sessions_revoked",
        actor_user_id=str(current_user.id),
        db=db,
        revoked_count=revoked_count,
        kept_session_id=str(keep_session_id) if keep_session_id else None,
    )

    return {
        "user_id": str(current_user.id),
        "revoked_count": revoked_count,
        "kept_session_id": str(keep_session_id) if keep_session_id else None,
        "message": "Session revocation completed",
    }


@router.post("/sessions/register")
async def register_session(
    payload: SessionRegisterRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a refresh-token-backed session for current user."""
    created = await create_user_session(
        db=db,
        user_id=current_user.id,
        refresh_token=payload.refresh_token,
        user_agent=payload.user_agent,
        ip_address=payload.ip_address,
        device_info=payload.device_info,
        expires_at=payload.expires_at,
    )

    await log_audit_event(
        "session_registered",
        actor_user_id=str(current_user.id),
        db=db,
        session_id=str(created.id),
    )

    return {
        "session_id": str(created.id),
        "user_id": str(current_user.id),
        "revoked_at": None,
        "message": "Session registered successfully",
    }


@router.post("/sessions/{session_id}/rotate")
async def rotate_session(
    session_id: UUID,
    payload: SessionRotateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Rotate refresh token by revoking current session and issuing replacement."""
    rotated = await rotate_user_session(
        db=db,
        user_id=current_user.id,
        session_id=session_id,
        old_refresh_token=payload.old_refresh_token,
        new_refresh_token=payload.new_refresh_token,
        user_agent=payload.user_agent,
        ip_address=payload.ip_address,
        device_info=payload.device_info,
        expires_at=payload.expires_at,
    )

    if not rotated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    await log_audit_event(
        "session_rotated",
        actor_user_id=str(current_user.id),
        db=db,
        previous_session_id=str(session_id),
        new_session_id=str(rotated.id),
    )

    return {
        "session_id": str(rotated.id),
        "user_id": str(current_user.id),
        "revoked_at": None,
        "message": "Session rotated successfully",
    }


@router.delete("/sessions/{session_id}")
async def revoke_session(
    session_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Revoke one active session that belongs to the current user."""
    revoked = await revoke_user_session(db, current_user.id, session_id)
    if not revoked:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    await log_audit_event(
        "session_revoked",
        actor_user_id=str(current_user.id),
        db=db,
        session_id=str(session_id),
    )

    return {
        "session_id": str(revoked.id),
        "user_id": str(current_user.id),
        "revoked_at": revoked.revoked_at.isoformat() if revoked.revoked_at else None,
        "message": "Session revoked successfully",
    }