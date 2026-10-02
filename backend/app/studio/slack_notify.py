"""Posting board activity to an organisation's Slack channel.

Every board mutation already records a ``board_events`` row through
``service.write_event``. That is the one place this hooks in: ``write_event``
calls :func:`stage`, which remembers the events worth announcing on the
session, and a SQLAlchemy ``after_commit`` listener hands them to
:func:`dispatch` as a background task.

Two properties matter and both come from that arrangement:

  * **Nothing is announced that did not happen.** The event is only released
    once its transaction has committed; a rollback discards it.
  * **Slack can never break the board.** Posting runs after the response path
    has finished, in its own session, and every failure is logged and dropped.
    A Slack outage, a revoked token or a missing channel costs a notification,
    never a save.

Announced: a requirement's status changing, a new feedback report, a new
comment. Everything else is left alone on purpose -- a channel that carries
every edit gets muted.
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import event, select
from sqlalchemy.orm import Session

from app.auth.config import get_settings as get_auth_settings
from app.database import AsyncSessionLocal

from . import slack_client
from .board.models import Board, Feature, Feedback, Requirement, remember_board_key
from .models import Project, SlackConnection

logger = logging.getLogger(__name__)

STAGED_KEY = "slack_staged_events"

#: Held so a task is not garbage-collected before it finishes.
_tasks: set[asyncio.Task] = set()


@dataclass(frozen=True)
class StagedEvent:
    account_id: UUID
    board_id: UUID
    actor_id: UUID | None
    action: str
    entity_type: str
    entity_id: UUID
    detail: dict[str, Any]


def wants(action: str, detail: dict[str, Any] | None) -> bool:
    if action in ("feedback.created", "comment.created"):
        return True
    return action == "requirement.updated" and "status" in (detail or {})


def stage(session: Session, board: Board, actor_id: UUID | None, action: str, entity_type: str, entity_id: UUID, detail: dict[str, Any] | None) -> None:
    """Remember an event to announce once ``session`` commits."""
    if not wants(action, detail):
        return
    session.info.setdefault(STAGED_KEY, []).append(
        StagedEvent(board.account_id, board.id, actor_id, action, entity_type, entity_id, dict(detail or {}))
    )


@event.listens_for(Session, "after_commit")
def _release_staged(session: Session) -> None:
    staged = session.info.pop(STAGED_KEY, None)
    if not staged:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return  # a script or a sync test: nobody to post
    task = loop.create_task(dispatch(staged))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


@event.listens_for(Session, "after_rollback")
def _discard_staged(session: Session) -> None:
    session.info.pop(STAGED_KEY, None)


# ── Wording ────────────────────────────────────────────────────────────────


def escape(text: str) -> str:
    """Slack's three reserved characters. Escaping ``<`` also defuses
    ``<!channel>`` and ``<@user>`` mentions smuggled in through a title."""
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def clip(text: str, limit: int = 300) -> str:
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


STATUS_LABEL = {
    "NotStarted": "Not started",
    "InProgress": "In progress",
    "ToTest": "To test",
    "Done": "Done",
    "Blocked": "Blocked",
}


def status_label(status: str | None) -> str:
    return STATUS_LABEL.get(status or "", status or "?")


def link(label: str, url: str | None) -> str:
    return f"<{url}|{escape(label)}>" if url else f"*{escape(label)}*"


def section(text: str) -> dict[str, Any]:
    return {"type": "section", "text": {"type": "mrkdwn", "text": text}}


def context(text: str) -> dict[str, Any]:
    return {"type": "context", "elements": [{"type": "mrkdwn", "text": text}]}


async def _label_for(db, board_id: UUID, entity_type: str, entity_id: UUID) -> tuple[str, str | None]:
    """``("FS-REQ-12", "the title")`` for something a comment is on."""
    from .board.service import _ENTITY_TABLES

    model = _ENTITY_TABLES.get(entity_type)
    if model is None:
        return entity_type, None
    row = (await db.execute(select(model).where(model.id == entity_id, model.board_id == board_id))).scalar_one_or_none()
    if row is None:
        return entity_type, None
    title = getattr(row, "title", None) or getattr(row, "name", None)
    return getattr(row, "human_id", entity_type), title


async def _project_url(db, board: Board) -> tuple[str | None, str | None, str | None]:
    """``(project name, project base url, epics url)`` for the board's newest version."""
    project = (
        await db.execute(
            select(Project)
            .where(Project.account_id == board.account_id, Project.lineage_id == board.lineage_id)
            .order_by(Project.version_no.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if project is None:
        return None, None, None
    base = f"{get_auth_settings().frontend_url.rstrip('/')}/orgs/{board.account_id}/projects/{project.id}"
    return project.name, base, f"{base}/epics"


async def _who(db, user_id: UUID | None) -> str:
    if user_id is None:
        return "Someone"
    from app.auth.models.user import User

    user = await db.get(User, user_id)
    return (user.name or user.email) if user else "Someone"


async def describe(db, ev: StagedEvent) -> tuple[str, list[dict[str, Any]]] | None:
    """The message for one event as ``(fallback text, blocks)``, or None to skip."""
    board = await db.get(Board, ev.board_id)
    if board is None:
        return None
    remember_board_key(board)
    project_name, base, epics_url = await _project_url(db, board)
    who = escape(await _who(db, ev.actor_id))
    where = f" · {escape(project_name)}" if project_name else ""

    if ev.action == "requirement.updated":
        row = (await db.execute(select(Requirement).where(Requirement.id == ev.entity_id))).scalar_one_or_none()
        if row is None:
            return None
        change = ev.detail.get("status") or {}
        epic_id = row.epic_id
        if epic_id is None and row.feature_id:
            feature = await db.get(Feature, row.feature_id)
            epic_id = feature.epic_id if feature else None
        url = f"{epics_url}/{epic_id}?req={row.id}" if epics_url and epic_id else epics_url
        text = f"{row.human_id} moved to {status_label(change.get('to'))}"
        return text, [
            section(f"{link(row.human_id, url)}  {escape(clip(row.title, 150))}\n"
                    f"{status_label(change.get('from'))} → *{status_label(change.get('to'))}* by {who}"),
            context(f"Requirement{where}"),
        ]

    if ev.action == "feedback.created":
        row = (await db.execute(select(Feedback).where(Feedback.id == ev.entity_id))).scalar_one_or_none()
        if row is None:
            return None
        url = f"{base}/feedback" if base else None
        text = f"New {row.kind} {row.human_id} in {row.environment}"
        return text, [
            section(f"{link(row.human_id, url)}  {escape(clip(row.title, 150))}\n"
                    f"*{escape(row.kind)}* · {escape(row.severity)} severity · {escape(row.environment)} · from {escape(row.raised_by_name or row.raised_by_email or 'someone')}"),
            context(f"Feedback{where}"),
        ]

    if ev.action == "comment.created":
        human_id, title = await _label_for(db, ev.board_id, ev.entity_type, ev.entity_id)
        excerpt = clip(str(ev.detail.get("excerpt") or "(attachment)"), 400)
        url = epics_url if ev.entity_type != "requirement" else None
        if ev.entity_type == "requirement":
            row = (await db.execute(select(Requirement).where(Requirement.id == ev.entity_id))).scalar_one_or_none()
            if row is not None and epics_url:
                epic_id = row.epic_id
                if epic_id is None and row.feature_id:
                    feature = await db.get(Feature, row.feature_id)
                    epic_id = feature.epic_id if feature else None
                url = f"{epics_url}/{epic_id}?req={row.id}" if epic_id else epics_url
        subject = link(human_id, url) + (f"  {escape(clip(title, 150))}" if title else "")
        return f"New comment on {human_id}", [
            section(f"{who} commented on {subject}\n>{escape(excerpt)}"),
            context(f"Comment{where}"),
        ]

    return None


# ── Delivery ───────────────────────────────────────────────────────────────


async def connection_for(db, account_id: UUID) -> SlackConnection | None:
    return (
        await db.execute(select(SlackConnection).where(SlackConnection.account_id == account_id))
    ).scalar_one_or_none()


async def dispatch(batch: list[StagedEvent]) -> None:
    """Post ``batch`` to each event's organisation. Never raises."""
    if not slack_client.configured():
        return
    from .common import adopt_account_scope  # deferred: common imports the board service, which imports this

    by_account: dict[UUID, list[StagedEvent]] = {}
    for ev in batch:
        by_account.setdefault(ev.account_id, []).append(ev)
    for account_id, events in by_account.items():
        try:
            async with AsyncSessionLocal() as db:
                await adopt_account_scope(db, account_id)
                connection = await connection_for(db, account_id)
                if connection is None or not connection.channel_id:
                    continue
                token = slack_client.decrypt_token(connection.bot_token)
                for ev in events:
                    message = await describe(db, ev)
                    if message is None:
                        continue
                    text, blocks = message
                    await slack_client.post_message(token, connection.channel_id, text, blocks)
        except Exception:  # noqa: BLE001 -- best effort by design, see the module docstring
            logger.exception("Slack notification failed for organisation %s", account_id)
