"""Session lifecycle request and response schemas."""
from datetime import datetime
from pydantic import BaseModel, Field


class SessionRegisterRequest(BaseModel):
    refresh_token: str = Field(..., min_length=16)
    user_agent: str | None = None
    ip_address: str | None = None
    device_info: str | None = None
    expires_at: datetime | None = None


class SessionRotateRequest(BaseModel):
    old_refresh_token: str = Field(..., min_length=16)
    new_refresh_token: str = Field(..., min_length=16)
    user_agent: str | None = None
    ip_address: str | None = None
    device_info: str | None = None
    expires_at: datetime | None = None


class SessionResponse(BaseModel):
    session_id: str
    user_id: str
    revoked_at: str | None = None
    message: str


class SessionListItemResponse(BaseModel):
    session_id: str
    user_id: str
    user_agent: str | None = None
    ip_address: str | None = None
    device_info: str | None = None
    created_at: str
    expires_at: str | None = None
    revoked_at: str | None = None
    is_current: bool = False
    is_revoked: bool = False
