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

Assignments are told to the person, not the channel: when a requirement or a
feedback report gets an assignee, the assignee is sent a direct message (their
Slack account found by email). When that is not possible -- they are not in
the workspace, or it was connected before the app could look people up -- the
message goes to the channel instead, naming them. Assigning yourself sends
nothing.

Feedback is routed the same way to the project's team (Project details): the
support developer hears about a new report, one moved back to New, and one
confirmed for fixing; the product manager about an estimate awaiting the
client's confirmation, a report judged not a bug, and a report whose
requirements are all ready to test. Nobody is told about their own change.
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
from .board.statuses import FEEDBACK_STATUS_LABEL
from .models import Project, SlackConnection

logger = logging.getLogger(__name__)

STAGED_KEY = "slack_staged_events"

#: Stands in for whoever a personal message is for; replaced by "you" in a
#: direct message and by their name in the channel (_deliver_to). Invisible
#: separators, so no title can contain it by accident.
RECIPIENT = "\u2063recipient\u2063"

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


#: Events that can hand work to someone, and where their new assignee is.
ASSIGNING = ("requirement.created", "requirement.updated", "feedback.triaged")


def assignee_of(action: str, detail: dict[str, Any] | None) -> str | None:
    """The user id an event newly assigns, or None."""
    if action not in ASSIGNING or not detail:
        return None
    change = detail.get("assignee_id")
    if isinstance(change, dict):
        change = change.get("to")
    return str(change) if change else None


#: Which feedback statuses go to whom: (board attribute, role as worded).
SUPPORT = ("support_dev_id", "support developer")
PRODUCT = ("product_manager_id", "product manager")
FEEDBACK_ROUTING = {
    "New": SUPPORT,
    "EstimatedToConfirm": PRODUCT,
    "NotABug": PRODUCT,
    "Confirmed": SUPPORT,
}


def team_notices(board: Any, action: str, detail: dict[str, Any] | None) -> list[dict[str, str]]:
    """The team members an event is for, each as the ``notify`` detail to send."""
    detail = detail or {}
    if action == "feedback.created":
        route, kind, to = SUPPORT, "new", "New"
    elif action == "feedback.ready_to_test":
        route, kind, to = PRODUCT, "ready_to_test", ""
    elif action == "feedback.triaged" and isinstance(detail.get("status"), dict):
        to = str(detail["status"].get("to") or "")
        if to not in FEEDBACK_ROUTING:
            return []
        route, kind = FEEDBACK_ROUTING[to], "status"
    else:
        return []
    user_id = getattr(board, route[0], None)
    return [{"user_id": str(user_id), "kind": kind, "status": to, "role": route[1]}] if user_id else []


def stage(session: Session, board: Board, actor_id: UUID | None, action: str, entity_type: str, entity_id: UUID, detail: dict[str, Any] | None) -> None:
    """Remember an event to announce once ``session`` commits."""
    staged = session.info.setdefault(STAGED_KEY, [])
    actor = str(actor_id) if actor_id else None
    if wants(action, detail):
        staged.append(StagedEvent(board.account_id, board.id, actor_id, action, entity_type, entity_id, dict(detail or {})))
    assignee = assignee_of(action, detail)
    if assignee and assignee != actor:
        staged.append(
            StagedEvent(board.account_id, board.id, actor_id, "assigned", entity_type, entity_id, {"user_id": assignee})
        )
    for notice in team_notices(board, action, detail):
        if notice["user_id"] != actor:
            staged.append(StagedEvent(board.account_id, board.id, actor_id, "notify", entity_type, entity_id, notice))
    if not staged:
        session.info.pop(STAGED_KEY, None)


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


async def _entity_link(db, ev: "StagedEvent", base: str | None, epics_url: str | None) -> tuple[str | None, str, str | None]:
    """``(url, human id, title)`` for the requirement or report an event is on."""
    human_id, title = await _label_for(db, ev.board_id, ev.entity_type, ev.entity_id)
    if ev.entity_type == "feedback":
        return (f"{base}/feedback" if base else None), human_id, title
    row = (await db.execute(select(Requirement).where(Requirement.id == ev.entity_id))).scalar_one_or_none()
    if row is None or not epics_url:
        return epics_url, human_id, title
    epic_id = row.epic_id
    if epic_id is None and row.feature_id:
        feature = await db.get(Feature, row.feature_id)
        epic_id = feature.epic_id if feature else None
    return (f"{epics_url}/{epic_id}?req={row.id}" if epic_id else epics_url), human_id, title


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

    if ev.action == "assigned":
        url, human_id, title = await _entity_link(db, ev, base, epics_url)
        what = "feedback report" if ev.entity_type == "feedback" else "requirement"
        subject = link(human_id, url) + (f"  {escape(clip(title, 150))}" if title else "")
        assignee = escape(await _who(db, UUID(ev.detail["user_id"])))
        return f"{human_id} assigned to {assignee}", [
            # RECIPIENT reads "you" in a direct message and names them in the
            # channel fallback (_deliver_to).
            section(f"{who} assigned {RECIPIENT} the {what} {subject}"),
            context(f"Assigned to {assignee}{where}"),
        ]

    if ev.action == "notify":
        url, human_id, title = await _entity_link(db, ev, base, epics_url)
        subject = link(human_id, url) + (f"  {escape(clip(title, 150))}" if title else "")
        role = escape(ev.detail.get("role", ""))
        kind = ev.detail.get("kind")
        if kind == "new":
            row = (await db.execute(select(Feedback).where(Feedback.id == ev.entity_id))).scalar_one_or_none()
            facts = (
                f"\n*{escape(row.kind)}* · {escape(row.severity)} severity · {escape(row.environment)}"
                f" · from {escape(row.raised_by_name or row.raised_by_email or 'someone')}"
                if row is not None
                else ""
            )
            line = f"New feedback {subject} for {RECIPIENT} as {role}{facts}"
            text = f"New feedback {human_id}"
        elif kind == "ready_to_test":
            line = f"Every requirement raised from {subject} is ready to test. Over to {RECIPIENT} as {role}."
            text = f"{human_id} is ready to test"
        else:
            label = escape(FEEDBACK_STATUS_LABEL.get(ev.detail.get("status", ""), ev.detail.get("status", "")))
            line = f"{who} moved {subject} to *{label}*. Over to {RECIPIENT} as {role}."
            text = f"{human_id} is now {label}"
        return text, [section(line), context(f"Feedback{where}")]

    if ev.action == "comment.created":
        human_id, title = await _label_for(db, ev.board_id, ev.entity_type, ev.entity_id)
        excerpt = clip(str(ev.detail.get("excerpt") or "(attachment)"), 400)
        url = epics_url if ev.entity_type != "requirement" else None
        if ev.entity_type == "feedback":
            url = f"{base}/feedback" if base else None
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


def _address(blocks: list[dict[str, Any]], who: str) -> list[dict[str, Any]]:
    """``blocks`` with RECIPIENT filled in."""
    out = []
    for block in blocks:
        if block.get("type") == "section":
            out.append(section(block["text"]["text"].replace(RECIPIENT, who)))
        else:
            out.append(block)
    return out


async def _deliver_to(db, token: str, channel_id: str, ev: StagedEvent, text: str, blocks: list[dict[str, Any]]) -> None:
    """A direct message to ``ev.detail["user_id"]`` when Slack knows them by
    email ("you"), else the organisation's channel naming them."""
    from app.auth.models.user import User

    user = await db.get(User, UUID(ev.detail["user_id"]))
    slack_id = await slack_client.lookup_user_id(token, user.email) if user and user.email else None
    if slack_id:
        await slack_client.post_message(token, slack_id, text, _address(blocks, "you"))
        return
    name = escape((user.name or user.email) if user else "someone")
    await slack_client.post_message(token, channel_id, text, _address(blocks, f"*{name}*"))


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
                    if ev.action in ("assigned", "notify"):
                        await _deliver_to(db, token, connection.channel_id, ev, text, blocks)
                        continue
                    await slack_client.post_message(token, connection.channel_id, text, blocks)
        except Exception:  # noqa: BLE001 -- best effort by design, see the module docstring
            logger.exception("Slack notification failed for organisation %s", account_id)
