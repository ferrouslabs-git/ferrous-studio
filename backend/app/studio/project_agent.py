"""The Project Agent chatbot: a per-project conversation with Claude that can
create wireframes and diagrams in the project via tool use.

Calls Claude through AWS Bedrock, using the ECS task's own IAM role
(``infra/terraform/iam.tf``'s ``bedrock_claude`` policy) rather than a
stored Anthropic API key -- there is nothing to generate, store or rotate.
Shared by every organisation -- there is no per-organisation credential
yet, and letting an organisation bring its own key/account is a later,
separate idea (Elliott's own words: "no need to do this now"). An
unconfigured deployment reports the tab as unavailable rather than
500ing, the same convention ``github_client.py`` and the documents
section already use.

The ``create_bundle`` tool is validated and created by exactly the same
code the manual Import button uses (``importing.create_bundle_content``),
so a bundle the chat produces is held to the identical bar -- wireframes
and diagrams only, nothing else, matching the client's own scope decision
for the reverse-engineer-repo skill. There is no separate "wireframe
editing" or "board" tool here yet -- see
docs/project-agent-implementation-plan.md for what's still Phase 3+.
"""
from __future__ import annotations

import json
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

from .catalog import get_catalog
from .common import get_project, get_writable_project
from .importing import create_bundle_content
from .models import Project, ProjectAgentMessage, ProjectDiagram, Wireframe
from .projects import _count
from .schemas import ProjectAgentMessageRead, ProjectAgentSend, ProjectAgentStatus

router = APIRouter(prefix="/projects/{project_id}/agent", tags=["project-agent"])

#: Generous enough for a long back-and-forth including tool results, which
#: run larger than a plain chat turn.
MAX_HISTORY_MESSAGES = 40

#: One user turn can trigger at most this many tool round-trips before the
#: agent has to stop and hand back control -- bounds cost/latency on a
#: bundle that keeps failing validation rather than looping indefinitely.
MAX_TOOL_ROUNDS = 4

#: Short, per-component usage hints. Not safety-critical -- a wrong hint
#: makes a worse suggestion, never an invalid bundle, since validate_bundle
#: (via create_bundle_content) is the real gate regardless of what the
#: model does with this text.
_COMPONENT_HINTS = {
    "navbar": "primary nav, a sidebar, a top tab strip, a breadcrumb trail",
    "list": "a data table, card grid, settings list, activity feed -- shape: table + column elements is the default for tabular data",
    "form": "a create/edit form, settings page, login form, multi-step wizard (shape: wizard + step elements)",
    "graph": "any chart, or KPI tiles (shape: stats + one stat element per tile)",
    "calendar": "a scheduler or booking calendar -- rare; most date-oriented needs are actually a list with a date column",
    "canvas": "anything else: a hero, a detail panel of labelled values (label+text pairs), a dashboard's free-form section, prose -- when nothing else fits, it's a canvas",
}


def _catalogue_reference() -> str:
    """The bundle format's component vocabulary, generated from the real
    catalogue rather than hand-copied into the prompt -- this can never
    drift out of sync with what create_bundle_content actually accepts."""
    catalog = get_catalog()
    lines = ["Only six component types exist in a page's layout -- nothing else is valid:"]
    for name, hint in _COMPONENT_HINTS.items():
        component = catalog.component(name)
        if component is None:
            continue
        shapes = ", ".join(sorted(component.shapes))
        layouts = ", ".join(sorted(component.layouts))
        elements = ", ".join(sorted(component.elements))
        lines.append(f"- {name} -- shapes: {shapes}. layouts: {layouts}. elements: {elements}. Use for: {hint}.")
    lines.append("")
    lines.append(f'Column element data.kind: {", ".join(sorted(catalog.data_kinds))}.')
    lines.append(f'Text-input element data.kind (a smaller, different list): {", ".join(sorted(catalog.input_kinds))}.')
    lines.append(
        f'A page that opens as an overlay instead of navigating sets "presentation" to one of: '
        f'{", ".join(sorted(catalog.presentations))}.'
    )
    lines.append("")
    lines.append(f'Diagram node types (model.nodes[].type): {", ".join(sorted(catalog.uml_node_types))}.')
    lines.append(f'Diagram edge types (model.edges[].type): {", ".join(sorted(catalog.uml_edge_types))}.')
    return "\n".join(lines)


#: A minimal but complete, valid example -- shown verbatim because prose
#: description alone was not enough in practice: a live run asked to
#: reverse-engineer a plausible app put every element's label under
#: data.label/data.text instead of as a top-level field, invented fields
#: like "icon" that don't exist, and omitted "size" on the root layout node.
#: An example anchors the exact shape in a way a list of field names doesn't.
_WORKED_EXAMPLE = """
{
  "wireframes": [{
    "name": "Example app", "interfaceType": "desktop", "landingPageId": "page-dashboard",
    "pages": [
      {
        "id": "page-dashboard", "name": "Dashboard",
        "layout": {
          "kind": "split", "dir": "row", "size": {"fr": 1},
          "children": [
            {"kind": "region", "id": "r-nav", "size": 220, "components": [
              {"id": "c-nav", "type": "navbar", "shape": "plain", "layout": "vertical", "elements": [
                {"id": "e-brand", "type": "brand", "label": "Example app"},
                {"id": "e-home", "type": "nav-item", "label": "Dashboard", "props": {"links": {"e-home": {"pageId": "page-dashboard"}}}},
                {"id": "e-settings", "type": "nav-item", "label": "Settings", "props": {"links": {"e-settings": {"pageId": "page-settings"}}}}
              ]}
            ]},
            {"kind": "region", "id": "r-content", "size": {"fr": 1}, "components": [
              {"id": "c-stats", "type": "graph", "shape": "stats", "layout": "horizontal", "elements": [
                {"id": "e-stat1", "type": "stat", "label": "Active users", "data": {"value": "128"}}
              ]}
            ]}
          ]
        }
      },
      {
        "id": "page-settings", "name": "Settings", "route": "/settings",
        "placement": {"page_id": "page-dashboard", "region_id": "r-content"},
        "layout": {"kind": "region", "id": "r-root", "size": {"fr": 1}, "components": [
          {"id": "c-form", "type": "form", "shape": "simple", "layout": "one-column", "elements": [
            {"id": "e-header", "type": "header", "label": "Account settings"},
            {"id": "e-name", "type": "text-input", "label": "Name", "data": {"kind": "text"}},
            {"id": "e-submit", "type": "button", "label": "Save"}
          ]}
        ]}
      }
    ]
  }],
  "diagrams": [{
    "name": "Data model", "kind": "class",
    "model": {
      "nodes": [
        {"id": "n-user", "type": "entity", "label": "User", "text": "id\\nname\\nemail", "x": 0, "y": 0, "w": 180, "h": 100}
      ],
      "edges": []
    }
  }]
}
""".strip()

BUNDLE_FORMAT_GUIDE = (
    "wireframes: a list of {name, interfaceType (desktop/tablet/mobile), landingPageId, "
    "pages}. Each page: {id (any short readable string, e.g. \"page-dashboard\"), name, "
    "route (optional), layout, placement (optional, {page_id, region_id} for a page that "
    "renders inside another page's shell)}. A layout is a nested tree, and EVERY node in it "
    '-- including the outermost/root one -- needs its own "size": {"kind": "region", "id", '
    '"size" ({"fr": 1}, a positive integer, or "auto"), "components": [...]} or {"kind": '
    '"split", "dir": "row"/"col", "size", "children": [<region or split>, ...]}. A component: '
    "{id, type (one of the six below), shape, layout, elements}. An element: {id, type, "
    '"label" (a plain string, directly on the element -- see the common mistakes below), '
    '"data" (optional, only the specific fields that element type actually takes -- e.g. '
    '"kind"/"samples"/"placeholder"/"value", never invented ones), "props": {"links": '
    '{<element id>: {"pageId": <page id or "@back">}}} only on elements that navigate}. '
    "Write shell/nav pages after every page they link to, so every nav-item's link resolves "
    "to a page id that's actually in the SAME wireframe's pages list. Sample data "
    "(data.samples) is invented, never a real person's data.\n\n"
    "Common mistakes to avoid (all seen in real runs):\n"
    '- An element\'s label is a TOP-LEVEL field: {"type": "nav-item", "label": "Dashboard"} '
    '-- never {"data": {"label": ...}} or {"data": {"text": ...}}.\n'
    "- Only use fields a given element type actually has. Don't add fields like \"icon\" or "
    '"title" that aren\'t in its list just because they seem plausible.\n'
    '- The root layout node needs a "size" too, not just its children.\n\n'
    f"{_catalogue_reference()}\n\n"
    "diagrams: a list of {name, kind (class/freeform/usecase/activity/sequence/state), model: "
    "{nodes, edges}}. A node: {id, type, label, text (optional multi-line detail), x, y, w, h "
    "(position may be omitted and will be grid-placed, but lay nodes out yourself in a simple "
    "grid, roughly 240px pitch, for a readable result)}. An edge: {id, type, label (optional), "
    "source, target}. For a data-model diagram (kind: class): one entity node per table, "
    '"text" listing its fields one per line; association edges labelled with cardinality '
    "(1..*, 0..1, etc).\n\n"
    "A complete, valid example (follow this shape exactly):\n"
    f"{_WORKED_EXAMPLE}"
)

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

SYSTEM_PROMPT = (
    "You are Project Agent, an assistant embedded in one specific project inside "
    "Ferrous Studio, a product-design and delivery tool. You are having an ongoing "
    "conversation with someone working on this project only -- you have no visibility "
    "into any other project, and never claim to. Be direct and concise.\n\n"
    "You can create wireframes and diagrams in this project using the create_bundle "
    "tool. When you have enough information to build something reasonable, call it "
    "directly rather than asking many clarifying questions first -- a first attempt "
    "that gets refined over follow-up messages is more useful than an interrogation "
    "before doing anything. If the tool returns validation errors, fix them yourself "
    "and call it again; do not give up after one failed attempt, and do not describe "
    "raw errors to the user unless you still can't resolve them after a few tries. "
    "Only ever claim something was created after a tool result actually confirms it "
    "-- never say you built something you didn't call the tool for.\n\n"
    "If asked to do something that needs a connected repository (e.g. "
    "reverse-engineering wireframes from existing code) and none is connected, say "
    "so plainly and point them at Project details -> Repository to connect one "
    "first, rather than inventing content as if one exists.\n\n"
    "If asked to build wireframes or diagrams and this project already has some, "
    'open your reply with that plain fact -- e.g. "You already have 3 wireframes '
    'and 2 diagrams in this project" -- using the real counts you were given, '
    "before anything else, and ask whether they want more added alongside the "
    "existing ones or mean something else. Wait for their answer before calling "
    "create_bundle in that case -- do not create anything until they confirm. If "
    "the project has nothing yet, or their message already makes the intent clear "
    '(e.g. "add another wireframe for the settings page"), go ahead without asking.\n\n'
    f"{BUNDLE_FORMAT_GUIDE}"
)


def configured() -> bool:
    return bool(get_settings().bedrock_claude_model)


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
    """
    project = await get_writable_project(db, project_id, ctx)
    if not configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Project Agent is not configured on this deployment (BEDROCK_CLAUDE_MODEL unset).",
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
        db=db,
        project=project,
        ctx=ctx,
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
    db: AsyncSession,
    project: Project,
    ctx: ScopeContext,
    repo_full_name: str | None,
    wireframe_count: int = 0,
    diagram_count: int = 0,
    history: list[ProjectAgentMessage],
) -> str:
    settings = get_settings()
    client = anthropic.AsyncAnthropicBedrock(aws_region=settings.aws_region)
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
        f'{SYSTEM_PROMPT}\n\nThe project you are discussing is called "{project.name}". '
        f"{repo_fact} {content_fact}"
    )

    for _round in range(MAX_TOOL_ROUNDS):
        response = await _call_claude(client, settings.bedrock_claude_model, system, messages, tools=True)

        tool_uses = [block for block in response.content if block.type == "tool_use"]
        if not tool_uses:
            text_blocks = [block.text for block in response.content if block.type == "text"]
            return "".join(text_blocks).strip() or "(no reply)"

        # The assistant turn (including its tool_use blocks) must be echoed
        # back before the tool_result, or the next call is malformed.
        messages.append({"role": "assistant", "content": response.content})

        tool_results = []
        for tool_use in tool_uses:
            if tool_use.name != "create_bundle":
                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": tool_use.id,
                        "content": f'Unknown tool "{tool_use.name}".',
                        "is_error": True,
                    }
                )
                continue
            result, errors = await create_bundle_content(db, project, ctx, tool_use.input)
            if errors:
                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": tool_use.id,
                        "content": json.dumps({"errors": [e.as_dict() for e in errors]}),
                        "is_error": True,
                    }
                )
            else:
                tool_results.append(
                    {"type": "tool_result", "tool_use_id": tool_use.id, "content": json.dumps(result)}
                )
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
    response = await _call_claude(client, settings.bedrock_claude_model, system, messages, tools=False)
    text_blocks = [block.text for block in response.content if block.type == "text"]
    return (
        "".join(text_blocks).strip()
        or "I wasn't able to finish that after a few attempts -- could you clarify what you'd like, or try asking for something smaller?"
    )


async def _call_claude(
    client: anthropic.AsyncAnthropicBedrock, model: str, system: str, messages: list[dict[str, Any]], *, tools: bool
) -> Any:
    try:
        return await client.messages.create(
            model=model,
            max_tokens=8192,
            system=system,
            messages=messages,
            **({"tools": [CREATE_BUNDLE_TOOL]} if tools else {}),
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
