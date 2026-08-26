from sqlalchemy import Column, String, DateTime, Boolean
from datetime import datetime, UTC
from ..database import Base


def utc_now() -> datetime:
    """Return naive UTC datetime compatible with existing DB DateTime columns."""
    return datetime.now(UTC).replace(tzinfo=None)


class RoleDefinition(Base):
    __tablename__ = "role_definitions"

    name = Column(String(100), primary_key=True)
    layer = Column(String(20), nullable=False)          # platform | account | space
    display_name = Column(String(255), nullable=False)
    is_builtin = Column(Boolean, default=False)
    created_at = Column(DateTime, default=utc_now, nullable=False)
