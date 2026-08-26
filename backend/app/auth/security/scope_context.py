from dataclasses import dataclass, field
from uuid import UUID


@dataclass
class ScopeContext:
    user_id: UUID
    scope_type: str                            # platform | account | space
    scope_id: UUID | None                      # None for platform scope
    active_roles: list[str] = field(default_factory=list)
    resolved_permissions: set[str] = field(default_factory=set)
    is_super_admin: bool = False

    def has_permission(self, perm: str) -> bool:
        if self.is_super_admin:
            return True
        return perm in self.resolved_permissions

    def has_any_permission(self, perms: list[str]) -> bool:
        if self.is_super_admin:
            return True
        return bool(self.resolved_permissions.intersection(perms))

    def has_all_permissions(self, perms: list[str]) -> bool:
        if self.is_super_admin:
            return True
        return all(p in self.resolved_permissions for p in perms)

    @property
    def role_name(self) -> str | None:
        """Primary active role name (first in list), used for invite authority checks."""
        return self.active_roles[0] if self.active_roles else None
