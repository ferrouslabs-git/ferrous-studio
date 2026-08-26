"""
Session model - tracks user refresh tokens for logout and revocation
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


class Session(Base):
    """
    Session model - tracks refresh tokens
    Enables logout, device tracking, and token revocation
    """
    __tablename__ = "sessions"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    refresh_token_hash = Column(String(255), nullable=False)
    user_agent = Column(String(512), nullable=True)
    ip_address = Column(String(64), nullable=True)
    device_info = Column(String(255), nullable=True)
    expires_at = Column(DateTime, nullable=True)
    
    created_at = Column(DateTime, default=utc_now, nullable=False)
    revoked_at = Column(DateTime)
    
    # Relationships
    user = relationship("User", back_populates="sessions")
    
    def __repr__(self):
        return f"<Session(id={self.id}, user_id={self.user_id}, revoked={self.is_revoked})>"
    
    @property
    def is_revoked(self):
        """Check if session has been revoked"""
        return self.revoked_at is not None
    
    def revoke(self):
        """Revoke this session"""
        self.revoked_at = utc_now()
