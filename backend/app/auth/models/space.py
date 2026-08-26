from sqlalchemy import Column, String, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from datetime import datetime, timezone
from uuid import uuid4
from ..database import Base


class Space(Base):
    __tablename__ = "spaces"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    name = Column(String(255), nullable=False)
    account_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=True, index=True)
    status = Column(String(20), default="active")       # active | suspended
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    suspended_at = Column(DateTime, nullable=True)
