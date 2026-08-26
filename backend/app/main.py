from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.auth.api import router as auth_router
from app.auth.logging_config import configure_logging
from app.auth.security import RateLimitMiddleware, SecurityHeadersMiddleware, TenantContextMiddleware
from app.config import get_settings
from app.database import AsyncSessionLocal
from app.health.router import router as health_router
from app.studio.router import router as studio_router

configure_logging()

settings = get_settings()
app = FastAPI(title=settings.app_name)

# Middleware lives on the outer app so it sees full /api/... paths (the auth
# module's path allow-lists are written against AUTH_API_PREFIX=/api/um).
# Starlette wraps in reverse registration order: the last add_middleware call
# is the outermost layer.
app.add_middleware(SecurityHeadersMiddleware)
# Auth-endpoint rate limiting. With a database it is shared across ECS tasks
# (rate_limit_hits table); without DATABASE_URL it degrades to per-process.
app.add_middleware(RateLimitMiddleware, get_db=AsyncSessionLocal)
# Early 400/401 for /api/um/* requests missing scope or bearer headers. Only a
# precheck: membership and permissions are still resolved per-route by
# get_scope_context / require_permission, and the studio API (outside the auth
# prefix) is untouched by it.
app.add_middleware(TenantContextMiddleware)

# Resolve once so the SPA fallback can safely check requested paths against it.
_FRONTEND_DIST_RESOLVED = settings.frontend_dist.resolve()

api = FastAPI(title=f"{settings.app_name}-api")
api.include_router(health_router)
# The auth module is mounted at /api/um — keep AUTH_API_PREFIX=/api/um (see
# backend/.env.local.example) in sync with this so cookie paths resolve
# correctly. See app/auth/config.py for what that env var drives.
api.include_router(auth_router, prefix="/um")
api.include_router(studio_router)

app.mount("/api", api)

frontend_dist: Path = settings.frontend_dist
frontend_index = frontend_dist / "index.html"
frontend_assets = frontend_dist / "assets"

if frontend_assets.exists():
    app.mount("/assets", StaticFiles(directory=frontend_assets), name="assets")


@app.get("/", include_in_schema=False)
def app_root():
    if frontend_index.exists():
        return FileResponse(frontend_index)
    return JSONResponse({"message": "frontend build not found", "hint": "build frontend/app/web"})


@app.get("/{path:path}", include_in_schema=False)
def spa_fallback(path: str):
    if path.startswith("api/"):
        return JSONResponse({"detail": "Not Found"}, status_code=404)

    # Serve real built files (favicon, etc) that live in the Vite dist root but
    # outside the hashed /assets mount. Without this they fall through to
    # index.html and the browser receives HTML where it expects CSS/JS.
    candidate = (_FRONTEND_DIST_RESOLVED / path).resolve()
    if (
        candidate.is_file()
        and (candidate == _FRONTEND_DIST_RESOLVED or _FRONTEND_DIST_RESOLVED in candidate.parents)
    ):
        return FileResponse(candidate)

    # Everything else is a client-side route: hand back the SPA shell.
    if frontend_index.exists():
        return FileResponse(frontend_index)
    return JSONResponse({"detail": "Not Found"}, status_code=404)
