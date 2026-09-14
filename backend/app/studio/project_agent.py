"""The Project Agent chatbot: a per-project conversation with Claude that can
create wireframes, diagrams, epics and requirements via tool use.

Calls Claude through AWS Bedrock by default, using the ECS task's own IAM
role (``infra/terraform/iam.tf``'s ``bedrock_claude`` policy) rather than a
stored Anthropic API key -- there is nothing to generate, store or rotate.
``_client_and_model`` switches to a direct Anthropic API key the moment
``settings.anthropic_api_key`` is set (config.py), prepared ahead of time so
that giving Project Agent a real key later is a config change, not a code
change -- see that function. Shared by every organisation -- there is no
per-organisation credential yet, and letting an organisation bring its own
key/account is a later, separate idea (Elliott's own words: "no need to do
this now"). An unconfigured deployment reports the tab as unavailable
rather than 500ing, the same convention ``github_client.py`` and the
documents section already use.

Every tool is validated and created by exactly the same code its own
human-facing route uses (``importing.create_bundle_content`` for
wireframes/diagrams, ``board.routes.create_epic_content`` /
``create_requirement_content`` for the board), so anything the chat
produces is held to the identical bar as clicking the equivalent button
by hand -- not a second, possibly-drifted copy of the logic.

Per-tool-category access, per Ali (Slack, 2026-09-11): *"A user asking
for anything doesn't mean a user gets everything."* The wireframe/diagram
tool needs ``data:write`` (already required just to reach send_message at
all); the board tools additionally need ``board:write`` -- a real,
already-existing, stricter permission an ``account_member`` role does NOT
have (only ``account_admin`` does, see auth_config.yaml). The board tools
are only ever added to the ``tools`` list Claude is offered when
``ctx.has_permission("board:write")`` is true -- a member without it isn't
told "no" by the model, the capability simply never exists for that
request, the same way a button they can't click just isn't rendered.

Phase 4 hardening: rate-limited per organisation (reusing the same
Postgres-backed limiter the auth endpoints use, not a new mechanism), and
every Bedrock call carries an explicit timeout -- one organisation sending
a burst of messages, or one hung network call, must not starve or block
every other organisation sharing this one platform-wide Bedrock capacity.
"""
from __future__ import annotations

import json
from collections.abc import Sequence
from typing import Any
from uuid import UUID

import anthropic
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.database import get_db
from app.auth.security import require_permission
from app.auth.security.scope_context import ScopeContext
from app.auth.services.rate_limiter_service import create_rate_limiter
from app.config import get_settings
from app.database import AsyncSessionLocal

from .board.routes import create_epic_content, create_feature_content, create_requirement_content
from .board.schemas import EpicCreate, FeatureCreate, RequirementCreate
from .catalog import BUNDLE_FORMAT_GUIDE, get_catalog
from .common import get_project, get_writable_project
from .importing import create_bundle_content, update_wireframe_content
from .models import Project, ProjectAgentMessage, ProjectDiagram, Wireframe
from .projects import _count
from .schemas import ProjectAgentMessageRead, ProjectAgentSend, ProjectAgentStatus

router = APIRouter(prefix="/projects/{project_id}/agent", tags=["project-agent"])

#: Postgres-backed, not in-memory: staging/prod may run more than one ECS
#: task, and an in-memory counter would let each task give the same
#: organisation its own separate allowance. Same service the auth endpoints
#: already use (app.main wires it up with AsyncSessionLocal too) -- reusing
#: it rather than inventing a second rate-limiting mechanism.
_rate_limiter = create_rate_limiter(AsyncSessionLocal)

#: Per organisation (ctx.scope_id), not per project or per user -- the
#: thing to prevent is one organisation's heavy use starving every other
#: organisation sharing this one platform-wide Bedrock capacity, not
#: limiting how much one person can chat on one project.
RATE_LIMIT_MAX_MESSAGES = 20
RATE_LIMIT_WINDOW_SECONDS = 300

#: Without an explicit timeout a hung Bedrock call (a stalled connection, a
#: model having a bad day) would otherwise sit on the SDK's own default for
#: as long as it likes, tying up a worker and an open DB transaction the
#: whole time -- long enough to be its own way of starving other
#: organisations even though the rate limiter above never saw the request.
BEDROCK_CALL_TIMEOUT_SECONDS = 60.0

#: Generous enough for a long back-and-forth including tool results, which
#: run larger than a plain chat turn.
MAX_HISTORY_MESSAGES = 40

#: One user turn can trigger at most this many tool round-trips before the
#: agent has to stop and hand back control -- bounds cost/latency on a
#: bundle that keeps failing validation rather than looping indefinitely.
MAX_TOOL_ROUNDS = 4

CREATE_BUNDLE_TOOL: dict[str, Any] = {
    "name": "create_bundle",
    "description": (
        "Create wireframes and/or diagrams in this project. Pass a bundle matching the "
        "format described in your instructions. The server validates it against Studio's "
        "real catalogue and creates exactly what's given -- nothing is created if "
        "validation fails; you get back the precise errors and can call this again."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "wireframes": {
                "type": "array",
                "description": "Zero or more wireframes to create, each with name/interfaceType/landingPageId/pages.",
                "items": {"type": "object"},
            },
            "diagrams": {
                "type": "array",
                "description": "Zero or more diagrams to create, each with name/kind/model.",
                "items": {"type": "object"},
            },
        },
    },
}

UPDATE_WIREFRAME_TOOL: dict[str, Any] = {
    "name": "update_wireframe",
    "description": (
        "Replace an EXISTING wireframe's pages with new content -- use this instead of "
        "create_bundle when the request clearly refers to one of this project's existing "
        "wireframes (named below), e.g. \"update the Login wireframe\" or regenerating one "
        "after reverse-engineering an updated repository. wireframe_id must be a real id "
        "from the list you were given -- never invent one. The wireframe's current pages "
        "are automatically saved to its own version history first, so this is always "
        "undoable. name/interfaceType/landingPageId/pages use the exact same format as "
        "create_bundle's wireframes -- everything is replaced, not merged, so pass the "
        "complete new content, not just what changed."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "wireframe_id": {"type": "string", "description": "The id of the existing wireframe to update."},
            "name": {"type": "string", "description": "Optional -- omit to keep the current name."},
            "interfaceType": {"type": "string", "enum": ["desktop", "tablet", "mobile"]},
            "landingPageId": {"type": "string"},
            "pages": {"type": "array", "items": {"type": "object"}},
        },
        "required": ["wireframe_id", "pages"],
    },
}

#: Board tools -- only ever offered to Claude when the caller actually has
#: board:write (see _tools_for). A member with only data:write can still
#: use create_bundle; these two simply don't exist for that request.
CREATE_EPIC_TOOL: dict[str, Any] = {
    "name": "create_epic",
    "description": (
        "Create an epic on this project's delivery board. New epics always start at "
        "status \"Readiness\". Returns the created epic's id, which you can pass as "
        "epic_id to create_requirement to file requirements under it in the same reply."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "Short epic title."},
            "summary": {"type": "string", "description": "Optional longer description."},
        },
        "required": ["title"],
    },
}

CREATE_FEATURE_TOOL: dict[str, Any] = {
    "name": "create_feature",
    "description": (
        "Create a feature under an epic, for grouping related requirements together -- "
        "e.g. \"Password reset\" under a \"User onboarding\" epic. epic_id must be a real "
        "id (from a create_epic result earlier in this conversation, or one the user "
        "names) -- a feature cannot exist without an epic. Returns the created feature's "
        "id, which you can pass as feature_id to create_requirement."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "epic_id": {"type": "string", "description": "UUID of the epic this feature belongs to."},
            "title": {"type": "string", "description": "Short feature title."},
        },
        "required": ["epic_id", "title"],
    },
}

CREATE_REQUIREMENT_TOOL: dict[str, Any] = {
    "name": "create_requirement",
    "description": (
        "Create a requirement on this project's delivery board. Starts at status "
        "\"Todo\". Pass epic_id (from a create_epic result earlier in this conversation, "
        "or one the user names) to file it directly under an epic, or feature_id (from a "
        "create_feature result) to file it under a feature instead -- pass at most one of "
        "the two. Omit both to leave the requirement unfiled."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "Short requirement title."},
            "body": {"type": "string", "description": "Optional longer description."},
            "priority": {
                "type": "string",
                "enum": ["Low", "Medium", "High", "Urgent"],
                "description": "Defaults to Medium if omitted.",
            },
            "epic_id": {"type": "string", "description": "UUID of an epic to file this requirement under, if any."},
            "feature_id": {"type": "string", "description": "UUID of a feature to file this requirement under, if any."},
        },
        "required": ["title"],
    },
}

SYSTEM_PROMPT = (
    "You are Project Agent, an assistant embedded in one specific project inside "
    "Ferrous Studio, a product-design and delivery tool. You are having an ongoing "
    "conversation with someone working on this project only -- you have no visibility "
    "into any other project, and never claim to. Be direct and concise.\n\n"
    "You can create real content in this project using the tools available to you "
    "in this conversation -- which tools you have depends on this person's role, and "
    "is stated below; only ever use the ones actually offered to you. When you have "
    "enough information to build something reasonable, call the right tool directly "
    "rather than asking many clarifying questions first -- a first attempt that gets "
    "refined over follow-up messages is more useful than an interrogation before "
    "doing anything. If a tool returns validation errors, fix them yourself and call "
    "it again; do not give up after one failed attempt, and do not describe raw "
    "errors to the user unless you still can't resolve them after a few tries. Only "
    "ever claim something was created after a tool result actually confirms it -- "
    "never say you built something you didn't call a tool for.\n\n"
    "If asked to do something that needs a connected repository (e.g. "
    "reverse-engineering wireframes from existing code) and none is connected, say "
    "so plainly and point them at Project details -> Repository to connect one "
    "first, rather than inventing content as if one exists.\n\n"
    "If asked to build wireframes or diagrams and this project already has some, "
    "creating another is expected and safe -- every version stays reachable through "
    "the project's own version history, so there's nothing to lose. If the request "
    "clearly means one of the existing wireframes named below -- by name, or an "
    "obvious regenerate/refresh of it, e.g. after reverse-engineering an updated "
    "repository -- call update_wireframe with its real id instead of creating a "
    "duplicate; otherwise call create_bundle. If you genuinely can't tell which the "
    "user means, ask rather than guessing which one to touch. Open your reply with "
    'the plain fact -- e.g. "You already have 3 wireframes and 2 diagrams in this '
    'project -- here\'s a new one" or "Updating your existing Login wireframe" -- '
    "then call the right tool directly. Do not pause to ask permission or wait for "
    "confirmation before creating or updating; mentioning what already exists is "
    "just keeping them informed, not a gate to wait on.\n\n"
    "If you have create_epic/create_feature/create_requirement available: new "
    'epics start at status "Readiness", new requirements at "Todo". Create an '
    "epic before its features or requirements when more than one is wanted, so "
    "you can pass the epic's real id (from that tool's own result) as epic_id -- "
    "never invent an id. A feature always needs a real epic_id too. A "
    "requirement can go straight under an epic (epic_id) or under a feature "
    "within one (feature_id) -- use a feature when the user is grouping several "
    "related requirements together (e.g. \"password reset\" under \"onboarding\"), "
    "epic_id directly otherwise; pass at most one of the two.\n\n"
    "If you do NOT have create_epic/create_feature/create_requirement available "
    "and are asked to create, update or manage an epic, feature or requirement: "
    "say plainly that you don't have permission to manage this project's board, "
    "rather than trying another tool instead or implying it can't be done at "
    "all -- someone with the right role can.\n\n"
    f"{BUNDLE_FORMAT_GUIDE}"
)


def configured() -> bool:
    settings = get_settings()
    return bool(settings.bedrock_claude_model or settings.anthropic_api_key)


def _client_and_model(settings: Any) -> tuple[anthropic.AsyncAnthropic | anthropic.AsyncAnthropicBedrock, str]:
    """Which Claude credential this call runs on.

    A direct API key (once one is set, see config.py's anthropic_api_key)
    always wins over Bedrock -- that is the whole point of preparing this
    switch ahead of time: giving us a key is a config change, not a code
    change. Until then, anthropic_api_key is empty and every call keeps
    going through Bedrock exactly as it does today.
    """
    if settings.anthropic_api_key:
        return anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key, timeout=BEDROCK_CALL_TIMEOUT_SECONDS), settings.anthropic_model
    return anthropic.AsyncAnthropicBedrock(aws_region=settings.aws_region, timeout=BEDROCK_CALL_TIMEOUT_SECONDS), settings.bedrock_claude_model


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

    Locked-version-aware (``get_writable_project``): a locked version is a
    frozen record of what was agreed, and the agent can create content in
    this project via the create_bundle tool, so a conversation continuing
    against a locked version has no business changing that record.

    One transaction, like ``import_bundle``: anything the tool loop creates
    is only committed once a final reply is ready, alongside both chat
    messages. A failed Anthropic call rolls everything back -- no orphaned
    wireframe from a request that never got a reply.

    Rate-limited per organisation before anything else runs, deliberately
    cheaper than resolving the project: a burst from one organisation
    should cost the shared Bedrock capacity nothing once it's over its
    allowance, not one more DB round trip per rejected request.
    """
    rate_limit_key = f"project-agent:{ctx.scope_id}"
    if await _rate_limiter.is_rate_limited(rate_limit_key, RATE_LIMIT_MAX_MESSAGES, RATE_LIMIT_WINDOW_SECONDS):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                "Project Agent is being used heavily by this organisation right now -- "
                "please wait a moment and try again."
            ),
            headers={"Retry-After": str(RATE_LIMIT_WINDOW_SECONDS)},
        )

    project = await get_writable_project(db, project_id, ctx)
    if not configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Project Agent is not configured on this deployment (BEDROCK_CLAUDE_MODEL and ANTHROPIC_API_KEY both unset).",
        )

    history_result = await db.execute(
        select(ProjectAgentMessage)
        .where(ProjectAgentMessage.project_id == project.id)
        .order_by(ProjectAgentMessage.created_at.desc())
        .limit(MAX_HISTORY_MESSAGES)
    )
    history = list(reversed(history_result.scalars().all()))

    # Names and real ids, not just a count -- update_wireframe needs a real id
    # to target, and the id has to come from us; the model is never trusted to
    # invent one.
    wireframes_result = await db.execute(
        select(Wireframe.id, Wireframe.name)
        .where(Wireframe.project_id == project.id, Wireframe.account_id == project.account_id)
        .order_by(Wireframe.pos)
    )
    wireframes = wireframes_result.all()
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
        db=db,
        project=project,
        ctx=ctx,
        repo_full_name=project.repo_full_name,
        wireframes=wireframes,
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


def _tools_for(ctx: ScopeContext) -> list[dict[str, Any]]:
    """Which tools this request's caller actually gets to see.

    create_bundle and update_wireframe are always included: reaching this
    function at all already required data:write (send_message's own
    permission). The board tools
    are only added when the caller separately has board:write -- an
    account_member has data:write but not board:write (auth_config.yaml),
    so a member can chat their way to new wireframes but never sees
    create_epic/create_feature/create_requirement exist, the same way
    they'd never see an "Add epic" button rendered in a UI they can't use.
    """
    tools = [CREATE_BUNDLE_TOOL, UPDATE_WIREFRAME_TOOL]
    if ctx.has_permission("board:write"):
        tools += [CREATE_EPIC_TOOL, CREATE_FEATURE_TOOL, CREATE_REQUIREMENT_TOOL]
    return tools


async def _run_tool(db: AsyncSession, project: Project, ctx: ScopeContext, tool_use: Any) -> tuple[str, bool]:
    """Execute one tool call. Returns (content, is_error) for its
    tool_result. A name outside what _tools_for actually offered for this
    ctx -- the model hallucinating, or a stale tool_use replayed for a
    caller who never had board:write -- falls through to "unknown tool"
    rather than being executed; the permission check lives in what's
    offered, not trusted from the tool_use itself.
    """
    if tool_use.name == "create_bundle":
        result, errors = await create_bundle_content(db, project, ctx, tool_use.input)
        if errors:
            return json.dumps({"errors": [e.as_dict() for e in errors]}), True
        return json.dumps(result), False

    if tool_use.name == "update_wireframe":
        tool_input = dict(tool_use.input)
        raw_id = tool_input.pop("wireframe_id", None)
        try:
            wireframe_id = UUID(str(raw_id))
        except (ValueError, TypeError):
            return json.dumps({"errors": [{"path": "wireframe_id", "message": "wireframe_id must be a valid id."}]}), True
        result, errors = await update_wireframe_content(db, project, ctx, wireframe_id, tool_input)
        if errors:
            return json.dumps({"errors": [e.as_dict() for e in errors]}), True
        return json.dumps(result), False

    if tool_use.name == "create_epic" and ctx.has_permission("board:write"):
        try:
            payload = EpicCreate(**tool_use.input)
        except ValidationError as exc:
            return json.dumps({"errors": exc.errors()}), True
        epic = await create_epic_content(db, project, ctx, payload)
        return json.dumps({"id": str(epic.id), "title": epic.title, "status": epic.status}), False

    if tool_use.name == "create_feature" and ctx.has_permission("board:write"):
        try:
            payload = FeatureCreate(**tool_use.input)
        except ValidationError as exc:
            return json.dumps({"errors": exc.errors()}), True
        try:
            feature = await create_feature_content(db, project, ctx, payload)
        except HTTPException:
            return json.dumps({"errors": [{"field": "epic_id", "message": "No epic with that id here."}]}), True
        return json.dumps({"id": str(feature.id), "title": feature.title, "epic_id": str(feature.epic_id)}), False

    if tool_use.name == "create_requirement" and ctx.has_permission("board:write"):
        try:
            payload = RequirementCreate(**tool_use.input)
        except ValidationError as exc:
            return json.dumps({"errors": exc.errors()}), True
        # create_requirement_content validates epic_id/feature_id/release_id/
        # sprint_id/assignee_id against the real board itself now (including
        # a hallucinated one, or epic_id/feature_id naming inconsistent
        # epics) -- caught here rather than left to propagate, or a bad id
        # would fail the whole chat turn with a raw 404/422 instead of a
        # tool_result the model can read and retry from.
        try:
            _board, requirement = await create_requirement_content(db, project, ctx, payload)
        except HTTPException as exc:
            return json.dumps({"errors": [{"message": exc.detail}]}), True
        return json.dumps({"id": str(requirement.id), "title": requirement.title, "status": requirement.status}), False

    return f'Unknown tool "{tool_use.name}".', True


async def _ask_claude(
    *,
    db: AsyncSession,
    project: Project,
    ctx: ScopeContext,
    repo_full_name: str | None,
    wireframes: Sequence[tuple[UUID, str]] = (),
    diagram_count: int = 0,
    history: list[ProjectAgentMessage],
) -> str:
    settings = get_settings()
    client, model = _client_and_model(settings)
    messages: list[dict[str, Any]] = [{"role": m.role, "content": m.content} for m in history]
    tools = _tools_for(ctx)
    repo_fact = (
        f'A repository is connected: "{repo_full_name}".'
        if repo_full_name
        else "No repository is connected to this project yet."
    )
    if wireframes:
        wireframe_list = "; ".join(f'"{name}" (id {wireframe_id})' for wireframe_id, name in wireframes)
        content_fact = (
            f"This project already has these wireframe(s): {wireframe_list}. And {diagram_count} diagram(s). "
            "To update one of them, use its real id from this list -- never invent one."
        )
    else:
        content_fact = f"This project has no wireframes yet, and {diagram_count} diagram(s)."
    board_fact = (
        "You also have create_epic and create_requirement available for this project's delivery board."
        if ctx.has_permission("board:write")
        else "You do NOT have create_epic or create_requirement available for this conversation."
    )
    system = (
        f'{SYSTEM_PROMPT}\n\nThe project you are discussing is called "{project.name}". '
        f"{repo_fact} {content_fact} {board_fact}"
    )

    for _round in range(MAX_TOOL_ROUNDS):
        response = await _call_claude(client, model, system, messages, tools=tools)

        tool_uses = [block for block in response.content if block.type == "tool_use"]
        if not tool_uses:
            text_blocks = [block.text for block in response.content if block.type == "text"]
            return "".join(text_blocks).strip() or "(no reply)"

        # The assistant turn (including its tool_use blocks) must be echoed
        # back before the tool_result, or the next call is malformed.
        messages.append({"role": "assistant", "content": response.content})

        tool_results = []
        for tool_use in tool_uses:
            content, is_error = await _run_tool(db, project, ctx, tool_use)
            tool_result: dict[str, Any] = {"type": "tool_result", "tool_use_id": tool_use.id, "content": content}
            if is_error:
                tool_result["is_error"] = True
            tool_results.append(tool_result)
        messages.append({"role": "user", "content": tool_results})

    # Out of rounds without a natural stop. Do NOT hand back a canned "I
    # wasn't able to finish" here -- a live run showed that lies exactly
    # when it matters most: an earlier round in this same loop can have
    # already created real content before a later round ran into trouble,
    # and a canned failure message left the user thinking nothing happened
    # when a wireframe and a diagram genuinely existed in their project. One
    # final call with no tools forces a text reply, and the model has every
    # prior tool_result (successes and failures both) in its own context to
    # summarise honestly from.
    response = await _call_claude(client, model, system, messages, tools=None)
    text_blocks = [block.text for block in response.content if block.type == "text"]
    return (
        "".join(text_blocks).strip()
        or "I wasn't able to finish that after a few attempts -- could you clarify what you'd like, or try asking for something smaller?"
    )


async def _call_claude(
    client: anthropic.AsyncAnthropic | anthropic.AsyncAnthropicBedrock,
    model: str,
    system: str,
    messages: list[dict[str, Any]],
    *,
    tools: list[dict[str, Any]] | None,
) -> Any:
    try:
        return await client.messages.create(
            model=model,
            max_tokens=8192,
            system=system,
            messages=messages,
            **({"tools": tools} if tools else {}),
        )
    except anthropic.AuthenticationError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="Project Agent's credentials were rejected."
        ) from exc
    except anthropic.APIStatusError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Project Agent could not reply: {exc}"
        ) from exc
    except anthropic.APIConnectionError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="Project Agent could not be reached."
        ) from exc
