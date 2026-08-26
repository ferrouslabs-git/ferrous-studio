"""
Security utilities for auth module

Includes:
- JWT verification from Cognito
- TenantContext / ScopeContext (v3.0)
- TenantContext middleware (critical for multi-tenancy)
- Permission-based authorization guards (v3.0)
- Deprecated role-based guards (remove after 2026-05-20)
"""
from .jwt_verifier import verify_token, verify_token_async, verify_token_optional, verify_token_optional_async, InvalidTokenError
from .dependencies import get_current_user, get_current_user_optional, oauth2_scheme, get_tenant_context, get_scope_context
from .tenant_context import TenantContext
from .scope_context import ScopeContext
from .tenant_middleware import TenantContextMiddleware
from .security_headers_middleware import SecurityHeadersMiddleware
from .rate_limit_middleware import RateLimitMiddleware
from .guards import (
    # New (v3.0)
    require_permission,
    require_any_permission,
    require_all_permissions,
    require_super_admin,
    # Deprecated — remove after 2026-05-20
    require_role,
    require_min_role,
    require_owner,
    require_admin,
    require_member,
    require_viewer,
    check_permission,
)

__all__ = [
    "verify_token",
    "verify_token_async",
    "verify_token_optional",
    "verify_token_optional_async",
    "InvalidTokenError",
    "get_current_user",
    "get_current_user_optional",
    "oauth2_scheme",
    "get_tenant_context",
    "get_scope_context",
    "TenantContext",
    "ScopeContext",
    "TenantContextMiddleware",
    "SecurityHeadersMiddleware",
    "RateLimitMiddleware",
    # New (v3.0)
    "require_permission",
    "require_any_permission",
    "require_all_permissions",
    "require_super_admin",
    # Deprecated — remove after 2026-05-20
    "require_role",
    "require_min_role",
    "require_owner",
    "require_admin",
    "require_member",
    "require_viewer",
    "check_permission",
]
