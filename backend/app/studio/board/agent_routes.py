"""Agent runner scaffolding routes (phase 5). See agents.py's module
docstring: minting/queueing/reporting are real and tested; launch_agent_task
reports "not configured" rather than actually running anything, since the
per-organisation credential storage it would need doesn't exist yet.

Two different auth paths on purpose:
- Minting a token and queueing a run are human actions -> normal Cognito
  require_permission, same as every other board route.
- Reporting heartbeat/finished are things the AGENT does, holding a board
  token, not a Cognito session -> require_board_token (agents.py), and these
  routes carry no /projects/{project_id} prefix since an agent run already
  knows its own board_id.
"""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.database import get_db
from app.auth.security import require_permission
from app.auth.security.scope_context import ScopeContext

from ..common import get_project
from . import service
from .agents import (
    launch_agent_task,
    mint_board_token,
    QueueResult,
    queue_agent_run,
    report_finished,
    report_heartbeat,
    require_board_token,
    revoke_board_token,
)
from .models import AgentRun, Board, BoardToken
from .schemas import (
    AgentRunFinish,
    AgentRunQueued,
    AgentRunRead,
    BoardTokenCreate,
    BoardTokenIssued,
    BoardTokenRead,
)

router = APIRouter()


async def _board(db: AsyncSession, project) -> Board:
    return await service.get_or_create_board(db, project)


# ── Tokens (human, Cognito, account_admin only) ──────────────────────────


@router.post(
    "/projects/{project_id}/board/tokens", response_model=BoardTokenIssued, status_code=status.HTTP_201_CREATED
)
async def create_board_token(
    project_id: UUID,
    payload: BoardTokenCreate,
    ctx: ScopeContext = Depends(require_permission("board:tokens")),
    db: AsyncSession = Depends(get_db),
) -> BoardTokenIssued:
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    token, raw = await mint_board_token(db, board, payload.label, ctx.user_id)
    await db.commit()
    await db.refresh(token)
    return BoardTokenIssued(**BoardTokenRead.model_validate(token).model_dump(), token=raw)


@router.get("/projects/{project_id}/board/tokens", response_model=list[BoardTokenRead])
async def list_board_tokens(
    project_id: UUID,
    ctx: ScopeContext = Depends(require_permission("board:tokens")),
    db: AsyncSession = Depends(get_db),
) -> list[BoardToken]:
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    result = await db.execute(select(BoardToken).where(BoardToken.board_id == board.id).order_by(BoardToken.created_at.desc()))
    return list(result.scalars().all())


@router.delete("/projects/{project_id}/board/tokens/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_board_token_route(
    project_id: UUID,
    token_id: UUID,
    ctx: ScopeContext = Depends(require_permission("board:tokens")),
    db: AsyncSession = Depends(get_db),
) -> None:
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    token = (
        await db.execute(select(BoardToken).where(BoardToken.id == token_id, BoardToken.board_id == board.id))
    ).scalar_one_or_none()
    if token is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Token not found")
    await revoke_board_token(db, token)
    await db.commit()


# ── Agent runs: queueing + listing (human, Cognito) ──────────────────────


@router.post(
    "/projects/{project_id}/board/requirements/{requirement_id}/agent-runs",
    response_model=AgentRunQueued,
    status_code=status.HTTP_201_CREATED,
)
async def queue_agent_run_route(
    project_id: UUID,
    requirement_id: UUID,
    ctx: ScopeContext = Depends(require_permission("board:write")),
    db: AsyncSession = Depends(get_db),
) -> AgentRunQueued:
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    result = await queue_agent_run(db, board, requirement_id, ctx.user_id)
    if result == QueueResult.NOT_FOUND:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Requirement not found")
    if result == QueueResult.NOT_QUEUABLE:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Requirement is not in Todo")

    launch_message = await launch_agent_task(result)
    await db.commit()
    await db.refresh(result)
    return AgentRunQueued(run=AgentRunRead.model_validate(result), launch_message=launch_message)


@router.get("/projects/{project_id}/board/agent-runs", response_model=list[AgentRunRead])
async def list_agent_runs(
    project_id: UUID,
    ctx: ScopeContext = Depends(require_permission("board:read")),
    db: AsyncSession = Depends(get_db),
) -> list[AgentRun]:
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    result = await db.execute(select(AgentRun).where(AgentRun.board_id == board.id).order_by(AgentRun.created_at.desc()))
    return list(result.scalars().all())


# ── Agent-reported status (board-token-authenticated, no project prefix) ──


async def _get_run_for_token(db: AsyncSession, run_id: UUID, token: BoardToken) -> AgentRun:
    run = (
        await db.execute(select(AgentRun).where(AgentRun.id == run_id, AgentRun.board_id == token.board_id))
    ).scalar_one_or_none()
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent run not found")
    return run


@router.post("/board/agent-runs/{run_id}/heartbeat", status_code=status.HTTP_204_NO_CONTENT)
async def heartbeat_agent_run(
    run_id: UUID,
    auth=Depends(require_board_token),
    db: AsyncSession = Depends(get_db),
) -> None:
    _ctx, token = auth
    run = await _get_run_for_token(db, run_id, token)
    await report_heartbeat(db, run)
    await db.commit()


@router.post("/board/agent-runs/{run_id}/finish", response_model=AgentRunRead)
async def finish_agent_run(
    run_id: UUID,
    payload: AgentRunFinish,
    auth=Depends(require_board_token),
    db: AsyncSession = Depends(get_db),
) -> AgentRun:
    _ctx, token = auth
    run = await _get_run_for_token(db, run_id, token)
    await report_finished(db, run, payload.success, payload.error)
    await db.commit()
    await db.refresh(run)
    return run
