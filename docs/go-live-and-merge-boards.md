# Go-live and board merge — status

Planned 2026-09-06, **updated 2026-09-09**. Ferrous Studio is live at
`studio.ferrouslabs.co.uk` and the delivery board is built. This document was
originally a forward plan; it is now a record of what shipped, what changed
along the way, and the short list of what is genuinely still outstanding.

## Status at a glance

| Phase | Status |
|---|---|
| 0. Pre-launch fixes | **Done** |
| 1. Go-live | **Done** — live on prod |
| 2. Role restructure | **Done** — real platform roles, RLS read-only split |
| 3. Board + MCP | **Done** — `backend/app/studio/board/`, `board_mcp.py` |
| 4. Board UI | **Done** — Roadmap, Epics, Plan, Feedback |
| 5. Agents | **Scaffolding only** — deliberately not launching |
| 6. Self-serve organisations | **Not started** — still invite-only by design |

Plus a substantial amount that was never in the plan: GitHub App integration,
reverse-engineering an existing repo into a project, environments, feedback,
an organisation audit log and platform invitations.

---

# What shipped

## Phase 0 — Pre-launch fixes

All three landed.

- The unused `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` entries are gone from
  `infra/ecs/taskdef.template.json`, so a task can no longer fail to start on
  an unresolvable secret.
- Both engines in `backend/app/database.py` are capped — async at
  `pool_size=4, max_overflow=4` (8 per task, 16 across a deploy overlap) and
  sync at `2/2`, comfortably inside the role's `CONNECTION LIMIT 20`.
- `crypto.randomUUID()` in `ProjectsPage.tsx` is guarded, so nothing depends on
  a secure context that might not exist.

## Phase 1 — Go-live

`app.config.json` now carries `domain.root = "studio.ferrouslabs.co.uk"` — the
subdomain option, keeping DNS and the SES sender identity in one zone.

Prod is deployed and has been exercised in anger: `fd6b731` ("board tokens were
unusable under real RLS — found on prod, post-deploy") is a bug found *after*
release, which is the clearest evidence the pipeline works end to end.

First-login bootstrapping is now a scripted path rather than a runbook
paragraph — `scripts/create-super-admin.sh` creates the Cognito user, logs in
once to create the Postgres row, and runs `bootstrap_admin.py`. The whole
chain is written up in `docs/auth-flow-and-roles.md`.

## Phase 2 — Role restructure

The `super_admin` boolean bypass is gone as a *design*, replaced by a real
platform tier:

- `platform_admin` / `platform_member` / `platform_viewer` in
  `backend/app/auth/auth_config.yaml`, resolved from a genuine platform-scope
  `Membership` (migration `a1c9e4f7b382_platform_admin_memberships`).
- **The `USING` / `WITH CHECK` split is done**
  (`f7a3d8e1c265_rls_platform_read_only`). Platform users keep cross-organisation
  **read** for support and visibility; Postgres refuses their **writes**
  regardless of what the API believes, because `WITH CHECK` no longer honours
  `app.is_super_admin`.

That answers the plan's first open question in code: read-yes, write-no.

`is_super_admin` still exists on `ScopeContext` and is still set for platform
users — but it now means "may read across organisations", not "may do
anything", and the database enforces the difference.

## Phase 3 — Board and MCP

`backend/app/studio/board/` — about 3,980 lines across seven modules
(`models`, `schemas`, `service`, `routes`, `auth`, `agents`, `agent_routes`).

**Board per lineage held exactly as designed.** One `boards` row per
`(account_id, lineage_id)` with `uq_boards_account_lineage`, so versioning or
locking a project never forks or freezes its board.

**Per-board id counters held too.** `release_seq`, `epic_seq`, `feature_seq`,
`requirement_seq`, `sprint_seq`, `doc_seq` and `feedback_seq` live on the
`boards` row; entities store the raw `seq` under a
`UniqueConstraint(board_id, seq)` and the API formats it (`human_id`). Every
project starts at 1.

Entities: `board_releases`, `board_epics`, `board_features`,
`board_requirements`, `board_sprints`, `board_requirement_sprint_history`,
`board_docs`, `board_comments`, `board_attachments`, `board_events`, plus
`board_environments` and `board_feedback`, which were not in the plan.
Attachments went to S3 as intended — the presign/confirm/download shape.

**Board tokens work, and the dual-auth path is the interesting part.**
`board/auth.py`'s `require_board_permission` accepts *either* a Cognito JWT or
a `bt_`-prefixed board token and resolves both to a narrowly-permissioned
`ScopeContext`. It deliberately does not modify `require_permission`, which
every other route depends on — so a board token can only ever unlock
`board:read` / `board:write`, only on board routes. `ScopeContext.board_id` is
set only on the token path and checked against the resolved board, so a token
minted for one project cannot reach another.

Two bugs worth remembering, both already fixed: board tokens were initially
accepted on only two routes (`f34e850`), and were then unusable under real RLS
in production (`fd6b731`) — the second only surfaced because local development
bypasses row-level security.

`board_mcp.py` sits at the repository root, replacing SMA's `sma_mcp.py`.

## Phase 4 — Board UI

Live in the project menu (`AppShell.tsx`), in a second nav group beneath the
design sections:

| Nav item | Page |
|---|---|
| Roadmap | `features/project/roadmap/` |
| Epics | `features/project/epics/` — list plus a detail page carrying features, requirements, comments, attachments and docs with Mermaid rendering |
| Feedback | `features/project/feedback/` |

The Plan page (`features/project/plan/PlanPage.tsx`) holds releases, sprints
and requirements. As designed, the board's own left rail became a sub-navigation
inside the project rather than competing with the project menu, and no board
canvas was ported.

## Phase 5 — Agents: scaffolding, and honestly labelled

This is the one place where the status is easily misread, so it is worth being
precise. The commit message says "persistent, named, sprint-scoped workers",
but `backend/app/studio/board/agents.py` says plainly:

> there is no per-organisation credential-storage design yet for the
> GitHub/Claude credentials a real agent run would need, and
> `launch_agent_task` refuses to pretend otherwise — it reports "not
> configured" rather than faking a launch.

**What is real and tested:** minting and revoking board-scoped tokens,
resolving them into a `ScopeContext`, and the queue / heartbeat / finish
bookkeeping an agent run goes through. The `board_agents` and `agent_runs`
tables exist, and the UI manages them.

**What does not happen:** anything actually running. There is no ECR image, no
task definition, and no per-organisation credential to inject if there were.
`launch_agent_task` returns an explanatory string rather than launching —
the same "not configured" convention the Documents and GitHub sections use.

That is the right call, and it matches the original reasoning for deferring
agents: the blocker was never the control plane, it was per-organisation
secret storage, rotation and isolation.

---

# Built beyond the plan

None of this was in the original document; all of it is now in `main`.

**GitHub App integration** (`backend/app/studio/github.py`,
`github_client.py`, `features/orgs/OrgGitHubPage.tsx`,
`features/project/RepositorySection.tsx`). An organisation connects once and
every project in it shares the connection; the repository link is per project.
The install callback is a top-level browser navigation carrying no bearer
token, so three things stand in for the usual guards: a signed `state` naming
the organisation and user (fifteen-minute expiry), the OAuth `code` exchanged
for a throwaway user token, and `user_has_installation` — without which
substituting another organisation's installation id would hand over read access
to somebody else's code. Written up in `docs/github-repository.md`.

**Reverse-engineering a repository into a project**
(`backend/app/studio/importing.py`, `catalog.py` / `catalog.json`,
`features/project/ImportBundleDrawer.tsx`, and the `reverse-engineer-repo`
skill). Turns an existing application's source into an import bundle —
wireframes and diagrams — validated against exactly the vocabulary the canvas
editor allows before anything is created. The validator is pure (no database,
no network) and the skill runs it locally before upload.

**Environments** (`board_environments`) — keyed on the board, i.e. the lineage,
rather than on the project row, following the same reasoning as the board itself.

**Feedback** (`board_feedback`) with its own `feedback:create` permission shape.

**Organisation audit log** (`features/orgs/OrgAuditPage.tsx`) and **platform
invitations** (`e4b7c2d9a851_platform_invitations`).

Smaller additions: soft delete across the board entities
(`c2f8a4d9e735_board_soft_delete`), epic lifecycle status, a blocked status for
requirements, and derived release dates with a shipped marker.

---

# Decisions

## Held

Every structural decision from the original plan survived contact with the
implementation:

- One board per project **lineage**, not per `projects` row.
- Per-board id counters, so each project starts at 1.
- Attachments in **S3**, not `bytea`.
- **No board canvas** ported.
- Code imported, **data not** — SMA still runs its own roadmap.
- MCP tokens as organisation-owned credentials with `board:*` permissions only.

## Changed

- **Agents came early, as scaffolding.** The plan put them last and whole;
  what shipped is the token and bookkeeping half, with launching explicitly
  disabled. The deferred part is the same part that was always the blocker.
- **Scope grew considerably.** GitHub integration and repository
  reverse-engineering were not contemplated on 2026-09-06 and are now
  significant surface area.
- **The wireframe-task-to-requirement link was not modelled.** The plan called
  for a nullable reference from a requirement to a `wireframe_annotations` row
  in phase 3, so the promote action could follow cheaply later. It is not in
  `board/models.py`. This is the one piece of the original design that was
  dropped rather than deliberately deferred, and it is the feature that most
  makes the two halves one product rather than two apps sharing a container.

---

# What remains

1. **Finish agents, or decide not to.** Needs a per-organisation credential
   design (storage, rotation, isolation) for GitHub and Claude credentials,
   then an ECR image, a task definition, and `AGENT_ECS_CLUSTER` /
   `AGENT_TASK_DEFINITION` set per environment. Until then the UI manages
   agents that cannot run, which is worth either finishing or hiding.
2. **The wireframe-annotation → requirement link**, per the note above.
3. **Self-serve organisations.** Still invite-only, as designed and as
   documented in `docs/auth-flow-and-roles.md`. The Cognito routes already
   exist but are unreachable (`app/auth/api/custom_ui_routes.py`); the harder
   half remains bulk user and project import.
4. **`README.md` is stale.** It has not been updated since the studio work and
   does not mention the board, GitHub integration or the import path at all —
   its layout table and feature list now describe roughly half the product.

# Open questions

1. ~~Should platform admins read any organisation's board?~~ **Answered in
   code:** yes for reads, no for writes, enforced by Postgres.
2. **Does any other product carry a copy of `app/auth/`?** Phase 2 changed the
   role model inside it. If processmapper or anything else vendors the same
   module, that change wants upstreaming rather than leaving as a fork. Still
   unestablished.
3. ~~Which domain?~~ **Answered:** `studio.ferrouslabs.co.uk`.
