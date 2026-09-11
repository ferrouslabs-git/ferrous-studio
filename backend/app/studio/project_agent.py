"""The Project Agent chatbot: a per-project conversation with Claude.

Phase 1 only (see docs/project-agent-implementation-plan.md) -- plain
back-and-forth text, no tools. The agent cannot yet do anything to the
project (create wireframes, touch the board); it can only talk about it.
Wiring it to real actions is Phase 2, deliberately not built here.

Runs on the platform's own Anthropic key (``ANTHROPIC_API_KEY``), shared by
every organisation -- there is no per-organisation credential yet, and
letting an organisation bring its own key/account is a later, separate
idea (Elliott's own words: "no need to do this now"). An unconfigured
deployment reports the tab as unavailable rather than 500ing, the same
convention ``github_client.py`` and the documents section already use.
"""
from __future__ import annotations

from typing import Any
from uuid import UUID

import anthropic
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.database import get_db
from app.auth.security import require_permission
from app.auth.security.scope_context import ScopeContext
from app.config import get_settings

from .common import get_project, get_writable_project
from .models import Project, ProjectAgentMessage, ProjectDiagram, Wireframe
from .projects import _count
from .schemas import ProjectAgentMessageRead, ProjectAgentSend, ProjectAgentStatus

router = APIRouter(prefix="/projects/{project_id}/agent", tags=["project-agent"])

#: Generous enough for a long back-and-forth without an unbounded prompt --
#: revisit once Phase 2 adds tool results, which are typically much larger
#: than a chat turn.
MAX_HISTORY_MESSAGES = 40

SYSTEM_PROMPT = (
    "You are Project Agent, an assistant embedded in one specific project inside "
    "Ferrous Studio, a product-design and delivery tool. You are having an ongoing "
    "conversation with someone working on this project only -- you have no visibility "
    "into any other project, and never claim to. Be direct and concise. "
    "You do not yet have the ability to change anything in the project -- you can "
    "only discuss it -- so say so plainly if asked to build or modify something, "
    "rather than pretending to have done it. If asked to do something that needs a "
    "connected repository (e.g. reverse-engineering wireframes from existing code) "
    "and none is connected, say so plainly and point them at Project details -> "
    "Repository to connect one first, rather than proceeding as if one exists. If "
    "asked to build wireframes or diagrams and this project already has some, say "
    "so plainly (mention the actual counts you were given) and ask whether they "
    "want more added alongside the existing ones or mean something else, rather "
    "than ignoring what already exists."
)


def configured() -> bool:
    return bool(get_settings().anthropic_api_key)


@router.get("/status", response_model=ProjectAgentStatus)
async def agent_status() -> ProjectAgentStatus:
    """Whether this deployment can run the chatbot at all -- checked before
    the tab shows a compose box, the same way the Repository section checks
    GitHub configuration first."""
    return ProjectAgentStatus(configured=configured())


@router.get("/messages", response_model=list[ProjectAgentMessageRead])
async def list_messages(
    project_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:read")),
    db: AsyncSession = Depends(get_db),
) -> list[ProjectAgentMessage]:
    """The project's whole conversation so far, oldest first. Reading works
    on a locked version too -- there is nothing here that changes with the
    lock, unlike sending a message, which may eventually write content."""
    project = await get_project(db, project_id, ctx)
    result = await db.execute(
        select(ProjectAgentMessage)
        .where(ProjectAgentMessage.project_id == project.id)
        .order_by(ProjectAgentMessage.created_at)
    )
    return list(result.scalars().all())


@router.post("/messages", response_model=ProjectAgentMessageRead)
async def send_message(
    project_id: UUID,
    payload: ProjectAgentSend,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> ProjectAgentMessage:
    """Send one message, get the assistant's reply back synchronously.

    Locked-version-aware (``get_writable_project``) even though Phase 1
    writes nothing to the project itself, because a locked version is a
    frozen record of what was agreed -- a conversation that could, in a
    later phase, change that record has no business continuing against it.
    """
    project = await get_writable_project(db, project_id, ctx)
    if not configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Project Agent is not configured on this deployment (ANTHROPIC_API_KEY unset).",
        )

    history_result = await db.execute(
        select(ProjectAgentMessage)
        .where(ProjectAgentMessage.project_id == project.id)
        .order_by(ProjectAgentMessage.created_at.desc())
        .limit(MAX_HISTORY_MESSAGES)
    )
    history = list(reversed(history_result.scalars().all()))

    wireframe_count = await _count(db, Wireframe, project)
    diagram_count = await _count(db, ProjectDiagram, project)

    user_message = ProjectAgentMessage(
        project_id=project.id,
        account_id=project.account_id,
        role="user",
        content=payload.content,
        created_by=ctx.user_id,
    )
    db.add(user_message)
    await db.flush()

    reply_text = await _ask_claude(
        project_name=project.name,
        repo_full_name=project.repo_full_name,
        wireframe_count=wireframe_count,
        diagram_count=diagram_count,
        history=[*history, user_message],
    )

    assistant_message = ProjectAgentMessage(
        project_id=project.id,
        account_id=project.account_id,
        role="assistant",
        content=reply_text,
        created_by=None,
    )
    db.add(assistant_message)
    await db.commit()
    await db.refresh(assistant_message)
    return assistant_message


async def _ask_claude(
    *,
    project_name: str,
    repo_full_name: str | None,
    wireframe_count: int = 0,
    diagram_count: int = 0,
    history: list[ProjectAgentMessage],
) -> str:
    settings = get_settings()
    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    messages: list[dict[str, Any]] = [{"role": m.role, "content": m.content} for m in history]
    repo_fact = (
        f'A repository is connected: "{repo_full_name}".'
        if repo_full_name
        else "No repository is connected to this project yet."
    )
    content_fact = (
        f"This project already has {wireframe_count} wireframe(s) and {diagram_count} diagram(s)."
        if wireframe_count or diagram_count
        else "This project has no wireframes or diagrams yet."
    )
    system = (
        f'{SYSTEM_PROMPT}\n\nThe project you are discussing is called "{project_name}". '
        f"{repo_fact} {content_fact}"
    )
    try:
        response = await client.messages.create(
            model=settings.anthropic_model,
            max_tokens=2048,
            system=system,
            messages=messages,
        )
    except anthropic.AuthenticationError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="Project Agent's credentials were rejected."
        ) from exc
    except anthropic.APIStatusError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Project Agent could not reply: {exc}") from exc
    except anthropic.APIConnectionError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="Project Agent could not be reached."
        ) from exc

    text_blocks = [block.text for block in response.content if block.type == "text"]
    return "".join(text_blocks).strip() or "(no reply)"
