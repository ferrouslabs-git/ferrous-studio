"""Rate limiting middleware for auth-sensitive endpoints.

Supports both PostgreSQL-backed distributed limiting and in-memory limiting.
"""
from typing import Optional, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from ..config import get_settings
from ..services.rate_limiter_service import RateLimiter, create_rate_limiter

# Tunable auth rate limits (per IP, per path). Change here to adjust production behavior.
AUTH_RATE_LIMIT_WINDOW_SECONDS = 60
# Login, set-password, forgot-password flows — keep tight against brute force / abuse.
AUTH_RATE_LIMIT_STRICT_MAX_REQUESTS = 5
# Signup, confirm, resend-code — slightly more room for legitimate retries.
AUTH_RATE_LIMIT_ONBOARDING_MAX_REQUESTS = 10


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Rate-limit auth endpoints by client IP and path.

    Uses PostgreSQL for distributed limiting if get_db is provided,
    otherwise falls back to in-memory limiting for single-process deployments.
    """

    def __init__(
        self,
        app,
        limit: int = 30,
        window_seconds: int = 60,
        auth_prefix: str | None = None,
        rate_limiter: RateLimiter | None = None,
        get_db: Optional[Callable] = None,
    ):
        super().__init__(app)
        self.limit = limit
        self.window_seconds = window_seconds
        settings = get_settings()
        configured_prefix = auth_prefix or settings.auth_api_prefix
        self.auth_prefix = self._normalize_prefix(configured_prefix)

        # Use provided limiter or create one based on config
        if rate_limiter:
            self.rate_limiter = rate_limiter
        else:
            self.rate_limiter = create_rate_limiter(get_db)

        self.protected_routes = {
            f"{self.auth_prefix}/debug-token",
            # Custom UI auth endpoints (password-based flows)
            f"{self.auth_prefix}/custom/login",
            f"{self.auth_prefix}/custom/signup",
            f"{self.auth_prefix}/custom/confirm",
            f"{self.auth_prefix}/custom/set-password",
            f"{self.auth_prefix}/custom/resend-code",
            f"{self.auth_prefix}/custom/forgot-password",
            f"{self.auth_prefix}/custom/confirm-forgot-password",
            f"{self.auth_prefix}/sync",
            f"{self.auth_prefix}/invite",
            f"{self.auth_prefix}/invites/accept",
            f"{self.auth_prefix}/token/refresh",
            f"{self.auth_prefix}/cookie/store-refresh",
            f"{self.auth_prefix}/cookie/clear-refresh",
            # Session registration is invoked right after login to persist refresh token metadata
            f"{self.auth_prefix}/sessions/register",
        }

        # Optional per-route overrides (limit, window_seconds).
        # Defaults are used for any protected route not listed here.
        w = AUTH_RATE_LIMIT_WINDOW_SECONDS
        strict = (AUTH_RATE_LIMIT_STRICT_MAX_REQUESTS, w)
        onboarding = (AUTH_RATE_LIMIT_ONBOARDING_MAX_REQUESTS, w)
        self.route_limits: dict[str, tuple[int, int]] = {
            # Brute-force sensitive: keep tight.
            f"{self.auth_prefix}/custom/login": strict,
            f"{self.auth_prefix}/custom/set-password": strict,
            f"{self.auth_prefix}/custom/forgot-password": strict,
            f"{self.auth_prefix}/custom/confirm-forgot-password": strict,
            # More lenient: user onboarding and code re-sends.
            f"{self.auth_prefix}/custom/signup": onboarding,
            f"{self.auth_prefix}/custom/confirm": onboarding,
            f"{self.auth_prefix}/custom/resend-code": onboarding,
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
        path = request.url.path

        if not self._is_protected_path(path):
            return await call_next(request)

        client_ip = request.client.host if request.client else "unknown"
        key = f"{client_ip}:{path}"

        limit, window_seconds = self.route_limits.get(path, (self.limit, self.window_seconds))
        if await self.rate_limiter.is_rate_limited(key, limit, window_seconds):
            retry_after = window_seconds
            return JSONResponse(
                status_code=429,
                content={
                    "detail": "Rate limit exceeded. Please retry later.",
                    "path": path,
                    "limit": limit,
                    "window_seconds": window_seconds,
                },
                headers={"Retry-After": str(retry_after)},
            )

        return await call_next(request)

    def _is_protected_path(self, path: str) -> bool:
        if path in self.protected_routes:
            return True

        # Protect plan-compatible invite route: /auth/tenants/{tenant_id}/invite
        return path.startswith(f"{self.auth_prefix}/tenants/") and path.endswith("/invite")
