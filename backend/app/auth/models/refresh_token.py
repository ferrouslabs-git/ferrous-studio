"""Refresh token store for opaque cookie keys."""
from datetime import UTC, datetime

from sqlalchemy import Column, DateTime, String, Text

from ..database import Base


def utc_now() -> datetime:
    """Return naive UTC datetime compatible with existing DB DateTime columns."""
    return datetime.now(UTC).replace(tzinfo=None)


class RefreshTokenStore(Base):
    """Server-side mapping between opaque cookie keys and Cognito refresh tokens."""

    __tablename__ = "refresh_tokens"

    cookie_key = Column(String(255), primary_key=True)
    refresh_token = Column(Text, nullable=False)
    expires_at = Column(DateTime, nullable=False, index=True)
    created_at = Column(DateTime, nullable=False, default=utc_now)
