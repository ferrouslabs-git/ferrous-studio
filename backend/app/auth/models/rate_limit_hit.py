"""Rate limit hit tracking model."""
from datetime import datetime, UTC
from uuid import uuid4

from sqlalchemy import Column, String, DateTime
from sqlalchemy.dialects.postgresql import UUID

from ..database import Base


class RateLimitHit(Base):
    """Track rate limiter hits per key for distributed rate limiting."""

    __tablename__ = "rate_limit_hits"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    key = Column(String(255), nullable=False, index=True)
    hit_at = Column(DateTime(timezone=False), nullable=False, index=True)

    def __repr__(self) -> str:
        return f"<RateLimitHit(key={self.key}, hit_at={self.hit_at})>"
