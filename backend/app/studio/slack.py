"""Connecting an organisation to Slack, and answering approvals from it.

The connection is made once per organisation by an organisation admin:

    POST /studio/slack/connect    authenticated  -> a signed install URL
    (browser goes to slack.com, the admin picks a workspace and allows the app)
    GET  /studio/slack/callback   NOT authenticated, and cannot be
    GET  /studio/slack/channels   the public channels to choose from
    PUT  /studio/slack/channel    where board activity is posted

The callback is a top-level browser navigation, so like the GitHub one it has
no bearer token and is guarded by the signed, expiring ``state`` plus an
HttpOnly nonce cookie that only the browser that started the flow holds. Unlike
GitHub it needs no second proof of ownership: Slack's OAuth ``code`` is bound
to the workspace the admin just authorised and is exchanged straight for the
token, so there is no client-supplied installation id to substitute.

The one other unauthenticated route is ``POST /studio/slack/interactions``,
which Slack calls when someone presses Approve or Reject on an approval
message. Nothing about the caller is knowable except that the request is signed
with our signing secret, so that signature is the whole of its authentication
and an unsigned request is refused before the body is read as anything.
"""
from __future__ import annotations

import json
import logging
from typing import Any
from urllib.parse import parse_qs
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.config import get_settings as get_auth_settings
from app.auth.database import get_db
from app.auth.security import require_permission
from app.auth.security.scope_context import ScopeContext
from app.auth.services.audit_service import log_audit_event

from . import slack_client as sc
from .board.models import ApprovalRequest
from .common import adopt_account_scope
from .models import SlackConnection, utc_now
from .schemas import SlackChannelRead, SlackChannelSet, SlackConnectionRead, SlackConnectUrl
from .slack_notify import connection_for, escape, section

router = APIRouter(prefix="/slack", tags=["slack"])
logger = logging.getLogger(__name__)

#: Holds the nonce embedded in the state; scoped to this router's path.
INSTALL_COOKIE = "slack_install_nonce"
INSTALL_COOKIE_PATH = "/api/studio/slack"

APPROVE_ACTION = "approval_approve"
REJECT_ACTION = "approval_reject"


def _cookie_args() -> dict[str, Any]:
    # SameSite=Lax, not Strict: the callback is a cross-site top-level
    # navigation from slack.com, and Strict would drop the cookie on exactly
    # the request that needs it.
    return {
        "path": INSTALL_COOKIE_PATH,
        "httponly": True,
        "samesite": "lax",
        "secure": get_auth_settings().cookie_secure,
    }


def _not_configured() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Slack is not configured for this deployment.",
    )


async def _require_connection(db: AsyncSession, account_id: UUID) -> SlackConnection:
    if not sc.configured():
        raise _not_configured()
    connection = await connection_for(db, account_id)
    if connection is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This organisation is not connected to Slack.")
    return connection


def _slack_http_error(exc: sc.SlackError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))


# ── Connecting ──────────────────────────────────────────────────────────────


@router.get("/connection", response_model=SlackConnectionRead)
async def read_connection(
    ctx: ScopeContext = Depends(require_permission("data:read")),
    db: AsyncSession = Depends(get_db),
) -> SlackConnectionRead:
    missing = sc.missing_settings()
    if missing:
        return SlackConnectionRead(configured=False, connected=False, missing=missing)
    connection = await connection_for(db, ctx.scope_id)
    if connection is None:
        return SlackConnectionRead(configured=True, connected=False)
    return SlackConnectionRead(
        configured=True,
        connected=True,
        team_name=connection.team_name,
        channel_id=connection.channel_id,
        channel_name=connection.channel_name,
        connected_at=connection.created_at,
        connected_by=connection.connected_by,
    )


@router.post("/connect", response_model=SlackConnectUrl)
async def start_connect(
    response: Response,
    ctx: ScopeContext = Depends(require_permission("integrations:manage")),
) -> SlackConnectUrl:
    """Where to send the browser to install the app.

    Returns the URL rather than redirecting, because the caller is an XHR
    carrying a bearer token and a redirect would be followed with that
    Authorization header attached -- and sent to slack.com. The nonce goes into
    the state, its match into an HttpOnly cookie (see ``sc.new_nonce``).
    """
    if not sc.configured():
        raise _not_configured()
    nonce = sc.new_nonce()
    state = sc.sign_state(account_id=str(ctx.scope_id), user_id=str(ctx.user_id), nonce=nonce)
    response.set_cookie(INSTALL_COOKIE, nonce, max_age=int(sc.STATE_TTL.total_seconds()), **_cookie_args())
    return SlackConnectUrl(url=sc.install_url(state))


def _return_to(claims: dict[str, Any] | None, outcome: str) -> RedirectResponse:
    """Back into the app on the organisation's Slack page; 303 so the browser GETs it."""
    base = get_auth_settings().frontend_url.rstrip("/")
    path = f"/orgs/{claims['a']}/slack" if claims and claims.get("a") else "/orgs"
    redirect = RedirectResponse(f"{base}{path}?slack={outcome}", status_code=status.HTTP_303_SEE_OTHER)
    redirect.delete_cookie(INSTALL_COOKIE, path=INSTALL_COOKIE_PATH)  # one nonce, one attempt
    return redirect


@router.get("/callback", include_in_schema=False)
async def install_callback(
    request: Request,
    code: str | None = Query(None),
    state: str | None = Query(None),
    error: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    """Where Slack returns the browser after the admin allows (or declines) the app.

    Every failure redirects with an outcome the page can explain and logs the
    detail server-side; telling the address bar which check failed would only
    help someone probing it.
    """
    if not sc.configured():
        return _return_to(None, "failed")
    try:
        claims = sc.verify_state(state or "")
    except ValueError as exc:
        logger.warning("Slack install callback rejected: %s", exc)
        return _return_to(None, "failed")

    if not sc.nonce_matches(claims, request.cookies.get(INSTALL_COOKIE)):
        logger.warning("Slack install callback arrived without a matching install cookie")
        return _return_to(claims, "failed")

    if error or not code:  # the admin pressed Cancel on Slack's consent screen
        return _return_to(claims, "cancelled")

    try:
        grant = await sc.exchange_code(code)
        token = grant["access_token"]
        team = grant.get("team") or {}
        encrypted = sc.encrypt_token(token)
    except (sc.SlackError, KeyError) as exc:
        logger.warning("Slack install callback could not exchange the code: %s", exc)
        return _return_to(claims, "failed")

    account_id = UUID(claims["a"])
    await adopt_account_scope(db, account_id)
    row = await connection_for(db, account_id)
    reconnected = row is not None
    if row is None:
        row = SlackConnection(account_id=account_id, team_id=team.get("id", ""), bot_token=encrypted)
        db.add(row)
    else:
        # A different workspace invalidates the chosen channel; the same one keeps it.
        if row.team_id != team.get("id"):
            row.channel_id = None
            row.channel_name = None
        if _can_decrypt(row):
            await sc.revoke(sc.decrypt_token(row.bot_token))
        row.bot_token = encrypted
        row.updated_at = utc_now()
    row.team_id = team.get("id", row.team_id)
    row.team_name = team.get("name")
    try:
        row.connected_by = UUID(claims["u"])
    except (KeyError, TypeError, ValueError):
        row.connected_by = None

    await log_audit_event(
        "slack_connected",
        actor_user_id=claims.get("u"),
        db=db,
        tenant_id=str(account_id),
        team_id=row.team_id,
        team_name=row.team_name,
        reconnected=reconnected,
    )
    await db.commit()
    return _return_to(claims, "connected")


def _can_decrypt(row: SlackConnection) -> bool:
    try:
        sc.decrypt_token(row.bot_token)
        return True
    except sc.SlackError:
        return False


@router.get("/channels", response_model=list[SlackChannelRead])
async def list_channels(
    ctx: ScopeContext = Depends(require_permission("integrations:manage")),
    db: AsyncSession = Depends(get_db),
) -> list[SlackChannelRead]:
    connection = await _require_connection(db, ctx.scope_id)
    try:
        channels = await sc.list_channels(sc.decrypt_token(connection.bot_token))
    except sc.SlackError as exc:
        raise _slack_http_error(exc) from exc
    return [SlackChannelRead(**c) for c in channels]


@router.put("/channel", response_model=SlackConnectionRead)
async def set_channel(
    payload: SlackChannelSet,
    ctx: ScopeContext = Depends(require_permission("integrations:manage")),
    db: AsyncSession = Depends(get_db),
) -> SlackConnectionRead:
    """Choose where activity is posted, and say hello there so the admin sees it work.

    The channel must be one the bot can list -- a client-supplied id is never
    stored on trust.
    """
    connection = await _require_connection(db, ctx.scope_id)
    try:
        token = sc.decrypt_token(connection.bot_token)
        channels = {c["id"]: c["name"] for c in await sc.list_channels(token)}
        if payload.channel_id not in channels:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="That channel is not available.")
        await sc.post_message(
            token,
            payload.channel_id,
            "Ferrous Studio is connected to this channel.",
            [section("*Ferrous Studio* is connected to this channel. Requirement status changes, new feedback and new comments will appear here.")],
        )
    except sc.SlackError as exc:
        raise _slack_http_error(exc) from exc
    connection.channel_id = payload.channel_id
    connection.channel_name = channels[payload.channel_id]
    connection.updated_at = utc_now()
    await log_audit_event(
        "slack_channel_set",
        actor_user_id=str(ctx.user_id),
        db=db,
        tenant_id=str(ctx.scope_id),
        channel_name=connection.channel_name,
    )
    await db.commit()
    return SlackConnectionRead(
        configured=True,
        connected=True,
        team_name=connection.team_name,
        channel_id=connection.channel_id,
        channel_name=connection.channel_name,
        connected_at=connection.created_at,
        connected_by=connection.connected_by,
    )


@router.delete("/connection", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def disconnect(
    ctx: ScopeContext = Depends(require_permission("integrations:manage")),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Forget the connection and tell Slack to revoke the token.

    Revoking is best-effort here, unlike GitHub's uninstall: a token we are
    about to delete is harmless to leave valid for a moment, whereas refusing to
    disconnect because Slack is down would strand the admin.
    """
    connection = await connection_for(db, ctx.scope_id)
    if connection is None:
        return
    if _can_decrypt(connection):
        await sc.revoke(sc.decrypt_token(connection.bot_token))
    await db.delete(connection)
    await log_audit_event("slack_disconnected", actor_user_id=str(ctx.user_id), db=db, tenant_id=str(ctx.scope_id))
    await db.commit()


# ── Approval buttons ────────────────────────────────────────────────────────


def approval_blocks(approval: ApprovalRequest, project_name: str | None = None) -> list[dict[str, Any]]:
    """The approval message: the question, and buttons while it is open or the
    decision once it is not. ``value`` carries ``<account>:<approval>`` so the
    interactions route can adopt the right organisation's scope."""
    where = f" · {escape(project_name)}" if project_name else ""
    blocks: list[dict[str, Any]] = [section(f"*Approval needed:* {escape(approval.summary)}")]
    if approval.detail:
        blocks.append(section(escape(approval.detail)))
    if approval.status == "pending":
        value = f"{approval.account_id}:{approval.id}"
        blocks.append(
            {
                "type": "actions",
                "elements": [
                    {"type": "button", "action_id": APPROVE_ACTION, "style": "primary", "value": value,
                     "text": {"type": "plain_text", "text": "Approve"}},
                    {"type": "button", "action_id": REJECT_ACTION, "style": "danger", "value": value,
                     "text": {"type": "plain_text", "text": "Reject"}},
                ],
            }
        )
        blocks.append({"type": "context", "elements": [{"type": "mrkdwn", "text": f"Requested by an agent{where}"}]})
    else:
        verb = "Approved" if approval.status == "approved" else "Rejected"
        who = escape(approval.decided_by or "someone")
        blocks.append({"type": "context", "elements": [{"type": "mrkdwn", "text": f"{verb} by {who}{where}"}]})
    return blocks


@router.post("/interactions", include_in_schema=False)
async def interactions(request: Request, db: AsyncSession = Depends(get_db)) -> Response:
    """Slack's callback for a pressed button.

    Slack expects a 2xx within three seconds and nothing more; the message is
    rewritten with ``chat.update`` rather than in the response. Any
    request that is not validly signed gets a bare 401, and a button that no
    longer applies (decided already, or its row gone) is acknowledged without
    changing anything -- a double click must not flip a decision.
    """
    raw = await request.body()
    if not sc.verify_request(
        request.headers.get("X-Slack-Request-Timestamp"), raw, request.headers.get("X-Slack-Signature")
    ):
        return Response(status_code=status.HTTP_401_UNAUTHORIZED)

    try:
        payload = json.loads(parse_qs(raw.decode("utf-8")).get("payload", [""])[0])
        action = payload["actions"][0]
        account_raw, approval_raw = str(action["value"]).split(":", 1)
        account_id, approval_id = UUID(account_raw), UUID(approval_raw)
    except (KeyError, IndexError, ValueError, TypeError, json.JSONDecodeError):
        return Response(status_code=status.HTTP_200_OK)  # not ours to act on
    if action.get("action_id") not in (APPROVE_ACTION, REJECT_ACTION):
        return Response(status_code=status.HTTP_200_OK)

    # The signature proves this came from Slack, not which organisation it is
    # about; the account in the button's value is trusted only because we put it
    # there and Slack returns it verbatim inside a signed body.
    await adopt_account_scope(db, account_id)
    approval = (await db.execute(select(ApprovalRequest).where(ApprovalRequest.id == approval_id))).scalar_one_or_none()
    if approval is None or approval.status != "pending":
        return Response(status_code=status.HTTP_200_OK)

    user = payload.get("user") or {}
    approval.status = "approved" if action["action_id"] == APPROVE_ACTION else "rejected"
    approval.decided_by = str(user.get("name") or user.get("username") or user.get("id") or "someone")[:255]
    approval.decided_at = utc_now()
    await db.commit()

    try:
        # The commit above ended the transaction that carried the scope.
        await adopt_account_scope(db, account_id)
        connection = await connection_for(db, account_id)
        if connection and approval.channel_id and approval.message_ts:
            await sc.update_message(
                sc.decrypt_token(connection.bot_token),
                approval.channel_id,
                approval.message_ts,
                f"{approval.summary}: {approval.status}",
                approval_blocks(approval),
            )
    except sc.SlackError:
        logger.exception("Could not update the Slack approval message %s", approval_id)
    return Response(status_code=status.HTTP_200_OK)
