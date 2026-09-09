#!/usr/bin/env python
"""Promote one existing user to the first platform admin (super admin).

Why this exists: the only API route that grants platform admin
(PATCH /api/um/platform/users/{id}/promote) requires the caller to already be
a platform admin, and ``users.is_platform_admin`` defaults to false with no
seed anywhere. A fresh environment therefore has no way to create its first
super admin -- which blocks invite-only onboarding entirely.

This is deliberately a one-shot: it refuses to run once *any* platform admin
exists. There are two better tools after the first one, and neither needs
database access:

* **Adding an admin** -- an existing platform admin promotes someone from the
  Admin -> Users page (``PATCH /api/um/platform/users/{id}/promote``, audited),
  or invites one directly (``POST /api/um/platform/invite``).
* **Seeding admins** -- set ``PLATFORM_ADMIN_EMAILS`` (see
  ``app/auth/config.py``) and those addresses become platform admins at their
  next sign-in. That is how a deployed environment gets admins without anyone
  reaching the private RDS.

It is a script rather than an Alembic seed because the right email differs
per environment, and a migration that hardcodes one would be wrong everywhere
except the place it was written.

Usage (from the repo root, with backend/.env.local providing DATABASE_URL):

    python backend/scripts/bootstrap_admin.py you@example.com

The user must already exist: sign in once through the app so that
POST /api/um/sync creates the ``users`` row, then run this.
"""
from __future__ import annotations

import sys
from pathlib import Path

# Make ``app`` importable regardless of the working directory.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import func, select  # noqa: E402

from app.auth.models import User  # noqa: E402
from app.auth.models.membership import Membership  # noqa: E402
from app.auth.security.dependencies import PLATFORM_SCOPE_ID  # noqa: E402
from app.database import SessionLocal  # noqa: E402

PLATFORM_ROLE = "platform_admin"


def main(argv: list[str]) -> int:
    if len(argv) != 2 or argv[1] in {"-h", "--help"}:
        print(__doc__.strip(), file=sys.stderr)
        return 1

    email = argv[1].strip().lower()

    if SessionLocal is None:
        print("DATABASE_URL is not configured (expected in backend/.env.local).", file=sys.stderr)
        return 1

    with SessionLocal() as db:
        existing = db.scalar(
            select(func.count()).select_from(User).where(User.is_platform_admin.is_(True))
        )
        if existing:
            print(
                f"Refusing: {existing} platform admin(s) already exist. "
                "Promote from the Admin -> Users page, or set PLATFORM_ADMIN_EMAILS "
                "to seed one without database access.",
                file=sys.stderr,
            )
            return 2

        user = db.scalar(select(User).where(func.lower(User.email) == email))
        if user is None:
            print(
                f"No user with email {email!r}. Sign in through the app once first so "
                "POST /api/um/sync creates the user row, then re-run.",
                file=sys.stderr,
            )
            return 3

        user.is_platform_admin = True
        membership = db.scalar(
            select(Membership).where(
                Membership.user_id == user.id,
                Membership.scope_type == "platform",
                Membership.scope_id == PLATFORM_SCOPE_ID,
            )
        )
        if membership:
            membership.role_name = PLATFORM_ROLE
            membership.status = "active"
        else:
            db.add(Membership(
                user_id=user.id,
                scope_type="platform",
                scope_id=PLATFORM_SCOPE_ID,
                role_name=PLATFORM_ROLE,
                status="active",
            ))
        db.commit()

    print(f"{email} is now a platform admin.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
