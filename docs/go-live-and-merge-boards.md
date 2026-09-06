# Go-live and board merge — plan of record

Written 2026-09-06. The route from where Ferrous Studio is today to a live
product with a per-project delivery board.

Phases run in order. Each is shippable on its own — nothing here needs a big
bang, and stopping after any phase leaves a working system.

```
0. Pre-launch fixes → 1. Go-live → 2. Role restructure
   → 3. Board + MCP → 4. Board UI → 5. Agents → 6. Self-serve orgs
```

## Decisions already made

| Decision | Choice |
|---|---|
| Board ↔ version | **One board per project lineage** (`lineage_id`), not per `projects` row |
| SMA's fate | **Stays live and untouched** at `management.fnai.dev`; its code is a frozen reference |
| What is imported | **Code, not data.** A board data import can happen later |
| Requirement ids | **Per-board counters** — every project starts at `E1` / `REQ-1` |
| Attachments | **S3**, reusing the documents bucket |
| Board canvas | **Not ported** |
| Agents | **Deferred** to phase 5 |
| Wireframe task → requirement | Model the link in phase 3, ship the promote action later |
| MCP tokens | Org-owned credentials, minted by `account_admin`, `board:*` permissions only |

Why "board per lineage": a `projects` row *is* one version. Versioning
deep-copies the row and every child into a new row and locks the source
(writes → 423). A board hanging off the project row would be duplicated on
every snapshot — duplicate ids, ambiguous tokens, `copy_project` growing by
~11 tables — or frozen mid-sprint by a design lock. The board is live
operational state; the design artefacts are the versioned record.

---

# Phase 0 — Pre-launch fixes

Three specific defects found while reading the infra. Roughly an hour in
total. Only the first is a hard blocker.

### 0.1 Remove the unused Anthropic entries from the task definition

`infra/ecs/taskdef.template.json` has `ANTHROPIC_API_KEY` in its `secrets`
block and `ANTHROPIC_MODEL` in `environment`. `infra/terraform/secrets.tf`
creates the secret **deliberately without a version**, so the key never lands
in Terraform state — it is meant to be filled in by hand.

But nothing reads either one: `grep -rn anthropic backend/` returns nothing.
An unresolvable secret is a hard task-start failure
(`ResourceInitializationError`), not a warning — so this either already bit
whoever deployed staging, or staging has not been deployed. Prod's secret is a
separate one and fails the same way.

**Fix:** delete both entries from the template. Leaving the empty secret in
Terraform is harmless — it simply must not be referenced by a running task
until it has a value.

### 0.2 Cap the connection pools

`backend/app/database.py` creates both engines with SQLAlchemy's defaults —
`pool_size=5, max_overflow=10`, i.e. 15 connections per task — against a role
created with `CONNECTION LIMIT 20`
(`infra/terraform/scripts/create-rds-roles.sh`, following
`docs/shared-rds-new-product.md` §2).

One task is fine. But a rolling deploy starts the replacement task before
draining the old one, so you transiently run two: up to 30 against a limit of
20, surfacing as `FATAL: too many connections for role` precisely during a
deploy under load.

Two details that make it tighter than it looks:

- The rate limiter opens its **own** session per request (`app/main.py` passes
  `AsyncSessionLocal` into `RateLimitMiddleware`;
  `app/auth/services/rate_limiter_service.py` does
  `async with self.db_factory()`). So an `/api/um/*` request holds two
  concurrent checkouts — its own and the middleware's.
- The **sync engine holds zero connections in the container**. `get_sync_db` is
  dead code and `SessionLocal`'s only consumer is
  `backend/scripts/bootstrap_admin.py`, which runs standalone. `create_engine`
  opens nothing until first use.

**Fix:** cap the async engine at `pool_size=4, max_overflow=4` (8 per task, 16
across a deploy overlap, headroom under 20). Cap the sync engine small as free
insurance for the script. Raising `CONNECTION LIMIT` is the alternative, but
that is exactly the shared-instance pressure `shared-rds-new-product.md` warns
about — better to be a good neighbour.

### 0.3 Guard `crypto.randomUUID()`

`frontend/app/web/src/features/projects/ProjectsPage.tsx:97` calls
`crypto.randomUUID()` directly for the version idempotency key. It is
`undefined` outside a secure context, so "create a version" throws over plain
HTTP.

Everything else already degrades correctly: `uid()`
(`features/studio/model/regions.ts`) uses `crypto.getRandomValues`, which *is*
available insecurely and has a `Math.random` fallback; `defaultBatchId()`
(`features/studio/sync/outbox.ts:65`) is guarded; and client page ids fall back
to `uuid4()` server-side (`app/studio/wireframes.py`, `id=payload.id or uuid4()`).

**Fix:** one line, reusing the guarded `defaultBatchId()` helper.

**Exit criteria:** a task starts cleanly from the rendered task definition; two
concurrent tasks cannot exceed the role's connection limit; the app functions
over plain HTTP.

---

# Phase 1 — Go-live

Ferrous Studio is complete and deployable. Its value does not depend on the
board, and launching first means discovering deployment problems on a codebase
you fully understand rather than alongside a large new feature. Real users on
the design side will also tell you what the board actually needs.

**The board is purely additive to this**, so nothing here has to anticipate it:
with the lineage design the board needs no new column on `projects`
(`lineage_id` already exists and is indexed as `ix_projects_account_lineage`).

### 1.1 What Terraform already does

`terraform apply` in `infra/terraform/` uses `for_each` over
`["staging", "prod"]`, so **prod is already provisioned** — database, role,
Cognito pool, target group and `DATABASE_URL` secret all exist after the first
apply.

| `shared-rds-new-product.md` step | Covered by |
|---|---|
| §2 roles + databases | `scripts/create-rds-roles.sh` — same SQL: `CONNECTION LIMIT 20`, `GRANT role TO master`, `CREATE DATABASE … OWNER`, `REVOKE CONNECT … FROM PUBLIC`, run via the `pg-admin` Fargate task |
| §3 secrets | `secrets.tf` — generates the password, writes `ferrous-studio/<env>/DATABASE_URL` |
| §4 IAM | `iam.tf` — adds `read-ferrous-studio-secrets` scoped to `ferrous-studio/*` on the shared `ecsTaskExecutionRole`, so its `processmapper/*` scoping is not a problem. Also adds `logs:CreateLogGroup`, which `awslogs-create-group: true` needs and the runbook does not mention |
| §5 network | `security_group.tf` — own task SG plus the ingress rule on the shared RDS SG |
| §7b target groups | `target_groups.tf` — both envs, health check `/api/health` |
| §7e service | `infra/scripts/_deploy-env.ps1` — creates or force-redeploys |

### 1.2 What is manual

Only the HTTPS/DNS half of §7, which the onboarding runbook already marks as
deliberately manual.

1. **Choose the domain** and set `domain.root` in `app.config.json`.
   `studio.ferrouslabs.co.uk` is the cheapest option: `ferrouslabs.co.uk` is
   already a verified SES identity (the invitation sender is
   `noreply@ferrouslabs.co.uk`), so DNS and email stay in one zone.
2. `terraform apply` again — the Cognito app clients and the HTTP listener rule
   both pick up the real hostnames.
3. **ACM certificate** covering the root and the staging subdomain,
   DNS-validated, then `aws elbv2 add-listener-certificates` onto the shared
   HTTPS listener (SNI).
4. **Two host-header rules on the HTTPS listener.** Use the same priorities
   Terraform used for the HTTP ones — `alb_priority_base` is **100**, so
   staging=100 and prod=101. Check for collisions first:
   `aws elbv2 describe-rules --listener-arn <alb_https_listener_arn>`.
   `shared-rds-new-product.md` §7c records 5 and 10 as taken by processmapper.
5. **DNS** — alias/CNAME at
   `processmapper-staging-alb-1723655842.eu-west-1.elb.amazonaws.com`.
6. `infra/scripts/deploy-prod.ps1` from the `main` branch.
7. `python backend/scripts/bootstrap_admin.py <email>` **against prod** — the
   prod Cognito pool is a separate pool, so no staging account exists there.

> **Routing gotcha.** Both listener defaults forward to processmapper staging —
> HTTPS by rule, HTTP:80 by default action. A Ferrous Studio hostname with no
> matching rule does not 404, it **silently serves processmapper**. That is the
> failure mode to expect from a missing rule or a priority collision.

### 1.3 The HTTP-only interim option

Possible, and more viable here than usual because **the app does not use the
Cognito hosted UI** — sign-in posts to `/api/um/custom/login` and the backend
authenticates server-side (`frontend/app/web/src/core/auth.ts`), so there is no
OAuth redirect and no HTTPS callback requirement.

The route in is the constraint. Tasks run `assignPublicIp=ENABLED`, so the
clean option is hitting **the task's public IP on 8080** with a temporary
ingress rule on the task SG for your own address.

Avoid: a host-header rule matching the **ALB's own DNS name** would work but
would steal that hostname from processmapper's default. A **path-based rule**
(`/studio/*`) fights the SPA, which serves at `/` with absolute `/assets/…`
paths and client-side routes like `/orgs/…`.

Three costs:

- `COOKIE_SECURE=true` in the task definition means the refresh cookie is
  `Secure` and browsers will not send it over HTTP. Sessions die at
  access-token expiry (~1h) with no silent refresh. Flip to `false`
  temporarily, and remember to revert.
- **Invitation links carry `APP_PUBLIC_URL`.** A task IP that changes on every
  deployment makes emailed invites dead on arrival — and invite-only is the
  *only* onboarding door. This is what makes HTTP-only unviable for real use
  rather than merely awkward.
- Phase 0.3, if not already done.

**Recommendation:** IP smoke-test now, subdomain before anyone else touches it.

**Exit criteria:** `curl https://<domain>/api/health` returns ok; a platform
admin can sign in to prod; an invitation email arrives with a working link.

---

# Phase 2 — Role restructure

### 2.1 The problem

`super_admin` is not a role — it is a boolean bypass.

`app/auth/security/dependencies.py:121` checks `users.is_platform_admin` and
builds a `ScopeContext` with **`active_roles=[]` and
`resolved_permissions=set()`** — deliberately empty — then sets
`is_super_admin=True`. `ScopeContext.has_permission()` returns `True` for
anything when that flag is set.

So the `super_admin` role in `app/auth/auth_config.yaml`, with its
`platform:configure` / `accounts:manage` / `users:suspend` permissions, is
**never loaded, never resolved, never checked**. The config documents a scoped
role that has no effect.

Three consequences:

1. **There is no platform tier.** `memberships.scope_type` already accepts
   `'platform'` and `ScopeContext.scope_id` is even annotated
   `# None for platform scope` — but nothing uses either. The real mechanism is
   one boolean, so you are an unrestricted god or you are not. No support role.
2. **It is a parallel authorisation system.** 17 call sites check
   `is_platform_admin` / `is_super_admin` directly rather than going through
   `require_permission` — across `tenant_routes.py`, `platform_user_routes.py`
   and `route_helpers.py`.
3. **It is god mode in the database too.** The bypass sets
   `app.is_super_admin='true'`, and every RLS policy carries that flag in
   **both** `USING` **and** `WITH CHECK` — so a platform admin can *write* to
   any organisation's rows, not merely read them.

### 2.2 The change

A real platform layer — `platform_admin` / `platform_member` /
`platform_viewer` — resolved through the same membership → role → permission
path as the organisation tier. Symmetric naming, real permission lists, and a
support role that can see without touching.

Work involved:

- **Split `USING` from `WITH CHECK`** across the ~20 existing RLS policies: the
  read clause keeps a platform flag, the write clause drops it. This is the
  substantive piece, and it is a genuine security improvement rather than
  cosmetics — today nothing at the database level stops a platform admin
  writing into a customer's organisation.
- Migrate `users.is_platform_admin = true` to platform membership rows. Trivial
  today (a handful of rows); more annoying once real organisations exist.
- Decide whether `memberships.scope_id` becomes nullable for the platform scope
  or takes a sentinel UUID. It is currently `NOT NULL`.
- Rewrite the 17 direct checks as permission checks.
- Retire the `is_super_admin` bypass in `get_scope_context`.

> **Caveat.** `app/auth/` is documented as a reusable library ("treat it as a
> library"). Restructuring roles *inside* the module is legitimate evolution
> rather than entangling it with Ferrous domain logic — but if another product
> carries a copy, this is a change to upstream rather than fork. Establish
> whether processmapper or anything else shares it before starting.

### 2.3 Why here in the order

After go-live, because go-live does not need it — the current model works, it
is inelegant rather than broken.

Before the board, because the board adds ~10 tables with RLS policies and
introduces `board:read` / `board:write`. Far better to write those once against
the corrected shape than to write them the old way and migrate a month later.

**If go-live slips more than a couple of weeks, do this first** — migrating
platform admins is nearly free while there are no real organisations.

**Exit criteria:** no code path consults `is_super_admin` as a bypass; a
`platform_viewer` can read across organisations and is refused writes *by
Postgres*, not only by the API.

---

# Phase 3 — Board + MCP

The backend half of the board, plus agent-free MCP access.

### 3.1 Schema

One Alembic migration. A `boards` row keyed on `(account_id, lineage_id)`, and
every board table carrying `board_id` + `account_id`.

Tables ported from SMA's `backend/store.py`: `releases`, `epics`, `features`,
`requirements`, `sprints`, `requirement_sprint_history`, `docs`, `comments`,
`attachments`, `events`.

**Not** ported: `canvas` and `board_revision` (the canvas is cut, which also
removes the whole-board `PUT`, the versioned-document 409 and the
`TRUNCATE`-based restore); `agents` (phase 5); `users` and `sessions` (Cognito
already covers this — SMA's `backend/auth.py` disappears entirely, bcrypt and
all).

Conventions to follow, without exception:

- `account_id` on **every** table, including join tables, because both the RLS
  policy and the leading index column key on it.
- RLS enabled **and forced**, in the phase-2 shape (split `USING` /
  `WITH CHECK`).
- Every query filters by `ctx.scope_id` in Python **as well**. Two layers,
  always.
- Ordering by fractional index (`pos`), as `app/studio/positions.py` already
  does — not integer positions.
- Human ids (`E1`, `REQ-12`) from **per-board counters** on the `boards` row,
  minted under a row lock. This is the `wireframes.note_seq` / `task_seq`
  pattern that already mints `N-3` / `T-7`.
- Model the wireframe link now: a nullable reference from a requirement to a
  `wireframe_annotations` row. The promote action itself can wait.
- Drop SMA's historical rename blocks (Ticket→Requirement, Milestone→Release).
  Those exist only to migrate SMA's live database; this is a fresh schema.

### 3.2 Service layer

`backend/app/studio/board/` — `models.py`, `service.py`, `routes.py`.

SMA's *logic* is worth preserving essentially as-is: the effort rollups,
`effectiveRelease()` inheritance, sprint burndown, and `claim_requirement`'s
atomic `SELECT … FOR UPDATE`. Its *plumbing* is not.

> **The one rule that must not be broken:** the ported store must use the
> request's `AsyncSession`. SMA opens its own psycopg connection per call; a
> separate connection does not see the transaction-local
> `set_config('app.current_scope_id', …)` that RLS depends on, so RLS would
> silently not apply. Given RLS is the entire safety net, this is not
> negotiable.

Also reconsider SMA's snapshot-on-every-mutation (its `_snapshot` serialises
the whole board into `board_revision` on every single write). That was
tolerable for one board and is wasteful across many — and with the canvas cut,
the revision machinery it fed is mostly gone anyway.

### 3.3 Routes and permissions

Mounted under the existing prefix, so scoping lives in the URL, the permission
guard and the RLS policy:

```
/api/studio/projects/{project_id}/board/...
```

Board routes resolve through `get_project`, **not** `get_writable_project` — a
locked design version must not freeze the live board. Add them to the
deliberate-exception list in `backend/tests/test_lock_coverage.py`.
`copy_project` (`app/studio/versioning.py`) must never learn the board exists.

New permissions in `auth_config.yaml`:

- `board:read` / `board:write` — granted to the organisation roles alongside
  `data:*`.
- `board:tokens` — minting, granted **only** to `account_admin`, mirroring how
  `members:invite` is already admin-only.

### 3.4 The token principal

MCP introduces a bearer token that is not a Cognito JWT, held by a client
outside the browser. It is **not a new tenancy tier** — it is a credential
belonging to an existing organisation, carrying strictly fewer permissions than
the human who minted it.

- A `board_tokens` row: board, `account_id`, label, hash, `created_by`,
  `last_used_at`, `revoked_at`.
- Resolving one yields a `ScopeContext` pinned to that organisation with
  `board:read` + `board:write` **only** — never `data:*`, never platform — and
  it must still set the RLS GUCs.
- Scoped to **one** board, so a leak is contained to one project.
- Shown once at creation, stored hashed, never returned by any later API
  response. SMA already treats `agents.board_token` this way (deliberately
  excluded from its `AGENT_SELECT`).

### 3.5 MCP

`sma_mcp.py` is a thin typed wrapper over the REST API, so this is mostly a
re-point: new base URL, board-scoped token (so no tool needs a project
argument), and the tool set trimmed to what phase 3 exposes. Keep its
deliberate omission of delete tools — deleting stays a human action in the UI.

SMA also serves its own MCP script over HTTP so agents can `uv run` it without
cloning. Worth replicating; it needs an explicit exception in the SPA fallback
at `app/main.py`, alongside the existing static-file branch.

**Exit criteria:** a project has a board reachable over REST; an MCP client
with a board token can list and update requirements; that same token is refused
on `/api/studio/projects/{id}/personas`; RLS refuses cross-organisation reads
when the Python filter is removed in a test.

---

# Phase 4 — Board UI

`frontend/app/web/src/features/board/`, under the existing project route:

```
/orgs/:orgId/projects/:projectId/board          → Overview
                                    /plan       → Releases & Epics
                                    /sprints
                                    /roadmap
                                    /history
```

One `NavItem` in `src/app/AppShell.tsx` beside Documents. SMA's own left rail
becomes a sub-nav *inside* the board page — the project menu already owns the
sidebar.

Porting notes:

- **`effort.js` is the valuable part.** It carries the real domain logic
  (`effectiveRelease()`, the rollups). Port it as a pure module with tests,
  like `features/studio/model/` — not as view code.
- **Delete SMA's shell layer.** Its toasts, theme toggle and
  `uiConfirm`/`uiForm`/`uiPick` dialogs duplicate `components/Drawer.tsx`,
  `ConfirmDrawer.tsx`, `ComboBox.tsx` and `ThemeToggle.tsx`. Use ours.
- **Data access through `core/api.ts`**, so the bearer token, scope headers,
  silent refresh and typed errors come free.
- **CSP.** `default-src 'self'`
  (`app/auth/security/security_headers_middleware.py`) blocks SMA's Google
  Fonts link — self-host the faces. The vendored mermaid/xlsx/mammoth bundles
  are fine, and should stay lazy-loaded.
- No board canvas.

**Exit criteria:** a requirement can be created, moved through its workflow,
commented on and scheduled into a sprint entirely in the React UI, with the
project's role gating write affordances.

---

# Phase 5 — Agents

Deferred because agents need **per-organisation external credentials** — a
GitHub PAT and Claude credentials — which is a distinct problem: secret
storage, rotation and per-organisation isolation, none of which exists yet.
Nothing in phase 3's schema forecloses it.

When it happens:

- The `agents` table, and SMA's `_run_agent_task` / `_sync_agent_status` /
  `_maybe_wake_agent` control plane (trigger-on-queue, lazy status
  reconciliation, one-shot Fargate tasks — no daemon, no polling loop).
- A second ECR repo and a `deploy-agent-runner.ps1`.
- `ecs:RunTask` + `iam:PassRole` on the task role in `infra/terraform/iam.tf`,
  and the agent env vars in `infra/ecs/taskdef.template.json`.
- The runner currently clones a hardcoded repo; that becomes per-project
  configuration.
- Agent tokens reuse phase 3's token principal — an agent is just another
  holder of a `board:*` credential.

> `CLAUDE_CREDENTIALS` is a copy of a logged-in machine's
> `~/.claude/.credentials.json`. **It expires and does not silently refresh** —
> a container running on a stale copy simply fails. Budget for that
> operationally.

---

# Phase 6 — Self-serve organisations

Today organisations are invite-only: a platform admin creates the organisation
and invites its first admin, who invites everyone else. That flow works and
blocks nothing.

You are already part-way to self-serve: `app/auth/api/custom_ui_routes.py`
implements `/custom/signup`, `/custom/confirm`, `/custom/resend-code` and
`/custom/forgot-password`, all **unreachable** — the frontend has no sign-up
entry point by design.

Self-serve is essentially: expose signup, then create a tenant and an
`account_admin` membership in the same transaction.

The harder half is not signup, it is **"import their own users and projects"**.
Bulk user import and project import are real features with real edge cases —
duplicate addresses, partial failures, id remapping — and deserve their own
design. Neither is blocked by anything decided here.

---

# Open questions

1. **Should platform admins be able to read any organisation's board?** Today
   `super_admin` bypasses every check, so "yes" is the current default. Phase 2
   is the moment to decide deliberately. Support and debugging usually argue
   for read-yes / write-no, which is exactly what the `USING` / `WITH CHECK`
   split buys.
2. **Does any other product carry a copy of `app/auth/`?** Determines whether
   phase 2 is an upstream change or a fork.
3. **Which domain?** Blocks phase 1 and nothing else.
