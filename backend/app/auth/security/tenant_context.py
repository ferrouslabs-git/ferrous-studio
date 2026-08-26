"""
Tenant context - request-scoped tenant information

This dataclass holds tenant context for each request, populated by TenantContextMiddleware.
It's stored in request.state and accessed via get_tenant_context() dependency.
"""
from dataclasses import dataclass
from uuid import UUID


@dataclass
class TenantContext:
    """
    Request-scoped tenant context.
    
    Contains authenticated user info plus their role in the current tenant.
    Populated by TenantContextMiddleware based on X-Tenant-ID header validation.
    
    Attributes:
        user_id: UUID of authenticated user
        tenant_id: UUID of current tenant (from X-Tenant-ID header)
        role: User's role in this tenant (owner, admin, member, viewer), or None
            when a platform admin is operating without tenant membership
        is_platform_admin: Whether user has platform-wide admin access
    """
    user_id: UUID
    tenant_id: UUID
    role: str | None
    is_platform_admin: bool
    
    def can_access_tenant(self) -> bool:
        """Check if user has access to current tenant."""
        return self.is_platform_admin or self.role is not None
    
    def is_owner(self) -> bool:
        """Check if user is tenant owner."""
        return self.role == "owner"
    
    def is_admin_or_owner(self) -> bool:
        """Check if user is owner or admin."""
        return self.role in ("owner", "admin")
    
    def __repr__(self):
        return f"<TenantContext(user={self.user_id}, tenant={self.tenant_id}, role={self.role!r})>"
