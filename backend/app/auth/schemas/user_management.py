"""
Schemas for tenant user-management endpoints.
"""
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, EmailStr


class TenantUserResponse(BaseModel):
    user_id: UUID
    email: EmailStr
    name: str | None
    role: str
    status: str
    is_active: bool
    joined_at: datetime


class PlatformUserMembershipResponse(BaseModel):
    tenant_id: UUID | None = None
    tenant_name: str | None = None
    role: str
    status: str
    joined_at: datetime
    scope_type: str | None = None
    scope_id: UUID | None = None


class PlatformUserResponse(BaseModel):
    user_id: UUID
    email: EmailStr
    name: str | None
    is_platform_admin: bool
    is_active: bool
    suspended_at: datetime | None
    created_at: datetime
    updated_at: datetime
    memberships: list[PlatformUserMembershipResponse]


class PlatformInvitationResponse(BaseModel):
    """An invitation as seen from the platform Users page: the organisation
    name comes along because the list spans every organisation."""
    invitation_id: UUID
    tenant_id: UUID
    tenant_name: str | None = None
    email: str
    name: str | None = None
    role: str
    status: str
    target_scope_type: str | None = None
    target_scope_id: UUID | None = None
    created_at: datetime
    expires_at: datetime
    accepted_at: datetime | None = None
    revoked_at: datetime | None = None


class UpdatePlatformUserRequest(BaseModel):
    """Edit a user from the platform Users page. Platform admins hold no
    memberships, so this bypasses the per-organisation name edit."""
    name: str | None = Field(None, max_length=255, description="Display name; blank clears it")


class UpdateTenantUserRequest(BaseModel):
    """Edit a member from the organisation's Users page. Both fields optional."""
    name: str | None = Field(None, max_length=255, description="Display name; blank clears it")
    role: Literal["admin", "member", "viewer"] | None = None


class UpdateUserRoleRequest(BaseModel):
    role: Literal["owner", "admin", "member", "viewer"]


class UpdateUserRoleResponse(BaseModel):
    user_id: UUID
    tenant_id: UUID
    role: str
    message: str


class RemoveUserResponse(BaseModel):
    user_id: UUID
    tenant_id: UUID
    status: str
    message: str


class MembershipListResponse(BaseModel):
    scope_type: str
    scope_id: UUID
    role: str
    status: str
    tenant_id: UUID | None = None
    tenant_name: str | None = None
    joined_at: datetime
