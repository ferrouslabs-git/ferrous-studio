# Project Agent — phased implementation plan

Status: **draft, not confirmed by the client.** This turns the Slack
discussion with Ali and Elliott (see `project-agent-notes.md` for the
plain-language recap) into an actual build order. Nothing described here
should be treated as final scope until the open questions in §0 are
answered.

## 0. Open questions — get these confirmed before building past Phase 1

These came up while working through the idea and were never actually
answered by Ali or Elliott. Building ahead of these being settled risks
throwaway work.

1. ~~Who can use the chatbot on a project?~~ **Answered by Ali (Slack,
   2026-09-11):** everyone with access to the project, but *"a user asking
   for anything doesn't mean a user gets everything"* — access must be
   gated per tool category (wireframe tools vs. management/board tools),
   not one blanket check. **Built:** `create_bundle` needs `data:write`
   (already required to reach `send_message` at all); `create_epic` /
   `create_requirement` additionally need `board:write`, a real, stricter
   permission an `account_member` role does not have (only
   `account_admin` does — `auth_config.yaml`). The board tools are only
   ever added to the list Claude is offered when
   `ctx.has_permission("board:write")` is true, and `_run_tool` refuses to
   execute them even if somehow invoked without it — a member isn't told
   "no", the capability simply doesn't exist for that request. This is
   *not* Ali's separate-MCP-servers-plus-gateway proposal (§0.7 below,
   still not built) — it reuses the app's own existing permission system
   directly, which already drew this exact boundary.
2. ~~Does a project's chat remember previous conversations?~~ **Answered
   in code:** yes, persists indefinitely, one thread per project.
3. ~~What happens if wireframes/diagrams already exist and the chatbot is
   asked to build more?~~ **Answered by Ali (Slack, 2026-09-11):**
   *"Regenerate just generates a new wireframes file... Version is the
   history"* -- don't try to merge/update, just create a new one every
   time and rely on the existing version-snapshot system to keep the old
   one recoverable. **Built and verified live:** the chatbot now mentions
   the existing count, then creates directly in the same reply, no pause.
4. ~~Is the "agent connection" org-level or platform-level for v1?~~
   **Answered and built:** platform-level (AWS Bedrock, the ECS task's own
   IAM role) -- see §7. Org-level bring-your-own-key stays deferred (§6).
5. ~~Confirm scope: reverse-engineering only, or also planning
   (epics/features/requirements)?~~ **Answered by Ali (Slack,
   2026-09-11):** *"On the first one yes"* -- the chatbot should
   eventually do both. **Built and verified live:** `create_epic` and
   `create_requirement` tools exist (board:write-gated, see §0.1), reusing
   `board/routes.py`'s own creation logic (`create_epic_content` /
   `create_requirement_content`, extracted the same way
   `create_bundle_content` was) so a chat-created epic is held to the
   identical bar as one made by clicking the real "New epic" button.
   Verified with a real two-step flow: create an epic, then a requirement
   correctly filed under its real id in the same reply -- confirmed in the
   database, not just the chat reply. Feature-level board actions
   (releases, sprints, comments, attachments) are not built -- only
   create_epic/create_requirement, the two Niral's own question named.
6. **NEW, unresolved -- do not build yet:** Ali separately floated a
   *different* shape entirely: a dedicated "Reverse Engineer This Repo"
   button tied to its own one-off chat thread, which disappears once
   reverse-engineering finishes. This directly contradicts the
   always-available "Project Agent" tab that's already built and shipped
   (§7-9) -- a chat can't both be a permanent, ongoing assistant and a
   wizard that vanishes after one use. Elliott read it and said *"Not sure
   I understand. Jump on this call with Dustin and let's discuss"* --
   i.e. unresolved even inside the client's own team. **Do not implement
   either direction until that call happens and the team picks one.**
7. **Ali's proposed architecture for §0.1's access control** (Slack,
   2026-09-11): tool categories should live in *separate MCP servers*
   (mirroring `board_mcp.py`'s existing pattern -- one server per category,
   e.g. "management" vs "wireframe"), with a gateway in front of all of
   them enforcing role-based access before a tool call is allowed through.
   This is a materially different architecture from what's built today (one
   `create_bundle` tool embedded directly in `project_agent.py`'s own
   request loop, no separate MCP server, no gateway) -- a real redesign,
   not a small extension, if adopted as described.

## 1. What already exists (no work needed here)

- Reverse-engineering a repo into a wireframes/diagrams bundle (the
  `reverse-engineer-repo` skill + `/import` endpoint + Import UI).
- A working, proven example of an MCP server connecting Claude Code
  live to Studio's real API, scoped to one project (`board_mcp.py` +
  board tokens) — for planning data, not wireframes/diagrams yet.
- Org-level GitHub connection, project-level repo linking.

These are reused, not rebuilt. The gap is entirely the **live, in-app,
no-install chatbot** on top of them.

## 2. Phase 1 — Backend: a live agent session, callable from the server

**Goal:** prove a Claude Code (or Claude Agent SDK) session can run
*server-side*, on Ferrous Studio's own infrastructure, and answer a
message end-to-end — before any UI exists for it.

- Stand up a minimal backend service that can start one agent session,
  send it a message, and get a response back (text only, no tools yet).
- Runs under Ferrous Studio's own Claude account/subscription (the
  platform-level default from §0.4).
- Prove one session stays isolated to one conversation — no shared memory
  between two concurrent test sessions (the rule Ali stated explicitly).
- No UI, no persistence yet — a script or a temporary internal-only route
  is enough to prove this works.

**Exit criteria:** two concurrent sessions, sent different messages, never
see each other's context or history.

## 3. Phase 2 — Wire the session to real tools (MCP)

**Goal:** the agent session from Phase 1 can actually *do* things in a
project, not just chat.

- Give the session access to the existing board MCP tools
  (`board_mcp.py`) for one specific project, using a board token scoped
  to that project — reusing exactly what already exists.
- Give the session access to the reverse-engineering capability: either
  by wiring it to call the real `/import` endpoint after building a
  bundle, or by exposing equivalent MCP tools directly (create wireframe,
  add page, add diagram) — needs a decision, since today reverse-engineering
  produces a whole bundle file up front rather than incremental Studio
  actions.
- Fix the duplicate-wireframe gap from §0.3 before this ships, since the
  chatbot will hit it far more often than the manual Import flow does
  (repeat runs during a conversation are the normal case, not the
  exception).

**Exit criteria:** from a test harness (still no real UI), a message like
"create an epic called X" or "build wireframes from this repo" actually
changes real project data, correctly scoped to the right project only.

## 4. Phase 3 — The chat UI: the "Project Agent" tab

**Goal:** what a user actually sees and uses.

- New tab on a project's page, "Project Agent," gated by the permission
  decided in §0.1.
- A chat window: send a message, see the reply stream in, see the
  agent's questions/approval requests rendered as normal chat turns
  (this is where the "human-in-the-loop" behaviour from the original doc
  actually lives — no separate approval/question UI needed, it's just
  chat messages).
- Each project's chat is its own isolated session (per Phase 1's proof),
  never shared across projects or organisations.
- Implement whichever answer came out of §0.2 (persist history or not).

**Exit criteria:** a real person can open a project, type a request, and
get wireframes/diagrams or planning changes to land in the project, live,
without installing anything.

## 5. Phase 4 — Multi-tenant hardening

**Goal:** safe to actually turn on for real client organisations, not
just for internal testing.

**Done:**
- Resource limits: `send_message` is rate-limited per organisation (20
  messages / 5 minutes, `project_agent.py`'s `_rate_limiter`), reusing the
  same Postgres-backed limiter the auth endpoints already use rather than a
  new mechanism -- correct even if staging/prod ever runs more than one ECS
  task, unlike an in-memory counter would be. The check runs before the
  project is even resolved, so a rejected request costs almost nothing.
  Every Bedrock call also carries an explicit timeout
  (`BEDROCK_CALL_TIMEOUT_SECONDS`), so a hung call can't tie up a worker
  indefinitely -- its own way of starving other organisations even though
  the rate limiter never saw that request.
- Data isolation under load: proven with a real concurrency test (two
  projects' conversations run via `asyncio.gather`, not sequentially), not
  just reasoned about. Structural, not just tested -- every query is
  filtered by `project_id`, so there's no code path that could hand one
  project's conversation to another regardless of timing.
- Verified live: seeded an organisation to its exact rate-limit threshold
  and confirmed a real request 429s with the right `Retry-After`, without
  ever reaching AWS.

**Still open:**
- Usage visibility/logging per organisation has no dashboard or admin
  view yet -- the data exists (`project_agent_messages` carries
  `account_id` and `created_at` on every row, so total usage is a query
  away), but nothing surfaces it anywhere yet. Worth doing once §6
  (bring-your-own-key) is actually being built, per the original reasoning
  here, rather than speculatively now.

## 6. Phase 5 — Bring-your-own account/key (explicitly deferred by Elliott)

**Do not build this until asked.** Elliott's own words: *"No need to do
this now though, we can add that when we productise."* Listed here only
so the eventual work is easy to slot in without redesigning Phase 1-4:

- An org-level "AI settings" page (next to GitHub connection).
- Connect a Claude account, or paste an API key.
- Session credential resolution checks the org's setting before falling
  back to the shared platform account.

## 7. Explicitly out of scope for this plan

- **The code-editing agent idea** (agent claims a ticket, writes real
  application code, pushes it) — a separate, later initiative. Notably,
  the GitHub App connection already has "Contents: Read and write"
  permission, which that feature would need — worth remembering when it's
  actually scoped, but not part of this build.

## 8. Suggested order of work

1. Get §0's open questions in front of Ali — even a quick "yes/no" on each
   unblocks the rest.
2. Phase 1 (isolated server-side session) — buildable today, answers
   nothing client-facing but de-risks the hardest infrastructure question.
3. Phase 2 (MCP wiring) — mostly reuses what exists.
4. Phase 3 (the actual chat UI) — the first thing a client could see/demo.
5. Phase 4 (hardening) — before any real client organisation touches it.
6. Phase 5 — only when asked.
