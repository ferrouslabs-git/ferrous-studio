from sqlalchemy import Column, String, ForeignKey, UniqueConstraint
from ..database import Base


class PermissionGrant(Base):
    __tablename__ = "permission_grants"

    role_name = Column(String(100), ForeignKey("role_definitions.name"), primary_key=True)
    permission = Column(String(200), primary_key=True, nullable=False)
    permission_type = Column(String(20), nullable=False)  # structural | product

    __table_args__ = (
        UniqueConstraint("role_name", "permission", name="unique_role_permission"),
    )
