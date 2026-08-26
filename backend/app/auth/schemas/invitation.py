"""
Invitation schemas for API request/response validation
"""
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field


class InvitationCreateRequest(BaseModel):
    """Request schema for creating a tenant invitation."""
    email: EmailStr = Field(..., description="Email address to invite")
    role: Literal["admin", "member", "viewer"] = Field(
        default="member",
        description="Legacy role to assign (backward compat)"
    )
    target_scope_type: str | None = Field(
        default=None,
        description="Scope type: 'account' or 'space'. Defaults to context scope."
    )
    target_scope_id: UUID | None = Field(
        default=None,
        description="Scope ID. Defaults to context scope_id."
    )
    target_role_name: str | None = Field(
        default=None,
        description="v3 role name (e.g. 'account_admin', 'space_member'). Defaults from 'role' field."
    )


class InvitationCreateResponse(BaseModel):
    """Response schema for created invitation."""
    invitation_id: UUID
    tenant_id: UUID
    email: EmailStr
    role: str
    token: str
    expires_at: datetime
    message: str
    status: Literal["pending", "accepted", "expired", "revoked"]
    email_sent: bool
    email_detail: str | None = None
    target_scope_type: str | None = None
    target_scope_id: UUID | None = None
    target_role_name: str | None = None


class InvitationPreviewResponse(BaseModel):
    """Response schema for invitation lookup by token."""
    token: str
    tenant_id: UUID
    tenant_name: str
    email: EmailStr
    role: str
    expires_at: datetime
    status: Literal["pending", "accepted", "expired", "revoked"]
    is_expired: bool
    is_accepted: bool


class InvitationRevokeResponse(BaseModel):
    invitation_id: UUID
    tenant_id: UUID
    status: Literal["revoked"]
    message: str


class InvitationResendResponse(BaseModel):
    """Response schema for resent invitation."""
    invitation_id: UUID
    tenant_id: UUID
    email: EmailStr
    token: str
    expires_at: datetime
    message: str
    status: Literal["pending", "accepted", "expired", "revoked"]
    email_sent: bool
    email_detail: str | None = None


class InvitationAcceptRequest(BaseModel):
    """Request schema for accepting an invitation."""
    token: str = Field(..., min_length=20, description="Invitation token")


class InvitationAcceptResponse(BaseModel):
    """Response schema for accepted invitation."""
    tenant_id: UUID
    role: str
    message: str
    scope_type: str | None = None
    scope_id: UUID | None = None
    role_name: str | None = None


class BulkInvitationItem(BaseModel):
    """A single entry in a bulk invite request."""
    email: EmailStr
    role: str = Field(default="member", description="Legacy role name")
    target_role_name: str | None = Field(default=None, description="v3 role name")


class BulkInvitationCreateRequest(BaseModel):
    """Request schema for bulk invitations."""
    invitations: list[BulkInvitationItem] = Field(..., min_length=1, max_length=50)


class BulkInvitationResultItem(BaseModel):
    email: str
    success: bool
    invitation_id: UUID | None = None
    error: str | None = None


class BulkInvitationCreateResponse(BaseModel):
    tenant_id: UUID
    total: int
    succeeded: int
    failed: int
    results: list[BulkInvitationResultItem]
