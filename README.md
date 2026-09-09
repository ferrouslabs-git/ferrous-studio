# Ferrous Studio

Analysis, wireframing and delivery in one place. Product owners and designers
describe a project — its rationale, use cases, personas, UML diagrams,
wireframes and reference documents — and carry it through to delivery on a
board of releases, epics, features and requirements.

Work moves in both directions:

- **Out** — export a project as a structured payload an LLM can consume to
  generate code.
- **In** — reverse-engineer an existing repository into wireframes and
  diagrams (see [Importing a project](#importing-a-project)).

**Live:** <https://studio.ferrouslabs.co.uk> · staging at
<https://staging.studio.ferrouslabs.co.uk>

A **project** opens in its own browser tab with its own menu, in two groups:

| Group | Section | What it holds | Where |
|---|---|---|---|
| | Project details | Name, description, rationale — plus the Environments, Repository and Import sections | `projects` |
| Scope | Use case diagram | Actors and the use cases they perform | `use_case_actors`, `use_cases` |
| Scope | Personas | Name, role, primary interface, traits, jobs to be done, pain points, feelings | `personas` |
| Scope | Diagrams | Free-form UML (maxGraph editor, `frontend/app/web/src/features/diagrams/`), saved whole with a version check | `project_diagrams` |
| Scope | Wireframes | Each wireframe is its own studio document (pages, frames, op batches, versions), tagged with personas and an interface type | `wireframes`, `project_pages`, … |
| Scope | Documents | Uploaded files, browser → S3 via presigned URLs | `project_documents` + the S3 bucket |
| Delivery | Roadmap | Releases and their epics on a time axis, with the sprint lane beneath | `board_releases`, `board_sprints` |
| Delivery | Epics | Epic list and detail — features, requirements, comments, attachments, and docs with Mermaid | `board_epics`, `board_features`, … |
| Delivery | Feedback | Reports raised against a deployed environment | `board_feedback`, `board_environments` |

## Documentation

| Doc | What it covers |
|---|---|
| [`docs/product-vision.md`](docs/product-vision.md) | Product vision and design philosophy |
| [`requirements.md`](requirements.md) | Component and feature requirements (PRD) |
| [`docs/auth-flow-and-roles.md`](docs/auth-flow-and-roles.md) | How login, users and roles work, end to end |
| [`docs/github-repository.md`](docs/github-repository.md) | Connecting an organisation and a project to GitHub |
| [`docs/go-live-and-merge-boards.md`](docs/go-live-and-merge-boards.md) | Status of the go-live and board merge, and what remains |
| [`docs/live-session.md`](docs/live-session.md) | Running against the live environment |
| [`docs/ecs-deploy.md`](docs/ecs-deploy.md) | ECS Fargate deploy runbook |
| [`docs/shared-rds-new-product.md`](docs/shared-rds-new-product.md) | Onboarding a product onto the shared RDS/VPC/ALB |
| [`infra/docs/onboarding-runbook.md`](infra/docs/onboarding-runbook.md) | **Read before touching AWS by hand** |

## Layout

| Path | What it is |
|---|---|
| `backend/` | FastAPI + Postgres (SQLAlchemy 2 / Alembic). `app/auth/` is the reusable Cognito auth, tenancy and RBAC module — treat it as a library. `app/studio/` is the Ferrous domain: one module per resource (`projects.py`, `wireframes.py`, `personas.py`, `diagrams.py`, `documents.py`, `use_cases.py`, `datasets.py`, `annotations.py`, `audit.py`, `versioning.py`) plus `board/` (the delivery board), `github.py` / `github_client.py`, `importing.py` and `catalog.py`, all mounted by `router.py`. `storage.py` is the only place that calls S3. |
| `frontend/app/web/` | React 18 + Vite + TypeScript SPA. Landing page, org/project management, the studio canvas and the delivery board. |
| `board_mcp.py` | MCP (stdio) server letting an AI agent read and update one project's board. See [Board tokens and MCP](#board-tokens-and-mcp). |
| `infra/` | Terraform for the shared AWS estate (Cognito pools, RDS roles/databases, ECR, IAM, target groups) plus manual deploy scripts. |
| `scripts/` | `create-super-admin.sh` (first login, end to end), `run-local.ps1` / `.sh`, `run-local-full.sh`. |
| `.claude/skills/` | `run-local` (launch and drive the app locally) and `reverse-engineer-repo` (turn a repository into an import bundle). |
| `legacy/` | The original zero-dependency vanilla builder (`mockup.html` + `js/*.global.js`). Reference source for the React port; opens directly from the filesystem. |
| `app.config.json` | Single source of truth for the product name, port and domain. Terraform and the deploy scripts read it — do not hardcode the product name elsewhere. |

## Roles

Two tiers, config-driven in `backend/app/auth/auth_config.yaml`. An
organisation owns its projects directly — there is no workspace layer.

Platform roles resolve from a real platform-scope `Membership`, not from a
flag. `users.is_platform_admin` still exists and is kept in sync, but it is a
display flag for the existing API response shape and **is not consulted for
authorisation**.

| Tier | Role | Permissions |
|---|---|---|
| Platform | `platform_admin` | `platform:configure`, `accounts:manage`, `accounts:read`, `users:suspend` |
| Platform | `platform_member` | `accounts:manage`, `accounts:read` |
| Platform | `platform_viewer` | `accounts:read` |
| Organisation | `account_admin` | `account:delete`, `account:read`, `members:manage`, `members:invite`, `integrations:manage`, `audit:read`, `data:read`, `data:write`, `tasks:create`, `board:read`, `board:write`, `board:tokens`, `feedback:create` |
| Organisation | `account_member` | `account:read`, `data:read`, `members:invite`, `tasks:create`, `board:read`, `feedback:create` |
| Organisation | `account_viewer` | `account:read`, `data:read`, `board:read` |

> **Only the organisation admin writes content.** Members and viewers read it.
> A member's three additions are inviting people (member/viewer only — see the
> subset rule below), pinning tasks to a wireframe, and raising feedback
> against a deployed environment. `tasks:create` and `feedback:create` are
> deliberately narrower than `data:write` / `board:write`: each authorises
> creating one kind of thing and nothing else — not editing it, not resolving
> it, not deleting it, not even your own.

**Invite authority is a subset rule** (`create_invitation_response` in
`app/auth/api/route_helpers.py`): you may only invite a role whose permissions
are a subset of your own. That is what stops a member inviting an admin, and it
is why `account_admin` must list every permission `account_member` holds —
drop `tasks:create` from the admin and admins can no longer invite members.

**Platform users read across organisations; Postgres refuses their writes.**
The row-level-security policies admit any row for a platform read, but
`WITH CHECK` no longer honours `app.is_super_admin` — so cross-organisation
writes fail at the database, not merely at the API.

Organisations are invite-only: a platform admin creates the organisation and
invites its first admin, who invites everyone else. There is no public sign-up.
The whole chain, including the one-time bootstrap of the very first login, is
in [`docs/auth-flow-and-roles.md`](docs/auth-flow-and-roles.md).

### Adding platform admins

Three routes, in order of preference:

1. **Promote** — an existing platform admin toggles someone on the
   Admin → Users page (`PATCH /api/um/platform/users/{id}/promote`). Audited.
2. **Invite** — `POST /api/um/platform/invite` emails a link that sets the
   platform flag on acceptance. No organisation is involved, and the invitee
   chooses their own permanent password.
3. **Seed** — `PLATFORM_ADMIN_EMAILS`, a comma-separated list. Anyone on it
   becomes a platform admin at their next sign-in, whether or not they have
   ever signed in before. Deployed environments take it from
   `app.config.json`'s `platform_admin_emails`; local dev sets it in
   `backend/.env.local`.

Seeding exists because a deployed environment has no other way in without
database access: the ECS task already holds `DATABASE_URL` and sits inside the
VPC, while the RDS instance is private and unreachable from a laptop. It is
configuration rather than an API, so it adds no route an attacker could call —
which is why there is deliberately **no** "make me an admin" endpoint.

> The seed list is authoritative while it is set. Demoting a seeded address in
> the UI lasts only until that person signs in again — remove them from the
> config to make a demotion stick.

`backend/scripts/bootstrap_admin.py` remains for the very first admin in a
fresh database and refuses to run once any platform admin exists.

Inviting someone pre-creates their Cognito user (Cognito's own email is
suppressed) and sends our own email with a `/invite/<token>` link. Opening it
shows a set-password page with the address prefilled; submitting calls
`POST /api/um/invites/complete`, which sets the password, signs the user in
server-side (`ADMIN_USER_PASSWORD_AUTH`), creates the local user row and
accepts the invitation in one step, so they land in the organisation already
signed in. An address that already has a password is asked to sign in through
the hosted UI instead and is brought back to the link to accept.

## The board

Each project carries a delivery board: **Release → Epic → Feature →
Requirement**, plus sprints, docs, comments, attachments and an event log
(`backend/app/studio/board/`).

**One board per project _lineage_, not per project row.** A `projects` row is
one *version* — versioning deep-copies the project and locks the source. A
board hanging off the project row would be duplicated by every snapshot and
frozen by every lock, so `boards` is keyed on `(account_id, lineage_id)`
instead. Board routes therefore resolve through `get_project`, **not**
`get_writable_project`; the deliberate exceptions are listed in
`backend/tests/test_lock_coverage.py`, and `copy_project` never learns the
board exists.

**Human ids are per board.** `boards` carries `release_seq`, `epic_seq`,
`feature_seq`, `requirement_seq`, `sprint_seq`, `doc_seq` and `feedback_seq`;
entities store the raw `seq` under a `UniqueConstraint(board_id, seq)` and the
API formats it (`REL1`, `E4`, …). Every project starts at 1. This is the same
pattern `wireframes.note_seq` / `task_seq` uses to mint `N-3` / `T-7`.

**Environments** (`board_environments`) name where a project is deployed, and
feedback is raised against one. They live on the board — that is, on the
lineage — for the same reason the board does.

Attachments go to S3 through the presign/confirm/download path, not into
Postgres.

## Board tokens and MCP

`board_mcp.py` is an MCP (stdio) server over the board's REST API, so an AI
agent can read and update requirements without a browser. It authenticates
with a **board token**, not a Cognito login.

- Minted by an `account_admin` (`board:tokens`), scoped to **one** board, shown
  once at creation and stored only as a SHA-256 hash.
- Resolves to a `ScopeContext` carrying `board:read` / `board:write` **only** —
  never `data:*`, never platform. A leaked token cannot touch personas,
  wireframes or diagrams.
- `board/auth.py`'s `require_board_permission` accepts either a Cognito JWT or
  a `bt_`-prefixed token and is used **only** on board routes;
  `require_permission` itself is deliberately untouched.
- `ScopeContext.board_id` is set only on the token path and checked against the
  resolved board, so a token minted for one project cannot reach another.

**Agents are scaffolding, and do not run.** The `board_agents` / `agent_runs`
tables, the queue/heartbeat/finish bookkeeping and the UI are real; but
`launch_agent_task` reports "not configured" rather than faking a launch —
there is no ECR image, no task definition, and no per-organisation
GitHub/Claude credential design to inject if there were. See
[`docs/go-live-and-merge-boards.md`](docs/go-live-and-merge-boards.md) phase 5.

## GitHub

An organisation connects to GitHub once and every project in it shares the
connection; the repository link is per project and lives on the `projects` row.

Installing leaves our API and comes back through the browser's address bar, so
`GET /studio/github/callback` is unauthenticated and cannot be otherwise.
Three things stand in for the usual guards, and all three are needed: the
signed `state` naming the organisation and user (fifteen-minute expiry); the
OAuth `code`, exchanged for a throwaway user token; and
`user_has_installation`, without which substituting another organisation's
installation id would hand this organisation read access to somebody else's
code. Details in [`docs/github-repository.md`](docs/github-repository.md).

## Importing a project

`backend/app/studio/importing.py` validates an import bundle — the inverse of
`GET /projects/{id}/export` — against exactly the vocabulary the canvas editor
allows (`catalog.py` / `catalog.json`) before anything is created from it. The
validator is pure: no database, no network.

The `reverse-engineer-repo` skill turns an existing application's source into
such a bundle (wireframes and diagrams only) and runs the same validator
locally, so a bundle that reaches the server has already been checked. Upload
from the Import section on Project details, or from the Wireframes page.

## Local development

There is no local Cognito — local dev authenticates against the real
**staging** user pool.

1. `cd infra/terraform && terraform init && terraform apply` (once per app).
2. Copy `backend/.env.local.example` → `backend/.env.local` and
   `frontend/app/web/.env.local.example` → `frontend/app/web/.env.local`,
   filling the Cognito values from `terraform output cognito` (`staging`).
3. `docker compose -f infra/local/docker-compose.yml up -d` for Postgres.
4. `infra/scripts/create-local-dev-user.ps1` (or `.sh`) for a login.
5. `scripts/create-super-admin.sh <email>` to make that login the first
   platform admin — it creates the Cognito user, signs in once (which creates
   the Postgres row) and runs `backend/scripts/bootstrap_admin.py`, which
   refuses to run if a platform admin already exists. For a second admin, or a
   database that already has one, put the address in `PLATFORM_ADMIN_EMAILS`
   instead and sign in (see [Adding platform admins](#adding-platform-admins)).
6. `.\scripts\run-local.ps1` (backend) and `npm run dev` in
   `frontend/app/web` (frontend). `scripts/run-local-full.sh` starts both.
   The `run-local` skill drives this end to end, including a browser session
   without a Cognito login.
7. Optional features, configured in `backend/.env.local`. Each reports "not
   configured" rather than failing when its settings are absent:
   - **Documents and board attachments** need `DOCUMENTS_BUCKET` (local dev
     uses the real staging bucket `terraform output documents_bucket` creates;
     the AWS profile the backend runs under needs S3 access to it).
   - **GitHub** needs `GITHUB_APP_ID`, `GITHUB_APP_SLUG`,
     `GITHUB_APP_PRIVATE_KEY`, `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.
   - **Agents** need `AGENT_ECS_CLUSTER`, `AGENT_TASK_DEFINITION`,
     `AGENT_SUBNETS` and `AGENT_SECURITY_GROUP` — none of which exist yet, so
     this stays unconfigured.
   - **Slack notifications** need `SLACK_WEBHOOK_URL`.

   Note that `uvicorn --reload` does not re-read `.env.local`; `touch
   backend/app/config.py` after changing it.

> **Row-level security is bypassed locally.** The Docker Postgres user (`app`)
> is a superuser, and superusers skip RLS regardless of `FORCE ROW LEVEL
> SECURITY`. The RDS app roles are plain `LOGIN` roles, so RLS is live in
> staging and prod. To exercise the policies locally, `SET ROLE` to a
> non-superuser role that has been granted the tables. Board tokens were once
> shipped broken for exactly this reason — they worked locally and failed
> under real RLS on prod.

## Deploying

No CI/CD — deploy manually, matching the branch you're on:
`infra/scripts/deploy-staging.ps1` on `staging`, `infra/scripts/deploy-prod.ps1`
for prod (`.sh` equivalents alongside). Both are idempotent, and both run
Alembic as a one-off Fargate task before rolling the service.

## Conventions

- British English in all user-visible text and comments (see `CLAUDE.md`).
- Every studio query is filtered by organisation (`account_id`) in Python
  **and** protected by Postgres row-level security. Both layers, always.

## Tests

- Backend: `.venv312\Scripts\python -m pytest backend`
  (dev deps: `pip install -r backend/requirements-dev.txt`). Covers the op
  applier and ordering keys, bundle validation and import, GitHub state and
  link state, lock and version coverage, org audit, platform invitations,
  role permissions, user archive, annotation targets and page copy.
- Frontend: `npm test` in `frontend/app/web` — sync outbox, op application,
  diagram model derivation, and the studio model.

Neither suite talks to Postgres or S3; the browser flows (new-tab project
shell, wireframe studio, diagram autosave/409, uploads, board editing) are
verified by hand against the dev servers or through the `run-local` skill.
