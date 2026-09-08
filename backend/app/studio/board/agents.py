"""Agent runner scaffolding (phase 5). See docs/go-live-and-merge-boards.md
phase 5 and alembic/versions/b8e2c5f174ad's docstring for what this is and
deliberately is not: there is no per-organisation credential-storage design
yet for the GitHub/Claude credentials a real agent run would need, and
launch_agent_task refuses to pretend otherwise -- it reports "not
configured" rather than faking a launch, exactly like the Documents/GitHub
sections do without their own settings (app/config.py).

What IS real and tested: minting/revoking a board-scoped token, resolving it
into a narrowly-permissioned ScopeContext, and the queue/heartbeat/finish
bookkeeping an agent run goes through regardless of whether anything is
actually running.
"""
from __future__ import annotations

import hashlib
import secrets
from uuid import UUID

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.database import get_db
from app.auth.security.scope_context import ScopeContext
from app.config import get_settings

from .models import AgentRun, Board, BoardToken, Requirement, utc_now

TOKEN_PREFIX = "bt_"


# ── Minting / revoking ───────────────────────────────────────────────────


def _hash(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode()).hexdigest()


async def mint_board_token(db: AsyncSession, board: Board, label: str, created_by: UUID) -> tuple[BoardToken, str]:
    """Returns the row and the raw token -- the raw value is never stored and
    this is the only time it is ever available."""
    raw = TOKEN_PREFIX + secrets.token_urlsafe(32)
    row = BoardToken(board_id=board.id, account_id=board.account_id, label=label, token_hash=_hash(raw), created_by=created_by)
    db.add(row)
    await db.flush()
    return row, raw


async def revoke_board_token(db: AsyncSession, token: BoardToken) -> None:
    token.revoked_at = utc_now()


# ── Resolving a token into a scope (agent-side auth) ─────────────────────
#
# A separate path from get_current_user/get_scope_context: an agent is not a
# Cognito user, so it never goes through JWT verification. Deliberately
# narrow -- board:read/board:write only, is_super_admin always False, unlike
# the platform bypass. Only the two agent-reporting routes (heartbeat,
# finish) use this; everything else (minting, queueing) is human/Cognito.


async def _set_rls_vars_for_account(db: AsyncSession, account_id: UUID) -> None:
    if db.bind is None or db.bind.dialect.name != "postgresql":
        return
    await db.execute(text("SELECT set_config('app.current_scope_type', 'account', true)"), {})
    await db.execute(text("SELECT set_config('app.current_scope_id', :sid, true)"), {"sid": str(account_id)})
    await db.execute(text("SELECT set_config('app.is_super_admin', 'false', true)"))


async def require_board_token(
    authorization: str | None = Header(None),
    db: AsyncSession = Depends(get_db),
) -> tuple[ScopeContext, BoardToken]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Bearer board token required")
    raw = authorization.split(None, 1)[1].strip()

    token = (
        await db.execute(select(BoardToken).where(BoardToken.token_hash == _hash(raw)))
    ).scalar_one_or_none()
    if token is None or token.revoked_at is not None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or revoked board token")
    if token.created_by is None:
        # The minting user was deleted since; refuse rather than attribute
        # actions to nobody.
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Board token's creator no longer exists")

    token.last_used_at = utc_now()
    await _set_rls_vars_for_account(db, token.account_id)

    ctx = ScopeContext(
        user_id=token.created_by,
        scope_type="account",
        scope_id=token.account_id,
        active_roles=["agent"],
        resolved_permissions={"board:read", "board:write"},
        is_super_admin=False,
    )
    return ctx, token


# ── Queueing ──────────────────────────────────────────────────────────────


class QueueResult:
    NOT_FOUND = "not_found"
    NOT_QUEUABLE = "not_queuable"


async def queue_agent_run(
    db: AsyncSession, board: Board, requirement_id: UUID, actor_id: UUID
) -> AgentRun | str:
    """Same atomic-claim shape as claim_requirement (Phase 3): only a Todo
    requirement can be queued, and the row lock means two concurrent queue
    attempts can't both win."""
    requirement = (
        await db.execute(
            select(Requirement)
            .where(Requirement.id == requirement_id, Requirement.board_id == board.id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if requirement is None:
        return QueueResult.NOT_FOUND
    if requirement.status != "Todo":
        return QueueResult.NOT_QUEUABLE

    requirement.status = "Doing"
    requirement.updated_at = utc_now()
    run = AgentRun(board_id=board.id, account_id=board.account_id, requirement_id=requirement.id, created_by=actor_id, status="queued")
    db.add(run)
    await db.flush()
    return run


async def launch_agent_task(run: AgentRun) -> str | None:
    """Real boto3 call path, gated on config -- see app/config.py's
    agent_ecs_cluster/agent_task_definition docstring for why empty means
    "not configured", not "launch anyway". Returns an explanatory message
    when nothing was launched, or None on a real launch.

    Not exercised against real AWS in this pass: no ECR image, no task
    definition, and no per-organisation GitHub/Claude credential to inject
    even if there were -- that design is still undecided.
    """
    settings = get_settings()
    if not settings.agent_ecs_cluster or not settings.agent_task_definition:
        return "Agent execution is not configured in this environment (AGENT_ECS_CLUSTER/AGENT_TASK_DEFINITION unset)."

    import asyncio
    import boto3  # local import: keeps boto3/ECS out of every request that never launches anything

    def run_task() -> dict:
        client = boto3.client("ecs", region_name=settings.aws_region)
        return client.run_task(
            cluster=settings.agent_ecs_cluster,
            taskDefinition=settings.agent_task_definition,
            launchType="FARGATE",
            overrides={
                "containerOverrides": [
                    {"name": "agent-runner", "environment": [{"name": "AGENT_RUN_ID", "value": str(run.id)}]}
                ]
            },
        )

    # Blocking network call, offloaded to a thread -- same pattern as
    # storage.py/email_service for boto3 calls made from an async route.
    response = await asyncio.to_thread(run_task)
    run.ecs_task_arn = response["tasks"][0]["taskArn"]
    run.status = "running"
    run.started_at = utc_now()
    return None


# ── Agent-reported status (board-token-authenticated) ────────────────────


async def report_heartbeat(db: AsyncSession, run: AgentRun) -> None:
    run.heartbeat_at = utc_now()


async def report_finished(db: AsyncSession, run: AgentRun, success: bool, error: str | None = None) -> None:
    run.status = "done" if success else "failed"
    run.finished_at = utc_now()
    run.error = error
