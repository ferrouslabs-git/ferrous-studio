"""
Security headers middleware for baseline hardening.
"""
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Attach a standard set of security headers to every response."""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)

        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(self), geolocation=()"
        response.headers["X-Permitted-Cross-Domain-Policies"] = "none"
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
        # blob: appears in img-src, media-src and frame-src only -- the board's
        # attachment previews draw images and PDFs from same-origin object
        # URLs (the file is fetched from S3 over connect-src, then shown from
        # a blob). A blob: URL is low risk there; it must never be added to
        # script-src, worker-src or object-src, where it would let any
        # in-page string run as code.
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "base-uri 'self'; "
            "frame-ancestors 'none'; "
            "object-src 'none'; "
            "connect-src 'self' https://*.amazoncognito.com https://*.googleapis.com https://api.stripe.com https://s3.eu-west-1.amazonaws.com https://*.s3.eu-west-1.amazonaws.com; "
            "img-src 'self' data: blob: https://*.stripe.com; "
            "media-src 'self' blob: https://s3.eu-west-1.amazonaws.com https://*.s3.eu-west-1.amazonaws.com; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com; "
            "script-src 'self' https://js.stripe.com; "
            "frame-src blob: https://js.stripe.com https://hooks.stripe.com;"
        )

        return response
