from __future__ import annotations

import base64
import binascii
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

    # ── GitHub App (linking a project to its repository) ──────────────────
    # A GitHub *App*, not an OAuth App: an installation grants access to the
    # repositories the organisation picks, and the only thing worth storing is
    # the installation id -- which is not a secret. Access tokens are minted on
    # demand from the private key and expire in an hour, so nothing long-lived
    # is ever written to our database. Empty app id or key = the Repository
    # section reports "not configured" rather than 500, the same way documents
    # do without a bucket.
    github_app_id: str
    #: The App's URL slug, used to build https://github.com/apps/<slug>/installations/new.
    github_app_slug: str
    #: PEM private key. Accepts a real multi-line PEM or a base64 blob of one,
    #: because most secret stores and CI environments cannot carry newlines.
    github_app_private_key: str
    #: The App's OAuth credentials, used only during installation. GitHub is
    #: asked to authorise the *user* as well as install the App, so the callback
    #: can prove the person who finished the flow genuinely has the installation
    #: they claim -- without this, a replayed installation id would hand an
    #: organisation read access to somebody else's repositories. The user token
    #: that exchange returns is checked once and thrown away, never stored.
    github_client_id: str
    github_client_secret: str
    #: Overridable for GitHub Enterprise Server.
    github_api_base: str

    # ── Project Agent chatbot (backend session, phase 1 -- see
    # docs/project-agent-implementation-plan.md) ───────────────────────────
    # Calls Claude through AWS Bedrock, not the Anthropic API directly -- the
    # ECS task's own IAM role is the credential (see infra/terraform/iam.tf's
    # bedrock_claude policy), so there is no key to store or rotate. Empty
    # model id = the Project Agent tab reports "not configured" rather than
    # 500, the same convention as documents/GitHub above. This is the
    # platform's own shared credential (every organisation's chat runs on
    # it for now) -- an org bringing its own key/account is a later, separate
    # idea, deliberately not designed yet. The model id is a Bedrock
    # *inference profile* id, not the plain Anthropic API model alias --
    # this model has no direct on-demand invocation.
    #
    # TEMPORARY: defaults to Sonnet 4.5, not Sonnet 5. Confirmed live against
    # the real account (2026-09-11) that Sonnet 5 (and Sonnet 4, which is
    # legacy) 403/404 -- Anthropic's Bedrock model-access terms have not been
    # accepted for it yet (AWS Console -> Bedrock -> Model access; a business
    # decision, not something to grant from code). Sonnet 4.5 and Opus 4.5
    # both work today. Switch this back once Sonnet 5 access is granted --
    # infra/terraform/iam.tf's bedrock_claude policy already grants both.
    bedrock_claude_model: str

    # ── Agent runner (phase 5, deliberately not deployed yet) ──────────────
    # Empty cluster/task definition = an agent run is recorded (queued) but
    # never actually launched -- the API reports "not configured" rather than
    # a 500, the same way documents/GitHub do without their own settings. See
    # docs/go-live-and-merge-boards.md phase 5: this also needs a real
    # per-organisation credential-storage design before it can run for real,
    # which is a separate, undecided piece -- this setting alone does not
    # make the feature safe to turn on.
    agent_ecs_cluster: str
    agent_task_definition: str
    agent_subnets: list[str]
    agent_security_group: str
    # Best-effort only -- a notification posted on Blocked/Done never gates
    # anything. Empty = notifications are silently skipped.
    slack_webhook_url: str



def _int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    return int(raw) if raw else default


def _pem(name: str) -> str:
    """A PEM private key from the environment, however it survived transport.

    Secret stores, ECS task definitions and .env files all mangle newlines
    differently, so three shapes are accepted: a real multi-line PEM, one with
    literal backslash-n escapes, and a base64 blob of either. Anything that
    does not end up looking like a PEM is returned as-is and fails loudly at
    signing time rather than being silently treated as absent.
    """
    raw = os.getenv(name, "").strip()
    if not raw:
        return ""
    if "-----BEGIN" not in raw:
        try:
            raw = base64.b64decode(raw, validate=True).decode("utf-8").strip()
        except (binascii.Error, UnicodeDecodeError, ValueError):
            return raw
    return raw.replace("\\n", "\n")


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
        github_app_id=os.getenv("GITHUB_APP_ID", "").strip(),
        github_app_slug=os.getenv("GITHUB_APP_SLUG", "").strip(),
        github_app_private_key=_pem("GITHUB_APP_PRIVATE_KEY"),
        github_client_id=os.getenv("GITHUB_CLIENT_ID", "").strip(),
        github_client_secret=os.getenv("GITHUB_CLIENT_SECRET", "").strip(),
        github_api_base=os.getenv("GITHUB_API_BASE", "https://api.github.com").strip().rstrip("/"),
        bedrock_claude_model=os.getenv("BEDROCK_CLAUDE_MODEL", "eu.anthropic.claude-sonnet-4-5-20250929-v1:0").strip(),
        agent_ecs_cluster=os.getenv("AGENT_ECS_CLUSTER", "").strip(),
        agent_task_definition=os.getenv("AGENT_TASK_DEFINITION", "").strip(),
        agent_subnets=[s.strip() for s in os.getenv("AGENT_SUBNETS", "").split(",") if s.strip()],
        agent_security_group=os.getenv("AGENT_SECURITY_GROUP", "").strip(),
        slack_webhook_url=os.getenv("SLACK_WEBHOOK_URL", "").strip(),
    )
