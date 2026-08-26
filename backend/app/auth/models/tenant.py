"""
Tenant model for multi-tenancy
Each tenant represents a client/organization
"""
from sqlalchemy import Column, String, DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from datetime import datetime, UTC
from uuid import uuid4

from ..database import Base


def utc_now() -> datetime:
    """Return naive UTC datetime compatible with existing DB DateTime columns."""
    return datetime.now(UTC).replace(tzinfo=None)


class Tenant(Base):
    """
    Tenant/Client/Organization model
    The primary isolation boundary for multi-tenant SaaS
    """
    __tablename__ = "tenants"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    name = Column(String(255), nullable=False)
    plan = Column(String(50), default="free")  # free, pro, enterprise
    status = Column(String(20), default="active")  # active, suspended
    
    created_at = Column(DateTime, default=utc_now, nullable=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)
    
    # Relationships
    memberships = relationship(
        "Membership",
        primaryjoin="and_(Membership.scope_id == Tenant.id, Membership.scope_type == 'account')",
        foreign_keys="[Membership.scope_id]",
        viewonly=True,
    )
    invitations = relationship("Invitation", back_populates="tenant", cascade="all, delete-orphan")
    
    def __repr__(self):
        return f"<Tenant(id={self.id}, name='{self.name}', plan='{self.plan}')>"
