"""Space schemas for API request/response validation."""
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class SpaceCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255, description="Space name")
    account_id: UUID | None = Field(
        default=None,
        description="Account (tenant) this space belongs to. Defaults to current scope.",
    )


class SpaceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    account_id: UUID | None = None
    status: str
    created_at: datetime


class SpaceSuspendResponse(BaseModel):
    id: UUID
    status: str
    suspended_at: datetime | None = None
    message: str


class SpaceUpdateRequest(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255, description="New space name")


class SpaceMemberResponse(BaseModel):
    """A user's membership in one space."""

    user_id: UUID
    email: str
    name: str | None
    role: str
    status: str
    joined_at: datetime
