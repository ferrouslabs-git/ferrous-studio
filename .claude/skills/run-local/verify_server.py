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
from app.auth.database import get_db
from app.auth.security import dependencies as deps
from app.auth.models.user import User

# The only user in the dev DB with a membership (account_admin, Ferrous Labs Ltd).
EMAIL = "elliott+studiotest@ferrouslabs.co.uk"


async def fake_current_user(db: AsyncSession = Depends(get_db)) -> User:
    result = await db.execute(select(User).where(User.email == EMAIL))
    return result.scalar_one()


# Both maps matter: /api is a separately mounted FastAPI app that keeps its own
# dependency_overrides — overriding on the outer `app` alone does nothing.
for target in (m.app, m.api):
    target.dependency_overrides[deps.get_current_user] = fake_current_user

if __name__ == "__main__":
    uvicorn.run(m.app, host="127.0.0.1", port=8081, log_level="warning")
