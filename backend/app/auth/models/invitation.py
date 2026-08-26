"""
Invitation model - token-based user invitations to tenants
"""
from sqlalchemy import Column, String, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from datetime import UTC, datetime
from uuid import uuid4

from ..database import Base


def utc_now() -> datetime:
    """Return naive UTC datetime compatible with existing DB DateTime columns."""
    return datetime.now(UTC).replace(tzinfo=None)


class Invitation(Base):
    """
    Invitation model - secure token-based invites
    Allows tenant members to invite new users
    """
    __tablename__ = "invitations"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    email = Column(String(255), nullable=False, index=True)
    token = Column(String(255), unique=True, nullable=False, index=True)
    token_hash = Column(String(64), nullable=True, index=True)  # SHA256 hex digest
    expires_at = Column(DateTime, nullable=False)
    accepted_at = Column(DateTime)
    revoked_at = Column(DateTime)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    
    created_at = Column(DateTime, default=utc_now, nullable=False)

    # Scope columns
    target_scope_type = Column(String(20), nullable=False)
    target_scope_id = Column(UUID(as_uuid=True), nullable=False)
    target_role_name = Column(String(100), nullable=False)

    # Relationships
    tenant = relationship("Tenant", back_populates="invitations")
    creator = relationship("User", back_populates="created_invitations", foreign_keys=[created_by])
    
    def __repr__(self):
        return f"<Invitation(email='{self.email}', tenant_id={self.tenant_id}, role='{self.target_role_name}')>"
    
    @property
    def is_expired(self):
        """Check if invitation has expired"""
        return utc_now() > self.expires_at
    
    @property
    def is_accepted(self):
        """Check if invitation has been accepted"""
        return self.accepted_at is not None

    @property
    def is_revoked(self):
        """Check if invitation has been revoked by an admin."""
        return self.revoked_at is not None

    @property
    def status(self):
        """Return lifecycle state used by API responses."""
        if self.is_revoked:
            return "revoked"
        if self.is_accepted:
            return "accepted"
        if self.is_expired:
            return "expired"
        return "pending"
