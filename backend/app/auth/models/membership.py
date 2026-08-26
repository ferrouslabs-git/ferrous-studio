"""
Membership model - links Users to scopes (platform / account / space) with roles
"""
from sqlalchemy import Column, String, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from datetime import datetime, UTC
from uuid import uuid4

from ..database import Base


def utc_now() -> datetime:
    """Return naive UTC datetime compatible with existing DB DateTime columns."""
    return datetime.now(UTC).replace(tzinfo=None)


class Membership(Base):
    """
    Membership model - links Users to scopes with roles.
    scope_type + scope_id identify the scope (account, space, platform).
    """
    __tablename__ = "memberships"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"),
                     nullable=False, index=True)
    role_name = Column(String(100), nullable=False)
    scope_type = Column(String(20), nullable=False)      # platform | account | space
    scope_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    status = Column(String(20), default="active")       # active | removed | suspended
    created_at = Column(DateTime, default=utc_now, nullable=False)
    granted_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"),
                        nullable=True)

    # Relationships
    user = relationship("User", back_populates="memberships", foreign_keys=[user_id])
    tenant = relationship(
        "Tenant",
        primaryjoin="Membership.scope_id == Tenant.id",
        foreign_keys=[scope_id],
        viewonly=True,
        uselist=False,
    )

    __table_args__ = (
        UniqueConstraint("user_id", "role_name", "scope_type", "scope_id",
                         name="unique_user_role_scope"),
    )

    def __repr__(self):
        return f"<Membership(user_id={self.user_id}, scope_type='{self.scope_type}', scope_id={self.scope_id}, role_name='{self.role_name}')>"
