"""Verify server: the real backend on :8081 with Cognito bypassed.

Local dev authenticates against the real STAGING Cognito pool, so a headless
browser cannot sign in. This runs the genuine app with ONLY `get_current_user`
overridden, resolved to the seeded studiotest user. Scope/tenant resolution,
the ops endpoints and every query stay real, so what the browser exercises is
the actual backend — not a mock.

Leaves the normal :8080 backend untouched; pair it with bridge.js, which
rewrites the browser's /api calls to :8081.

Usage (from anywhere):
    .venv312/Scripts/python.exe .claude/skills/run-local/verify_server.py
"""
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "backend"))

import uvicorn
from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import app.main as m
import app.studio.common as studio_common
from app.auth.database import get_db
from app.auth.security import dependencies as deps
from app.auth.models.user import User

# The only user in the dev DB with a membership (account_admin, Ferrous Labs Ltd).
EMAIL = "elliott+studiotest@ferrouslabs.co.uk"


async def _seeded_user(db: AsyncSession) -> User:
    result = await db.execute(select(User).where(User.email == EMAIL))
    return result.scalar_one()


async def fake_current_user(db: AsyncSession = Depends(get_db)) -> User:
    return await _seeded_user(db)


# Both maps matter: /api is a separately mounted FastAPI app that keeps its own
# dependency_overrides — overriding on the outer `app` alone does nothing.
for target in (m.app, m.api):
    target.dependency_overrides[deps.get_current_user] = fake_current_user


# ...and dependency_overrides is not enough on its own. Every board, wireframe
# and diagram route is guarded by studio.common.require_studio_permission,
# which CALLS get_current_user directly rather than through Depends() — it has
# to, because it chooses between a Cognito session and a board token after
# looking at the header, and FastAPI resolves a route's dependency tree before
# the route body runs. A direct call is invisible to dependency_overrides, so
# those routes 401 with "Authorization header required" while the rest of the
# studio happily returns 200. Patching the name in that module's namespace is
# what makes the board and the wireframes browsable here.
async def _patched_current_user(credentials=None, db: AsyncSession = None) -> User:
    return await _seeded_user(db)


studio_common.get_current_user = _patched_current_user

if __name__ == "__main__":
    uvicorn.run(m.app, host="127.0.0.1", port=8081, log_level="warning")
