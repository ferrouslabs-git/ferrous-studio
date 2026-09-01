from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env.local", override=True)


@dataclass(frozen=True)
class Settings:
    app_name: str
    app_env: str
    aws_region: str
    frontend_dist: Path
    # SQLAlchemy URL, e.g. postgresql+psycopg://user:***@host:5432/<product>_staging.
    # One database per environment (see infra/docs/onboarding-runbook.md) — no
    # DB_SCHEMA/search_path plumbing needed, unlike processmapper's shared-DB setup.
    database_url: str
    # Public base URL for absolute links in emails (invitations, etc). Without this
    # an invite link is relative and mail clients render it as http:///... (invalid).
    app_public_url: str

    # ── Project documents (S3, presigned direct uploads) ──────────────────
    # Empty = the Documents section reports "not configured" rather than 500.
    documents_bucket: str
    documents_max_bytes: int
    presign_ttl_seconds: int



def _int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    return int(raw) if raw else default


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    project_root = Path(__file__).resolve().parents[2]
    default_frontend_dist = project_root / "frontend" / "app" / "web" / "dist"

    return Settings(
        app_name=os.getenv("APP_NAME", "webapp-api"),
        app_env=os.getenv("APP_ENV", "local"),
        aws_region=os.getenv("AWS_REGION", "eu-west-1"),
        frontend_dist=Path(os.getenv("FRONTEND_DIST", str(default_frontend_dist))),
        database_url=os.getenv("DATABASE_URL", "").strip(),
        app_public_url=os.getenv("APP_PUBLIC_URL", "").strip(),
        documents_bucket=os.getenv("DOCUMENTS_BUCKET", "").strip(),
        documents_max_bytes=_int("DOCUMENTS_MAX_BYTES", 25 * 1024 * 1024),
        presign_ttl_seconds=_int("PRESIGN_TTL_SECONDS", 900),
    )
