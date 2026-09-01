"""Scope / Tenant Context Middleware request prechecks for protected auth routes.

This middleware:
1. Enforces presence of scope headers (X-Scope-Type + X-Scope-ID) or X-Tenant-ID
2. Enforces Bearer Authorization header presence
3. Stores requested scope type/id and tenant ID on request.state

Tenant/scope membership validation and context creation are intentionally
handled in dependency flow using the same request-scoped DB session as handlers.
"""
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from uuid import UUID

from ..config import get_settings

class TenantContextMiddleware(BaseHTTPMiddleware):
    """
    Middleware to enforce tenant request prechecks.
    
    Routes that require tenant context:
    - All /auth/* routes EXCEPT /auth/sync, /auth/debug-token, /auth/me, /auth/tenants
    
    Public routes (skip middleware):
    - /health
    - /auth/sync (initial user sync, no tenant yet)
    - /auth/debug-token (phase 1 test endpoint)
    - /auth/me (user profile, no tenant context needed)
    - /auth/tenants (tenant creation/listing, no specific tenant context)
    - POST /auth/tenants (tenant creation)
    - GET /auth/tenants/my (list user's tenants)
    
    For protected routes:
    - Requires X-Tenant-ID header
    - Validates header UUID format
    - Requires Bearer Authorization header
    - Stores request.state.requested_tenant_id for downstream use
    """
    
    def __init__(self, app, auth_prefix: str | None = None):
        super().__init__(app)
        settings = get_settings()
        configured_prefix = auth_prefix or settings.auth_api_prefix
        self.auth_prefix = self._normalize_prefix(configured_prefix)
        self.skip_routes = {
            "/health",
            f"{self.auth_prefix}/sync",
            f"{self.auth_prefix}/debug-token",
            f"{self.auth_prefix}/me",
            f"{self.auth_prefix}/tenants",
            f"{self.auth_prefix}/tenants/my",
            f"{self.auth_prefix}/accounts",
            f"{self.auth_prefix}/config/roles",
            f"{self.auth_prefix}/config/permissions",
        }

    @staticmethod
    def _normalize_prefix(prefix: str) -> str:
        cleaned = (prefix or "/auth").strip()
        if not cleaned:
            return "/auth"
        if not cleaned.startswith("/"):
            cleaned = f"/{cleaned}"
        return cleaned.rstrip("/") or "/auth"
    
    async def dispatch(self, request: Request, call_next):
        """Process request and validate tenant access."""
        
        # Skip middleware for public/tenant-agnostic routes
        if self._should_skip_middleware(request):
            return await call_next(request)

        # ── Scope header resolution (v3.0) ───────────────────────────
        scope_type = request.headers.get("X-Scope-Type")
        scope_id_str = request.headers.get("X-Scope-ID")
        tenant_id_str = request.headers.get("X-Tenant-ID")

        # Fallback: X-Tenant-ID → account scope
        if not scope_type and tenant_id_str:
            scope_type = "account"
            scope_id_str = tenant_id_str

        if not scope_type or not scope_id_str:
            return JSONResponse(
                status_code=400,
                content={
                    "detail": "X-Tenant-ID header required",
                    "hint": "Pass tenant UUID in X-Tenant-ID header, or use X-Scope-Type + X-Scope-ID"
                }
            )

        # Validate scope type
        if scope_type != "account":
            return JSONResponse(
                status_code=400,
                content={"detail": f"Invalid X-Scope-Type: '{scope_type}'. Must be 'account'."}
            )

        # Validate UUID format
        try:
            scope_id = UUID(scope_id_str)
        except ValueError:
            return JSONResponse(
                status_code=400,
                content={"detail": "Invalid scope ID format. Must be a valid UUID"}
            )

        # Ensure auth header is present and has Bearer scheme.
        auth_header = request.headers.get("Authorization", "")

        if not auth_header.startswith("Bearer "):
            return JSONResponse(
                status_code=401,
                content={"detail": "Authorization header missing or invalid"}
            )

        # Middleware intentionally does not create DB sessions.
        # Membership validation and context creation happen in dependencies.
        request.state.requested_scope_type = scope_type
        request.state.requested_scope_id = scope_id
        # Backward compat: keep requested_tenant_id for legacy code
        request.state.requested_tenant_id = scope_id

        return await call_next(request)
    
    def _should_skip_middleware(self, request: Request) -> bool:
        """
        Check if request should skip tenant context validation.
        
        Skips for:
        - Public routes (health check)
        - Auth initialization routes (sync, tenant creation)
        - Exact path matches in SKIP_ROUTES
        """
        path = request.url.path

        # Apply tenant validation only to auth routes.
        if not path.startswith(self.auth_prefix):
            return True
        
        # Exact match
        if path in self.skip_routes:
            return True
        
        # Allow POST /auth/tenants (tenant creation)
        if path == f"{self.auth_prefix}/tenants" and request.method == "POST":
            return True
        
        # Allow GET /auth/tenants/my (list user's tenants)
        if path == f"{self.auth_prefix}/tenants/my" and request.method == "GET":
            return True

        # Allow direct tenant detail, update, and invitation listing routes.
        # These authenticate via get_current_user and check membership in the endpoint.
        # But NOT /tenants/{id}/users/* which uses scope-context middleware.
        tenants_prefix = f"{self.auth_prefix}/tenants/"
        if path.startswith(tenants_prefix):
            remainder = path[len(tenants_prefix):]
            # e.g. "{uuid}" or "{uuid}/invitations" — skip middleware
            # but NOT "{uuid}/users" or "{uuid}/users/{uid}/role" etc.
            parts = remainder.split("/", 1)
            if len(parts) == 1:
                # /tenants/{uuid} — detail/update
                return True
            if len(parts) == 2 and parts[1] in ("invitations", "invitations/bulk"):
                return True

        # Allow invitation token routes (do not require tenant header)
        if path.startswith(f"{self.auth_prefix}/invites/"):
            return True

        # Session revocation routes are user-scoped, not tenant-scoped.
        if path.startswith(f"{self.auth_prefix}/sessions"):
            return True

        # /me routes are user-scoped.
        if path.startswith(f"{self.auth_prefix}/me"):
            return True

        # Account settings routes are user-scoped (no tenant header required).
        if path == f"{self.auth_prefix}/account" or path.startswith(f"{self.auth_prefix}/account/"):
            return True

        # Cookie management and token refresh are user-scoped, not tenant-scoped.
        if path.startswith(f"{self.auth_prefix}/cookie/") or path == f"{self.auth_prefix}/token/refresh":
            return True

        # Platform-admin routes are global and not tenant-header scoped.
        if path.startswith(f"{self.auth_prefix}/platform/"):
            return True

        # Custom UI auth routes are pre-authentication; no tenant context yet.
        if path.startswith(f"{self.auth_prefix}/custom/"):
            return True
        
        return False
