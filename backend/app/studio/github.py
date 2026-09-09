"""Connecting an organisation to GitHub, and a project to one repository.

The connection is made once per organisation and shared by every project in
it; the repository link is per project and lives on the ``projects`` row (see
``projects.py`` for those two routes).

Installing is the awkward part, because it leaves our API and comes back
through the browser's address bar:

    POST /studio/github/connect   authenticated  -> a signed install URL
    (browser navigates to github.com, the user picks an account and repos)
    GET  /studio/github/callback  NOT authenticated, and cannot be

That callback is a top-level navigation, so it carries no bearer token, no
scope headers and no cookie we could rely on. Three things stand in for the
usual guards, and all three are needed:

  * the signed ``state``, which names the organisation and user that started
    the flow and expires in fifteen minutes;
  * the OAuth ``code``, exchanged for a throwaway user token, which proves the
    person finishing the flow is the person GitHub just authorised;
  * ``user_has_installation``, which proves that user really has the
    installation whose id arrived in the URL -- without it, substituting
    another organisation's installation id would hand this organisation read
    access to somebody else's code.

The callback never returns an error body, because a human is looking at it: it
always redirects into the app, with a query parameter the Repository section
turns into a sentence.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, replace
from typing import Any
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

from . import github_client as gh
from .audit import record_event
from .common import adopt_account_scope, get_project
from .models import GitHubInstallation, Project, utc_now
from .schemas import (
    GitHubConnectStart,
    GitHubConnectUrl,
    GitHubConnectionRead,
    GitHubRepositoryRead,
    ProjectRead,
    ProjectRepositoryRead,
    RepositoryCommit,
    RepositoryLink,
)

router = APIRouter(prefix="/github", tags=["github"])
logger = logging.getLogger(__name__)

#: Holds the nonce embedded in the state, so the install can only be finished
#: by the browser that started it. Scoped to this router's own path -- it has
#: no business being sent on every other request in the app.
INSTALL_COOKIE = "gh_install_nonce"
INSTALL_COOKIE_PATH = "/api/studio/github"


def _cookie_args() -> dict[str, Any]:
    """How the install cookie is set, and how it must be deleted.

    SameSite=Lax rather than Strict: the callback is a cross-site top-level
    navigation from github.com, and Strict would withhold the cookie on exactly
    the request that needs it -- which would fail every install closed.
    ``secure`` follows the auth module's existing rule, because a Secure cookie
    is dropped outright on a plain-http local dev origin.
    """
    return {
        "path": INSTALL_COOKIE_PATH,
        "httponly": True,
        "samesite": "lax",
        "secure": get_auth_settings().cookie_secure,
    }


async def installation_for(db: AsyncSession, account_id: UUID) -> GitHubInstallation | None:
    """This organisation's connection, or None if it has not made one."""
    return (
        await db.execute(select(GitHubInstallation).where(GitHubInstallation.account_id == account_id))
    ).scalar_one_or_none()


async def require_installation(db: AsyncSession, account_id: UUID) -> GitHubInstallation:
    if not gh.configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="GitHub is not configured for this deployment.",
        )
    installation = await installation_for(db, account_id)
    if installation is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This organisation is not connected to GitHub.",
        )
    return installation


def _github_http_error(exc: gh.GitHubError) -> HTTPException:
    """GitHub's failure, retold as ours.

    404 becomes 409 rather than passing straight through: the thing that is
    missing is GitHub's installation, not the route the caller asked for, and a
    bare 404 would read to the client as "no such project".
    """
    if exc.status == 404:
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    return HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))


# ── Connecting ──────────────────────────────────────────────────────────────


@router.get("/connection", response_model=GitHubConnectionRead)
async def read_connection(
    ctx: ScopeContext = Depends(require_permission("data:read")),
    db: AsyncSession = Depends(get_db),
) -> GitHubConnectionRead:
    if not gh.configured():
        return GitHubConnectionRead(configured=False, connected=False)

    installation = await installation_for(db, ctx.scope_id)
    if installation is None:
        return GitHubConnectionRead(configured=True, connected=False)

    return GitHubConnectionRead(
        configured=True,
        connected=True,
        installation_id=installation.installation_id,
        account_login=installation.account_login,
        account_type=installation.account_type,
        repository_selection=installation.repository_selection,
        connected_at=installation.created_at,
        connected_by=installation.connected_by,
        manage_url=gh.settings_url(
            installation.installation_id,
            installation.account_login if installation.account_type == "Organization" else None,
        ),
    )


@router.post("/connect", response_model=GitHubConnectUrl)
async def start_connect(
    payload: GitHubConnectStart,
    response: Response,
    ctx: ScopeContext = Depends(require_permission("integrations:manage")),
) -> GitHubConnectUrl:
    """Where to send the browser to install the App.

    Authenticated, and returns the URL rather than redirecting, because the
    caller is an XHR carrying a bearer token -- a redirect would be followed by
    fetch with our Authorization header attached, and sent to github.com.

    Also plants half a secret. The signed state names the organisation, but a
    signature cannot say *which browser* is entitled to finish the flow, and
    the state travels through a URL that ends up in history and Referer headers.
    The nonce goes into the state and its match into an HttpOnly cookie, so a
    state on its own -- leaked, copied, or fished out of a log -- is not enough
    to bind an installation to this organisation.
    """
    if not gh.configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="GitHub is not configured for this deployment.",
        )
    nonce = gh.new_nonce()
    state = gh.sign_state(
        account_id=str(ctx.scope_id),
        user_id=str(ctx.user_id),
        nonce=nonce,
    )
    response.set_cookie(
        INSTALL_COOKIE,
        nonce,
        max_age=int(gh.STATE_TTL.total_seconds()),
        **_cookie_args(),
    )
    return GitHubConnectUrl(url=gh.install_url(state))


def _return_to(claims: dict[str, Any] | None, outcome: str) -> RedirectResponse:
    """Back into the app, on the organisation's GitHub page.

    The flow only ever starts there now, so that is where it ends too --
    even on a failure, where ``claims`` may be missing the organisation
    because verification never got that far.

    303 rather than 307: the browser must GET the app, whatever it used to
    reach the callback.
    """
    base = get_auth_settings().frontend_url.rstrip("/")
    if claims and claims.get("a"):
        path = f"/orgs/{claims['a']}/github"
    else:
        path = "/orgs"
    redirect = RedirectResponse(f"{base}{path}?github={outcome}", status_code=status.HTTP_303_SEE_OTHER)
    # One nonce, one attempt. Cleared on every outcome so a cookie left behind
    # cannot be paired with a second state later.
    redirect.delete_cookie(INSTALL_COOKIE, path=INSTALL_COOKIE_PATH)
    return redirect


@router.get("/callback", include_in_schema=False)
async def install_callback(
    request: Request,
    installation_id: int | None = Query(None),
    setup_action: str | None = Query(None),
    code: str | None = Query(None),
    state: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    """Where GitHub returns the browser after an install.

    Deliberately unauthenticated -- see this module's docstring for what
    replaces the usual guards. Every failure redirects with an outcome the page
    can explain, and logs the detail server-side; telling the address bar
    exactly which check failed would only help someone probing it.
    """
    try:
        claims = gh.verify_state(state or "")
    except ValueError as exc:
        logger.warning("GitHub install callback rejected: %s", exc)
        return _return_to(None, "failed")

    # The state proves *an* organisation started a flow; the cookie proves this
    # browser is the one that started it. Without this a leaked state would let
    # someone finish an install against another organisation, binding their own
    # GitHub installation to it in place of the real one.
    if not gh.nonce_matches(claims, request.cookies.get(INSTALL_COOKIE)):
        logger.warning("GitHub install callback arrived without a matching install cookie")
        return _return_to(claims, "failed")

    # "request" means the user could not install it themselves and has asked an
    # owner to approve it. Nothing exists to record yet, and that is not an error.
    if setup_action == "request":
        return _return_to(claims, "requested")

    if not installation_id or not code:
        logger.warning("GitHub install callback missing installation_id or code")
        return _return_to(claims, "failed")

    try:
        user_token = await gh.exchange_user_code(code)
        if not await gh.user_has_installation(user_token, installation_id):
            logger.warning(
                "GitHub install callback claimed installation %s the authorising user does not have",
                installation_id,
            )
            return _return_to(claims, "denied")
        installation = await gh.get_installation(installation_id)
    except (gh.GitHubError, gh.GitHubNotConfigured) as exc:
        logger.warning("GitHub install callback could not verify installation: %s", exc)
        return _return_to(claims, "failed")

    account = installation.get("account") or {}
    account_id = UUID(claims["a"])
    # No scope headers reached this route, so RLS has to be told which
    # organisation we are acting as. Safe only because the state is verified.
    await adopt_account_scope(db, account_id)

    row = await installation_for(db, account_id)
    # Named before the row is touched -- "reconnected" means the organisation
    # already had a connection and this callback replaced it with a different
    # installation, which the mutation below is about to make indistinguishable.
    reconnected = row is not None and row.installation_id != installation_id
    if row is None:
        row = GitHubInstallation(account_id=account_id, installation_id=installation_id)
        db.add(row)
    else:
        # Reconnecting to a different GitHub account: the old installation's
        # cached token must not outlive the row that justified it.
        if reconnected:
            gh.forget_installation(row.installation_id)
        row.installation_id = installation_id
        row.updated_at = utc_now()

    row.account_login = account.get("login")
    row.account_type = account.get("type")
    row.repository_selection = installation.get("repository_selection")
    try:
        row.connected_by = UUID(claims["u"])
    except (KeyError, TypeError, ValueError):
        row.connected_by = None

    await log_audit_event(
        "github_connected",
        actor_user_id=claims.get("u"),
        db=db,
        tenant_id=str(account_id),
        installation_id=installation_id,
        account_login=row.account_login,
        account_type=row.account_type,
        repository_selection=row.repository_selection,
        reconnected=reconnected,
    )
    await db.commit()
    return _return_to(claims, "connected")


# response_model=None because this module uses postponed annotations: FastAPI
# would otherwise read the "-> None" return annotation as a model to serialise,
# and a 204 may carry no body.
@router.delete("/connection", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def disconnect(
    ctx: ScopeContext = Depends(require_permission("integrations:manage")),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Forget this organisation's connection.

    Project repository links are left alone. Disconnecting is usually a
    reinstall or a change of GitHub account, and clearing every link would make
    that a destructive act with nothing to undo it; while there is no
    connection each linked project simply reports that it cannot reach GitHub.

    This does not uninstall the App on GitHub's side -- only an owner there can
    do that, which is what ``manage_url`` is for.
    """
    installation = await installation_for(db, ctx.scope_id)
    if installation is None:
        return
    gh.forget_installation(installation.installation_id)
    await log_audit_event(
        "github_disconnected",
        actor_user_id=str(ctx.user_id),
        db=db,
        tenant_id=str(ctx.scope_id),
        installation_id=installation.installation_id,
        account_login=installation.account_login,
    )
    await db.delete(installation)
    await db.commit()


# ── Repositories ────────────────────────────────────────────────────────────


@router.get("/repositories", response_model=list[GitHubRepositoryRead])
async def list_repositories(
    ctx: ScopeContext = Depends(require_permission("data:read")),
    db: AsyncSession = Depends(get_db),
) -> list[GitHubRepositoryRead]:
    """Every repository the installation can see, for the picker."""
    installation = await require_installation(db, ctx.scope_id)
    try:
        repos = await gh.list_repositories(installation.installation_id)
    except gh.GitHubError as exc:
        raise _github_http_error(exc) from exc
    return [GitHubRepositoryRead(**vars(repo)) for repo in repos]


# ── A project's linked repository ───────────────────────────────────────────
#
# Mounted without the /github prefix because these hang off a project, not off
# the connection: /studio/projects/{project_id}/repository.

project_router = APIRouter(tags=["github"])


@dataclass(frozen=True)
class LinkReading:
    """Everything known about a project's link at one moment.

    Split out from the route so the decision below is about facts rather than
    about HTTP: what we have on file, what GitHub said, and what went wrong
    while asking.
    """

    #: What the project row stores. None means no repository is linked.
    stored_id: int | None
    stored_full_name: str | None
    #: False when this deployment has no GitHub App at all.
    configured: bool
    #: False when the organisation has not installed it (or has disconnected).
    connected: bool
    #: What GitHub returned, or None if it could not be asked or did not answer.
    repo: gh.Repository | None
    #: Why GitHub could not be read, if that is what happened.
    error: gh.GitHubError | None


def link_state(reading: LinkReading) -> tuple[str, str | None]:
    """Decide what the Repository section reports: a state and a sentence.

    The state is one of ``ProjectRepositoryRead.state``; the sentence is shown
    when the state is not "ok", and is None when it is.

    The order matters -- each question only makes sense once the one before it
    is answered. There is no repository to describe before one is linked, no
    point asking GitHub before the App exists, and nothing to ask it through
    before the organisation has installed it.

    A rename is deliberately not a state. The link is held by ``repo_id``, so
    it survives one; the caller refreshes the cached name and says nothing.
    Nor is there a branch case: no branch is stored, because branches are
    GitHub's to manage (see ``Project.repo_id``).

    Every sentence states what is true and stops there, per CLAUDE.md -- what
    to do about it is the affordances' job, not this function's.
    """
    if reading.stored_id is None:
        return "unlinked", None
    if not reading.configured:
        return "unavailable", "GitHub is not configured for this deployment."
    if not reading.connected:
        return "disconnected", "This organisation is not connected to GitHub."
    if reading.repo is None:
        # 404 is the ordinary ending: the repository was deleted, or it was
        # dropped from the installation's selected repositories. Anything else
        # is GitHub having a bad moment, and its own words are more use than
        # ours would be.
        if reading.error is not None and reading.error.status == 404:
            name = reading.stored_full_name or "this repository"
            return "unreachable", f"The GitHub installation can no longer see {name}."
        return "unreachable", str(reading.error) if reading.error else "GitHub did not answer."
    return "ok", None


async def read_link(db: AsyncSession, project: Project) -> LinkReading:
    """Gather what is known about ``project``'s link, asking GitHub if it can.

    Never raises for GitHub's sake: an unreachable repository is a state the
    page shows, not a failed request. Only the reading is assembled here --
    ``link_state`` decides what it means.
    """
    blank = LinkReading(
        stored_id=project.repo_id,
        stored_full_name=project.repo_full_name,
        configured=gh.configured(),
        connected=False,
        repo=None,
        error=None,
    )
    if project.repo_id is None or not blank.configured:
        return blank

    installation = await installation_for(db, project.account_id)
    if installation is None:
        return blank

    try:
        repo = await gh.get_repository_by_id(installation.installation_id, project.repo_id)
    except gh.GitHubError as exc:
        return replace(blank, connected=True, error=exc)
    return replace(blank, connected=True, repo=repo)


@project_router.get("/projects/{project_id}/repository", response_model=ProjectRepositoryRead)
async def read_project_repository(
    project_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:read")),
    db: AsyncSession = Depends(get_db),
) -> ProjectRepositoryRead:
    """The linked repository as it stands right now.

    Separate from the project payload on purpose: this one call goes out to
    GitHub, and folding it into ``GET /projects/{id}`` would put a third-party
    round trip in front of every page in the studio.
    """
    project = await get_project(db, project_id, ctx)
    reading = await read_link(db, project)
    state, message = link_state(reading)

    repo = reading.repo
    if repo is not None and repo.full_name != project.repo_full_name:
        # A read that writes, deliberately and narrowly. The repository was
        # renamed or transferred on GitHub; the link itself is held by id and
        # is unaffected, so this is a cache catching up rather than a change of
        # meaning, and nothing anywhere should keep showing the old name. The
        # new value comes from GitHub, not from the caller, which is why a
        # read-scoped request is allowed to trigger it.
        project.repo_full_name = repo.full_name
        await db.commit()

    commit = None
    if repo is not None and state == "ok":
        try:
            raw = await gh.latest_commit(
                (await require_installation(db, project.account_id)).installation_id,
                repo.full_name,
                # The live default branch: no branch is stored to prefer over it.
                repo.default_branch,
            )
            commit = RepositoryCommit(**raw) if raw else None
        except (gh.GitHubError, HTTPException):
            # The repository reads fine; only its history did not. Not worth
            # downgrading the whole state over.
            commit = None

    return ProjectRepositoryRead(
        state=state,
        repo_id=project.repo_id,
        repo_full_name=project.repo_full_name,
        html_url=repo.html_url if repo else None,
        description=repo.description if repo else None,
        private=repo.private if repo else None,
        default_branch=repo.default_branch if repo else None,
        latest_commit=commit,
        message=message,
    )


@project_router.put("/projects/{project_id}/repository", response_model=ProjectRead)
async def link_project_repository(
    project_id: UUID,
    payload: RepositoryLink,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> Project:
    """Point this project at a repository.

    Resolved with ``get_project`` rather than ``get_writable_project``: which
    repository a project is being built into is filing, not content, and stays
    changeable on a frozen version -- the same reasoning that keeps a locked
    version renameable (see ``LOCKED_EDITABLE_FIELDS`` in ``projects.py``).

    The repository is re-read from GitHub rather than trusted from the request.
    That does two jobs at once: it proves the installation can actually see the
    repository the caller named, and it stores the name GitHub uses now rather
    than whatever the picker had cached.
    """
    project = await get_project(db, project_id, ctx)
    installation = await require_installation(db, project.account_id)
    try:
        repo = await gh.get_repository_by_id(installation.installation_id, payload.repo_id)
    except gh.GitHubError as exc:
        raise _github_http_error(exc) from exc

    project.repo_id = repo.id
    project.repo_full_name = repo.full_name
    project.repo_linked_at = utc_now()
    project.repo_linked_by = ctx.user_id
    await record_event(
        db,
        project=project,
        wireframe=None,
        user_id=ctx.user_id,
        event="repository_linked",
        detail={"repo_full_name": repo.full_name},
    )
    await db.commit()
    await db.refresh(project)
    return project


@project_router.delete("/projects/{project_id}/repository", response_model=ProjectRead)
async def unlink_project_repository(
    project_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> Project:
    """Forget which repository this project was being built into.

    ``get_project``, not ``get_writable_project``, for the reason given on the
    link route above. Nothing on GitHub changes.
    """
    project = await get_project(db, project_id, ctx)
    if project.repo_id is not None:
        await record_event(
            db,
            project=project,
            wireframe=None,
            user_id=ctx.user_id,
            event="repository_unlinked",
            detail={"repo_full_name": project.repo_full_name},
        )
    project.repo_id = None
    project.repo_full_name = None
    project.repo_linked_at = None
    project.repo_linked_by = None
    await db.commit()
    await db.refresh(project)
    return project
