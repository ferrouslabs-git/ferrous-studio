"""
User model - represents individuals authenticated via Cognito
"""
from sqlalchemy import Column, String, Boolean, DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from datetime import datetime, UTC
from uuid import uuid4

from ..database import Base


def utc_now() -> datetime:
    """Return naive UTC datetime compatible with existing DB DateTime columns."""
    return datetime.now(UTC).replace(tzinfo=None)


class User(Base):
    """
    User model - linked to AWS Cognito identity
    Users can belong to multiple tenants via Membership
    """
    __tablename__ = "users"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    cognito_sub = Column(String(255), unique=True, nullable=False, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    name = Column(String(255))
    signup_module = Column(String(50), nullable=True, index=True)
    language = Column(String(10), nullable=False, server_default="en-US", default="en-US")
    is_platform_admin = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True, nullable=False)
    suspended_at = Column(DateTime, nullable=True)
    # Set when the person has left the platform. Orthogonal to the temporary
    # suspend above: restoring clears only this, so a suspended-then-archived
    # user comes back suspended. Hard delete is only allowed once this is set.
    archived_at = Column(DateTime, nullable=True)
    
    created_at = Column(DateTime, default=utc_now, nullable=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)
    
    # Relationships
    memberships = relationship("Membership", back_populates="user", cascade="all, delete-orphan",
                               foreign_keys="Membership.user_id")
    sessions = relationship("Session", back_populates="user", cascade="all, delete-orphan")
    created_invitations = relationship("Invitation", back_populates="creator", foreign_keys="Invitation.created_by")
    
    def __repr__(self):
        return f"<User(id={self.id}, email='{self.email}', cognito_sub='{self.cognito_sub}')>"
