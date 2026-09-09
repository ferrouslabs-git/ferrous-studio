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
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.database import get_db
from app.auth.security.dependencies import _set_rls_vars
from app.auth.security.scope_context import ScopeContext
from app.config import get_settings

from .models import Agent, AgentRun, Board, BoardToken, Requirement, Sprint, utc_now

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
    """Thin wrapper over the shared _set_rls_vars (app/auth/security/
    dependencies.py) -- board-token requests need the exact same
    after_begin re-application it registers, or a route that commits
    mid-request (add() -> commit() -> refresh(), same as any human-session
    route) hits the identical "Could not refresh instance" RLS bug that fix
    closed for Cognito sessions. Duplicating the GUC-setting SQL here
    instead would silently drift the two paths apart again."""
    await _set_rls_vars(db, "account", account_id, is_super_admin=False)


async def require_board_token(
    authorization: str | None = Header(None),
    db: AsyncSession = Depends(get_db),
) -> tuple[ScopeContext, BoardToken]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Bearer board token required")
    raw = authorization.split(None, 1)[1].strip()

    # board_tokens is FORCE ROW LEVEL SECURITY, and looking a token up by its
    # hash is the one query that must run before its account_id is known --
    # that's the whole point of the lookup. With no scope set yet, RLS's
    # USING clause is neither the bypass OR nor an account match, so it
    # silently returns zero rows regardless of whether the token exists.
    # Never caught locally (the local Postgres role is a superuser and
    # bypasses RLS outright) or by this session's own earlier testing (same
    # reason) -- only surfaced against a real non-superuser role, in
    # production, on the very feature this fix was supposed to complete.
    # Bypass for this one lookup only; _set_rls_vars_for_account below
    # immediately replaces it with the token's real, narrow scope.
    await _set_rls_vars(db, "account", UUID(int=0), is_super_admin=True)
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


# ── Persistent named agents (sprint-scoped) ──────────────────────────────
#
# Ported from software-management's agents table/main.py: unlike AgentRun
# above (one single attempt), an Agent is started and stopped repeatedly
# over its lifetime and works its assigned sprint's Todo requirements in
# queue order. Same "not configured" honesty as launch_agent_task -- see
# app/config.py's agent_ecs_cluster/agent_task_definition/agent_subnets/
# agent_security_group docstring.


async def create_agent(db: AsyncSession, board: Board, name: str, created_by: UUID) -> Agent:
    """Every agent gets its own real board_tokens row (mint_board_token) --
    same credential a human-facing MCP client would use, just kept in the
    clear here (Agent.board_token) because the launched container has no
    human present to hand it a fresh one when it needs to re-authenticate."""
    token_row, raw = await mint_board_token(db, board, f"agent: {name}", created_by)
    agent = Agent(
        board_id=board.id, account_id=board.account_id, name=name,
        board_token_id=token_row.id, board_token=raw,
    )
    db.add(agent)
    await db.flush()
    return agent


async def delete_agent(db: AsyncSession, agent: Agent) -> None:
    """Stops the real task first if one is running (best-effort -- an AWS
    hiccup here shouldn't block deleting the row), then revokes the
    agent's own board token so a container that's already running loses
    its credential rather than being left able to keep calling the API."""
    if agent.status == "running" and agent.task_arn:
        try:
            await stop_agent_task(agent.task_arn)
        except Exception:
            pass
    if agent.board_token_id is not None:
        token = (await db.execute(select(BoardToken).where(BoardToken.id == agent.board_token_id))).scalar_one_or_none()
        if token is not None:
            await revoke_board_token(db, token)
    await db.delete(agent)


async def launch_agent(agent: Agent) -> str | None:
    """Returns the launched task's ARN, or raises RuntimeError with a
    human-readable reason (including "not configured") -- callers turn
    that into a 502/422 rather than a silent no-op. Scoped by sprint:
    AGENT_SPRINT tells the launched container which sprint to work, in
    queue order within it."""
    settings = get_settings()
    if not all((settings.agent_ecs_cluster, settings.agent_task_definition, settings.agent_subnets, settings.agent_security_group)):
        raise RuntimeError(
            "Agent execution is not configured in this environment "
            "(AGENT_ECS_CLUSTER/AGENT_TASK_DEFINITION/AGENT_SUBNETS/AGENT_SECURITY_GROUP unset)."
        )
    if not agent.sprint_id:
        # An agent works its assigned sprint and nothing else, so starting
        # one without a sprint would burn a Fargate task to do nothing.
        raise RuntimeError("Assign a sprint before starting this agent.")

    import asyncio
    import boto3  # local import: keeps boto3/ECS out of every request that never launches anything

    env = [{"name": "AGENT_ID", "value": str(agent.id)}, {"name": "AGENT_SPRINT", "value": str(agent.sprint_id)}]
    if agent.board_token:
        env.append({"name": "FERROUS_BOARD_TOKEN", "value": agent.board_token})

    def run_task() -> dict:
        client = boto3.client("ecs", region_name=settings.aws_region)
        return client.run_task(
            cluster=settings.agent_ecs_cluster,
            taskDefinition=settings.agent_task_definition,
            launchType="FARGATE",
            networkConfiguration={"awsvpcConfiguration": {
                "subnets": settings.agent_subnets,
                "securityGroups": [settings.agent_security_group],
                "assignPublicIp": "ENABLED",
            }},
            overrides={"containerOverrides": [{"name": "agent", "environment": env}]},
        )

    response = await asyncio.to_thread(run_task)
    failures = response.get("failures") or []
    if failures:
        raise RuntimeError(failures[0].get("reason", "ECS run_task failed"))
    return response["tasks"][0]["taskArn"]


async def stop_agent_task(task_arn: str) -> None:
    import asyncio
    import boto3

    settings = get_settings()

    def stop() -> None:
        client = boto3.client("ecs", region_name=settings.aws_region)
        client.stop_task(cluster=settings.agent_ecs_cluster, task=task_arn, reason="Task stopped by user")

    await asyncio.to_thread(stop)


async def sync_agent_status(agent: Agent) -> None:
    """Lazy status sync, called from list_agents -- no background thread/
    cron (nothing else in this codebase runs one either). If ECS reports a
    'running' agent's task isn't actually running anymore, reconcile the
    row before it's returned. A clean (0) container exit is the NORMAL way
    for a task to end once it's drained its queue, not a failure -- only a
    nonzero exit or a task that never started at all becomes status=error,
    with the real reason surfaced."""
    if agent.status != "running" or not agent.task_arn:
        return
    settings = get_settings()
    if not settings.agent_ecs_cluster:
        return

    import asyncio
    import boto3

    def describe() -> dict:
        client = boto3.client("ecs", region_name=settings.aws_region)
        return client.describe_tasks(cluster=settings.agent_ecs_cluster, tasks=[agent.task_arn])

    try:
        desc = await asyncio.to_thread(describe)
    except Exception:
        return  # transient AWS error -- don't flip status on a blip

    tasks = desc.get("tasks") or []
    if tasks and tasks[0].get("lastStatus") != "STOPPED":
        return
    if not tasks:
        new_status, reason = "error", "task not found"
    else:
        stop_reason = tasks[0].get("stoppedReason") or ""
        containers = tasks[0].get("containers") or []
        exit_code = containers[0].get("exitCode") if containers else None
        if stop_reason == "Task stopped by user" or exit_code == 0:
            new_status, reason = "stopped", None
        else:
            new_status = "error"
            reason = (containers[0].get("reason") if containers else None) or stop_reason or f"exit code {exit_code}"
    agent.status = new_status
    agent.desired_state = "stopped"
    agent.task_arn = None
    agent.last_error = reason


async def maybe_wake_agent(db: AsyncSession, board: Board, sprint_id: UUID | None) -> None:
    """Wake an agent assigned to `sprint_id`, if one exists and none is
    already running for that sprint. Call when work lands in a sprint or a
    sprint is started. Only an ACTIVE sprint wakes anything -- starting a
    sprint is what releases its work to agents. Best-effort: a failure
    here never fails the write that triggered it, it just leaves the
    agent stopped and visible as such."""
    if not sprint_id:
        return
    sprint = (await db.execute(select(Sprint).where(Sprint.id == sprint_id))).scalar_one_or_none()
    if sprint is None or sprint.state != "active":
        return
    assigned = list((await db.execute(select(Agent).where(Agent.sprint_id == sprint_id))).scalars().all())
    if any(a.status == "running" for a in assigned):
        return
    candidate = next((a for a in assigned if a.status != "running"), None)
    if not candidate:
        return
    try:
        arn = await launch_agent(candidate)
        candidate.status = "running"
        candidate.desired_state = "running"
        candidate.task_arn = arn
        candidate.last_error = None
    except Exception:
        pass
