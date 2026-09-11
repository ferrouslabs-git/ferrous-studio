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

1. **Who can use the chatbot on a project?** Everyone in the organisation,
   or only members with edit access to that project (matching how every
   other write action in Studio already works)?
2. **Does a project's chat remember previous conversations**, or does it
   start fresh every time the tab is opened?
3. **What happens if wireframes/diagrams already exist** when the chatbot
   is asked to reverse-engineer the repo again — warn, replace, or version?
   (Confirmed via code: today's plain Import endpoint does none of these —
   it silently creates a duplicate wireframe every time. That gap exists
   today, independent of the chatbot, and should probably be fixed either
   way.)
4. **Is the "agent connection" (whichever Claude credential powers a
   session) org-level or platform-level for v1?** Leaning platform-level
   per Elliott ("our claude code subscription"), with org-level
   bring-your-own-key explicitly deferred (§0.5) — but worth a one-line
   confirmation.
5. Confirm scope: is "Project Agent" v1 chatbot going to cover **both**
   reverse-engineering and planning (epics/features/requirements), or
   should it ship reverse-engineering only first, planning later?

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

- Confirm resource limits: what stops one organisation's heavy usage from
  starving another's session (session concurrency limits, timeouts).
- Confirm data isolation under load, not just in a two-session test.
- Basic usage visibility/logging per organisation, since this is the
  thing that'll matter once §0.4/§6 (bring-your-own-key) comes up.

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
