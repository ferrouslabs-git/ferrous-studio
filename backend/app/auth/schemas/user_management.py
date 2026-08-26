"""
Schemas for tenant user-management endpoints.
"""
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr


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
