# GitHub repository connection — plan of record

Written 2026-09-08. How an organisation connects to GitHub and how a project
picks the repository it is being built into.

Most of this shipped on 2026-09-07 (commit `6701598` and neighbours). What is
left is a **placement and permission change**, not a build: the connection
today is made from a project's details page, guarded on `data:write`; it needs
to live at organisation level, under the organisation admin, with the project
page reduced to choosing a repository through a connection that already exists.

Out of scope here, and deliberately not foreclosed: the agent that will read
the roadmap, build the application and push branches to the linked repository.
See phase 5 of `go-live-and-merge-boards.md` for where that sits.

```
1. Permission → 2. Organisation page → 3. Project page trims → 4. Audit log → 5. Infra → 6. Verify
```

## Decisions already made

These were taken on 2026-09-07 and are baked into the code and the schema.
They are listed so nobody re-opens them by accident.

| Decision | Choice |
|---|---|
| Integration type | A **GitHub App**, not an OAuth App. We store an `installation_id`, which is public, and mint hour-long tokens from the App's private key. No secret ever lands in the database |
| Connection scope | **One installation per organisation** (`github_installations.account_id` is unique). Every project in the organisation links through it |
| Link identity | `projects.repo_id` (numeric). Survives a rename or transfer; `repo_full_name` is a cached label refreshed on read |
| Branch | **None stored.** GitHub owns branches; the page shows `default_branch` as a live readout. An earlier draft had a `repo_branch` column and it was removed on purpose |
| Rename | **Silent.** The read route refreshes the cached name and reports `ok`. There is no `renamed` state |
| Lock rule | Link/unlink are **filing, not content**: they stay editable on a locked version (`EXEMPT` in `tests/test_lock_coverage.py`) |
| Callback security | Signed state (15 min) + HttpOnly nonce cookie bound to the starting browser + OAuth-during-install so the callback can prove the user owns the installation it was handed |
| Disconnect | Forgets the row and cached token. **Project links are left in place** and report `disconnected` until the organisation reconnects |

## Decisions this plan makes

| Decision | Choice | Why |
|---|---|---|
| Who connects | **Organisation admin or platform admin**, via a new `integrations:manage` permission on `account_admin`. Platform admins pass through the existing bypass in `ScopeContext.has_permission` | Decided 2026-09-08. Connecting a GitHub account is organisation administration, not content editing. `data:write` happens to be admin-only today, but a guard should say what it means, and a future role that writes content should not thereby gain the power to rebind the organisation's GitHub account |
| Who links a repository | **Organisation admin or platform admin**, via `data:write` (which only `account_admin` holds; platform admins bypass) | Decided 2026-09-08. Choosing which repository a project is built into is part of describing the project, and members and viewers are read-only throughout (`org-role-model`). If linking is ever opened to members it is a role YAML change, not a route change |
| Where connecting lives | New page `/orgs/:orgId/github`, "GitHub" item in the organisation menu beside Projects and Users. Platform admins, who have no organisation menu, reach it from a "GitHub" row action on Administration › Organisations | The organisation menu is where organisation-wide settings belong. Everyone in the organisation can open it and see which account is connected; only an admin sees the controls. Platform admins keep reaching everything through Administration (`admin-project-drawer-and-menu`) |
| What the project page does | Shows the link state and the picker. When the organisation is not connected it says so and, for an admin, links to the organisation page. **No Connect button on the project page** | One place to connect. The project page stops needing to explain an install flow it does not own |
| Callback return path | Always the organisation's GitHub page | The flow now only starts there. `GitHubConnectStart.project_id` and the `p` claim in the state go away |
| Organisation audit log | **Reuse `audit_events`** from the auth module; add `github_connected` / `github_disconnected`; a new admin-only page at `/orgs/:orgId/audit` behind `audit:read` | Membership and invitation events already live there. A second table would split the organisation's history by which module wrote it. The table has no RLS, so the route pins the scope filter itself |
| Disconnect confirmation | `ConfirmationDrawer`, the shared pattern | It is the one action on the page with consequences beyond itself: every linked project degrades to `disconnected` |
| GitHub App permissions | Create the App with **Contents: read and write**, Metadata: read, Pull requests: read and write | Decided 2026-09-08: the feature becomes read and write once the agents are built. Changing an App's permissions later makes every installation re-approve, so granting write now means the phase 5 agent needs no re-consent round. Nothing in this plan exercises write |

---

# What already exists

Read this before touching anything. All of it is live on `Org-users`.

### Backend

| Piece | File | Notes |
|---|---|---|
| GitHub App client | `backend/app/studio/github_client.py` | App JWT → installation token, per-process token cache with lock, `list_repositories`, `get_repository_by_id`, `latest_commit`, signed state, nonce, OAuth code exchange, `user_has_installation` |
| Routes | `backend/app/studio/github.py` | `GET/DELETE /studio/github/connection`, `POST /studio/github/connect`, `GET /studio/github/callback` (unauthenticated by necessity), `GET /studio/github/repositories`, `GET/PUT/DELETE /studio/projects/{id}/repository` |
| Models | `backend/app/studio/models.py` | `GitHubInstallation`; `Project.repo_id / repo_full_name / repo_linked_at / repo_linked_by` |
| Schemas | `backend/app/studio/schemas.py` | `GitHubConnectionRead`, `GitHubConnectStart`, `GitHubConnectUrl`, `GitHubRepositoryRead`, `RepositoryLink`, `RepositoryCommit`, `ProjectRepositoryRead` |
| Migration | `alembic/versions/c8a3f5d1e746_github_connection.py` | `github_installations` with the standard account RLS policy; four nullable columns on `projects`. Already listed in `SCOPED_TABLES` of `f7a3d8e1c265` |
| Config | `backend/app/config.py`, `backend/.env.local.example` | Five settings: `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY` (PEM or base64), `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`; optional `GITHUB_API_BASE` for Enterprise Server |
| Audit | `record_event` | `repository_linked` / `repository_unlinked` on the project audit log |
| Tests | `tests/test_github_state.py`, `tests/test_github_link_state.py` | State signing/verification as security tests; `link_state` ordering as a pure function |

### Frontend

| Piece | File |
|---|---|
| API client | `frontend/app/web/src/features/project/githubApi.ts` |
| Repository section on project details | `frontend/app/web/src/features/project/RepositorySection.tsx` — connection status, Connect button, `RepositoryPicker` drawer, `ConnectionFooter` (Manage on GitHub / Unlink / Disconnect), `useConnectOutcome` for the `?github=` banner |
| Project type | `features/projects/projectsApi.ts` carries the four `repo_*` fields |

### How the install flow works today

```
Project details → Connect GitHub
  POST /studio/github/connect            (bearer token; sets gh_install_nonce cookie; returns URL)
  browser → github.com/apps/<slug>/installations/new?state=…
  user picks an account and repositories; GitHub also asks them to authorise the App as a user
  browser → GET /api/studio/github/callback?installation_id&code&state&setup_action
    verify state signature + expiry → nonce cookie matches → exchange code
    → user_has_installation(installation_id) → get_installation
    → adopt_account_scope(account_id) → upsert github_installations
  303 → /orgs/{a}/projects/{p}/details?github=connected
```

The nonce cookie is why the App's Setup URL **must be on the SPA's origin**
(`http://localhost:5173/api/studio/github/callback` under Vite, not `:8080`).

---

# Phase 1 — Permission

### 1.1 Add `integrations:manage`

`backend/app/auth/auth_config.yaml` is live at runtime; nothing reads the
`role_definitions` tables, so **no migration**.

```yaml
    - name: account_admin
      permissions:
        - account:delete
        - account:read
        - members:manage
        - members:invite
        - integrations:manage    # connect / disconnect the organisation's GitHub App
        - audit:read             # read the organisation audit log (phase 4)
        - data:read
        …
```

Only the admin gets it. The invite subset rule in
`api/route_helpers.py::create_invitation_response` is unaffected: the admin's
permission set grows, and a member's stays a subset of it.

### 1.2 Re-guard the two organisation-level routes

In `backend/app/studio/github.py`:

| Route | Today | After |
|---|---|---|
| `POST /studio/github/connect` | `data:write` | `integrations:manage` |
| `DELETE /studio/github/connection` | `data:write` | `integrations:manage` |
| `GET /studio/github/connection` | `data:read` | unchanged |
| `GET /studio/github/repositories` | `data:read` | unchanged |
| `PUT/DELETE /studio/projects/{id}/repository` | `data:write` | unchanged |

The callback stays unauthenticated; the guards it substitutes are described
in the module docstring and nothing about them changes.

### 1.2a Platform admins need no backend change

A platform-scope user resolving an organisation scope gets `is_super_admin`
and `has_permission` returns true for every permission, so the new guard
passes. The writes still land under today's read-only RLS bypass
(`f7a3d8e1c265`) because `WITH CHECK` is now `account_id = current_scope_id`
and the platform admin's request carries the organisation as its scope:

| Write | Row | Scope var | Passes |
|---|---|---|---|
| `POST /connect` | none (only signs state) | organisation from `X-Scope-ID` | yes |
| callback upsert into `github_installations` | `account_id` = state's `a` | `adopt_account_scope(a)` | yes |
| `DELETE /connection` | `account_id` = scope | organisation | yes |
| `PUT/DELETE /projects/{id}/repository` | `projects.account_id` = scope | organisation | yes |

The callback does not know or care who started the flow beyond the state's
`u` claim, so a platform admin's install records their user id in
`connected_by` exactly as an organisation admin's would.

One pre-existing trait to be aware of, not to fix here: `get_scope_context`
treats every platform role alike (`platform_member` and `platform_viewer`
get the same `is_super_admin` shortcut). "Platform admin" in this plan
therefore means "any platform-scope member" until go-live phase 2 narrows
that, and the same is already true of every other write route.

### 1.3 Drop the project claim from the state

`GitHubConnectStart.project_id` and the `"p"` claim exist only to send the
browser back to the details page. After phase 2 the flow starts on the
organisation page, so:

- `GitHubConnectStart` becomes an empty body (keep the model; an empty POST
  body is still a POST).
- `sign_state(account_id=, user_id=, nonce=)` — remove `project_id`.
- `_return_to` always builds `/orgs/{a}/github`, or `/orgs` when there are no
  claims at all (a state that failed verification).
- `tests/test_github_state.py::test_state_round_trips` and its siblings lose
  the `PROJECT` constant.

Fail closed on old states: `verify_state` already rejects anything without a
nonce, and a state with a stray `p` claim is harmless because `_return_to`
no longer reads it.

### 1.4 Pin it

`tests/test_role_permissions.py` sweeps write routes under `PROJECT_ROUTES`
only, so `/studio/github/*` is not covered. Add:

```python
def test_connecting_github_is_organisation_administration():
    assert required_permissions(start_connect) == {"integrations:manage"}
    assert required_permissions(disconnect) == {"integrations:manage"}

def test_only_the_admin_manages_integrations():
    assert "integrations:manage" in _permissions(ADMIN)
    assert "integrations:manage" not in _permissions(MEMBER)
    assert "integrations:manage" not in _permissions(VIEWER)
```

```python
def test_a_platform_admin_passes_the_integrations_guard():
    ctx = ScopeContext(user_id=uuid4(), scope_type="account", scope_id=uuid4(),
                       active_roles=["platform_admin"], resolved_permissions=set(),
                       is_super_admin=True)
    assert ctx.has_permission("integrations:manage")
```

`test_admin_holds_every_member_permission` continues to pass as-is.

---

# Phase 2 — Organisation page

### 2.1 Route and menu

- `App.tsx`: `<Route path="/orgs/:orgId/github" element={<OrgGitHubPage />} />`
  next to the `users` route.
- `AppShell.tsx` organisation group: add
  `<NavItem to={`/orgs/${activeOrg.id}/github`} icon="github" label="GitHub" />`
  after Users. Add a `github` glyph to the icon set (`AppShell.tsx` around
  line 319 lists the names).
- Platform admins have no organisation menu (`admin-project-drawer-and-menu`),
  and that stays so. Give `AdminOrgsPage` a "GitHub" `RowMenuItem` that
  navigates to `/orgs/${tenant_id}/github`, beside the existing name link to
  `/orgs/:id`. The page must tolerate `org` being undefined the way `OrgPage`
  does, and for a platform admin it shows the organisation's name as its
  heading, since no sidebar names it.
- The callback's return path `/orgs/{a}/github` works for both kinds of admin:
  the route is not membership-gated, and the page decides what to render.

### 2.2 `features/orgs/OrgGitHubPage.tsx`

One page, three states, in the order `RepositorySection` already uses:

| State | Everyone sees | Admin also sees |
|---|---|---|
| Not configured | "GitHub is not configured for this deployment." | — |
| Not connected | "This organisation is not connected to GitHub." | **Connect GitHub** (primary) |
| Connected | Account (`account_login`, Organization/User), repository selection (all / selected), connected when and by whom, **Manage on GitHub** | **Disconnect** (ghost) → `ConfirmationDrawer` |

Admin is `isPlatformAdmin || org.role === "account_admin"`, read from the URL's
organisation the way `OrgPage` does, for the same deep-link reason. Add
`canManageIntegrations` to `app/session.tsx` beside `canManageMembers`
(`MANAGE_ACCOUNT_ROLES` already names exactly the admin, and `holds()` already
returns true for a platform admin), so the flag has one home. The project
page's Link/Change/Unlink already show for platform admins for the same
reason: the session's `canWrite` is true for them.

Disconnect copy, per CLAUDE.md (state facts, no explanatory prose):

> Disconnect from **acme-org**? Projects keep their repository links and
> report them as disconnected until the organisation connects again. The App
> stays installed on GitHub.

Move out of `RepositorySection.tsx` and into this page (or a shared
`features/orgs/githubConnection.tsx`):

- `useConnectOutcome` — the `?github=` banner now lands here, not on the
  details page.
- `ConnectionFooter` — becomes the page body, minus Unlink.
- the `connect` handler, including the "navigate, then never resolve" trick.

`githubApi.ts` moves from `features/project/` to `features/orgs/` or
`core/`; it is shared by both pages. `startConnect` loses its argument.

`connected_by` is stored but not returned: add `connected_by` to
`GitHubConnectionRead` and show "Connected by … on …" only when the user can
be resolved. Do not add a join to look the name up — show the date alone if
the id is all we have, and leave a name lookup for when the users list is
already on the page.

### 2.3 Auditing connect and disconnect

There is no project to hang these on (`record_event` takes a project). They
go to the organisation audit log instead: phase 4 says which table, which
actions and what metadata.

---

# Phase 3 — Project page trims

`RepositorySection.tsx` keeps: state readout, `RepositoryDetail`, the picker,
Link / Change / Unlink. It loses: Connect, Disconnect, the outcome banner.

The not-connected branch becomes:

```tsx
<span className="muted">This organisation is not connected to GitHub.</span>
{canManageIntegrations && (
  <Link className="btn ghost" to={`/orgs/${orgId}/github`}>Connect under Organisation</Link>
)}
```

The connected footer becomes a single line, "Connected to *acme-org* ·
selected repositories", with **Manage on GitHub** kept (it is the way to widen
the repository selection when the picker cannot see the repository someone
wants, and that is a project-page problem).

`canWrite` from `useProject()` still gates Link/Change/Unlink. It is already
narrowed by the lock in `ProjectLayout`, which is **wrong for these two
routes** — they are lock-exempt on the backend. Gate them on the raw session
`canWrite` instead of the project's, so a locked version can still be pointed
at its repository, matching what the server allows.

---

# Phase 4 — Organisation audit log

Who did what to the organisation: GitHub connections, memberships,
invitations. Read-only, admin-only, newest first.

### 4.1 Reuse `audit_events`, do not add a table

The auth module already has one: `audit_events`
(`app/auth/models/audit_event.py`), written through `log_audit_event` in
`app/auth/services/audit_service.py`. It is keyed on `tenant_id` and the
membership routes already write to it, so the organisation-level events this
page needs are mostly there:

| Already written | By |
|---|---|
| `tenant_created`, `tenant_updated` | `tenant_routes.py` |
| `tenant_user_updated`, `tenant_user_role_updated`, `tenant_user_removed`, `tenant_user_deactivated`, `tenant_user_reactivated` | `tenant_user_routes.py` |
| `invitation_created`, `invitation_resent`, `invitation_revoked`, `invitation_accepted` | `route_helpers.py`, `invitation_routes.py` |
| `email_send_failed` | email service |
| `tenant_suspended`, `tenant_unsuspended` | platform routes, acting on the organisation |

A second table shaped like `wireframe_audit_log` would split "what happened
to this organisation" by which module wrote it. The project audit log stays
where it is: it is per project, coalesces canvas edits, and answers a
different question.

Three properties of the existing table shape the route:

- **No RLS.** Platform-level rows have `tenant_id` NULL and the platform
  listing runs without scope variables, so a policy would break it. The
  organisation route must therefore filter on `ctx.scope_id` itself, and
  that filter is what the test pins (4.5).
- **No actor snapshot.** Only `actor_user_id` is stored. Resolve names at
  read time with a LEFT JOIN on `users`; a user is only hard-deleted after
  archiving (`user-archive`), so a missing row is rare and reads as
  "Deleted user". Do not add snapshot columns.
- **Best-effort write.** `log_audit_event` swallows persistence errors so an
  auth flow never fails over its audit row, and flushes on the caller's
  session so the caller's commit lands it. Keep that contract for the GitHub
  events: a connect that succeeded on GitHub must not be reported as failed
  because the audit insert did not.

### 4.2 Events the GitHub feature writes

| Action | Where | Actor | Metadata |
|---|---|---|---|
| `github_connected` | `install_callback`, after the upsert | state `u` claim | `installation_id`, `account_login`, `account_type`, `repository_selection`, `reconnected` (true when the row existed with a different installation id) |
| `github_disconnected` | `disconnect` | `ctx.user_id` | `installation_id`, `account_login` |

`tenant_id` is the state's `a` claim in the callback and `ctx.scope_id` in
disconnect. `log_audit_event` also logs the payload at INFO, which is what
2.3 asked for and now comes free.

`repository_linked` and `repository_unlinked` **stay in the project audit
log** (`record_event`, already wired) and are not duplicated here. Which
repository a project builds into is a project fact, and the project log is
where a reviewer of that project will look.

### 4.3 Permission and route

Add `audit:read` to `account_admin` only, beside `integrations:manage` in
1.1. Members and viewers do not see the log: it carries invitee emails, role
changes and who removed whom. Platform admins pass through the bypass.

Route in the auth module, next to the tenant user routes it reports on:

```
GET /um/tenants/{tenant_id}/audit-events?limit=50&before=<timestamp>&action=<name>
    require_permission("audit:read") + ensure_scope_access(tenant_id, ctx)
    WHERE tenant_id = ctx.scope_id      -- always, never from the path alone
    ORDER BY timestamp DESC, id DESC    -- keyset on `before`, like list_audit in studio/audit.py
```

Response rows: `id`, `action`, `actor` (`{id, name, email}` or null),
`target_type`, `target_id`, `metadata`, `timestamp`, plus `has_more` and
`next_before` in the envelope. `ip_address` is not returned to organisation
admins; the platform listing keeps it.

Build the statement in a pure function, `org_audit_query(scope_id, *,
before, action, limit)`, so the scope filter can be tested without a
database.

### 4.4 Page

- Route `/orgs/:orgId/audit`, component `features/orgs/OrgAuditPage.tsx`.
- "Audit log" `NavItem` after GitHub in the organisation menu, shown only
  when a new `canReadAudit` session flag holds (`MANAGE_ACCOUNT_ROLES`, so
  admins and, via `holds()`, platform admins).
- Platform admins reach it from a second `RowMenuItem` on
  Administration › Organisations, beside GitHub (2.1).
- `ListTable` with When / Who / Event / Detail, a `ListToolbar` action
  filter defaulting to All, and a **Load more** button driven by
  `next_before`. No search: the filter is the search.
- `features/orgs/auditEvents.ts` owns `describeEvent(action, metadata)`,
  one sentence per known action, British English, stating what happened
  and stopping:

| Action | Sentence |
|---|---|
| `github_connected` | Connected GitHub account **acme-org** (selected repositories) |
| `github_connected` with `reconnected` | Reconnected GitHub to **acme-org** |
| `github_disconnected` | Disconnected GitHub account **acme-org** |
| `invitation_created` | Invited jo@example.com as Member |
| `invitation_accepted` | Joined as Member |
| `invitation_revoked` | Revoked the invitation to jo@example.com |
| `tenant_user_role_updated` | Changed Jo Bloggs's role to Admin |
| `tenant_user_removed` | Removed Jo Bloggs |
| `tenant_updated` | Renamed the organisation to Acme |

An action the map does not know renders as its raw name in a
`.badge.muted` with the metadata collapsed behind it, so nothing written to
the table is invisible on the page.

### 4.5 Tests

```python
def test_org_audit_query_is_pinned_to_the_scope():
    sql = str(org_audit_query(SCOPE, before=None, action=None, limit=50).compile())
    assert "audit_events.tenant_id = " in sql

def test_github_connect_and_disconnect_are_audited():
    assert '"github_connected"' in inspect.getsource(install_callback)
    assert '"github_disconnected"' in inspect.getsource(disconnect)

def test_only_the_admin_reads_the_audit_log():
    assert "audit:read" in _permissions(ADMIN)
    assert "audit:read" not in _permissions(MEMBER)
    assert "audit:read" not in _permissions(VIEWER)
```

The first is the one that matters: it is the only thing standing between an
organisation admin and another organisation's log, because the table has no
RLS.

---

# Phase 5 — Infra

Nothing in Terraform or the task definition knows about GitHub yet. Every
environment that should show the Repository section needs its own GitHub
App, because the Setup URL is per App and must match the SPA origin.

### 5.1 One App per environment

Create at `https://github.com/organizations/<org>/settings/apps/new`, owned by
the Ferrous GitHub organisation:

| Setting | Staging | Prod |
|---|---|---|
| Name / slug | `ferrous-studio-staging` | `ferrous-studio` |
| Setup URL | `https://<staging domain>/api/studio/github/callback` | `https://<prod domain>/api/studio/github/callback` |
| Redirect on update | on | on |
| Request user authorization (OAuth) during installation | **on** (the callback depends on it) | on |
| Repository permissions | Contents: read & write, Metadata: read, Pull requests: read & write (see decisions) | same |
| Webhooks | inactive | inactive |
| Where can this App be installed | Any account | Any account |

Domains come from `app.config.json`; do not hardcode them anywhere else.
Generate a private key and a client secret for each.

### 5.2 Secrets

`infra/terraform/secrets.tf`, following the `anthropic_api_key` pattern (a
secret with no version, so the value never enters state):

```hcl
locals {
  github_secrets = ["GITHUB_APP_ID", "GITHUB_APP_SLUG", "GITHUB_APP_PRIVATE_KEY",
                    "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"]
}

resource "aws_secretsmanager_secret" "github" {
  for_each = { for pair in setproduct(local.envs, local.github_secrets) : "${pair[0]}/${pair[1]}" => pair }
  name     = "${local.product_name}/${each.value[0]}/${each.value[1]}"
}
```

`GITHUB_APP_ID` and `GITHUB_APP_SLUG` are not secrets, but keeping all five
together means one mechanism and one runbook entry. The execution role's
`read_secrets` policy in `iam.tf` already covers `${product}/*`.

Set the values by hand, once per environment:

```
aws secretsmanager put-secret-value --secret-id ferrous-studio/staging/GITHUB_APP_PRIVATE_KEY \
  --secret-string "$(base64 -w0 ferrous-studio-staging.private-key.pem)"
```

Base64 is the form `_pem` in `config.py` accepts and the one that survives
every secret store.

### 5.3 Task definition

`infra/ecs/taskdef.template.json` `secrets` array gains five entries shaped
like the `DATABASE_URL` one. `FRONTEND_URL` is already present and is what
`_return_to` uses. Add to `infra/docs/onboarding-runbook.md` under secrets.

Leave the values empty on an environment that should not offer GitHub: the
backend reports `configured: false` and the page says so.

### 5.4 Local

`backend/.env.local.example` already documents the App and the `:5173` Setup
URL gotcha. Add the write permissions from the decisions table to its
permission list.

---

# Phase 6 — Verify

Backend, from the repo root with the `.venv312` interpreter:

```
.venv312\Scripts\python -m pytest backend/tests/test_github_state.py backend/tests/test_github_link_state.py backend/tests/test_role_permissions.py backend/tests/test_lock_coverage.py
```

In the browser, via the `run-local` skill with a real GitHub App configured in
`backend/.env.local` (the callback cannot be mocked past `exchange_user_code`):

1. As an **admin**: Organisation › GitHub shows "not connected" and Connect.
   Connect, install on a test GitHub organisation with *selected*
   repositories, land back on Organisation › GitHub with "GitHub connected."
2. As a **member** (swap the `get_current_user` override): the page shows the
   connected account, no Connect or Disconnect; a project's Repository section
   shows the state but no Link. `POST /studio/github/connect` → 403.
3. As an admin: project details → Link repository → picker lists the selected
   repositories most-recently-pushed first → link → name, private badge,
   default branch and latest commit render. Rename the repository on GitHub,
   reload: the new name appears with no banner.
4. Remove the repository from the installation on GitHub: state `unreachable`
   with "The GitHub installation can no longer see owner/name."
5. Disconnect: drawer, confirm, page returns to "not connected"; the project's
   section reports `disconnected`. Reconnect: the link comes back to `ok`
   without relinking.
6. Lock the project version: Link/Change/Unlink remain available.
7. Start a connect, copy the install URL into a different browser profile,
   finish there: lands on `?github=failed` (nonce cookie missing).
8. As a **platform admin** (resolve the override to elliott@ferrouslabs.co.uk
   on `:8082`, per `admin-project-drawer-and-menu`): Administration ›
   Organisations › row menu › GitHub opens the page with Connect showing and
   the organisation's name as heading; disconnect and reconnect work; a
   project's Repository section offers Link. No organisation menu appears at
   any point.
9. Organisation › Audit log (admin) shows the connect from step 1, the
   disconnect and reconnect from step 5 with the reconnect labelled as such,
   and the earlier invitation and role events already in the table. As a
   member the menu item is absent and the route answers 403. Under a second
   organisation's scope, the first organisation's rows do not appear.

---

# Not in this plan

- **Pushing to the repository, reading branches, opening pull requests.** The
  client has no write call and the App token cache is read-shaped. Phase 5 of
  the go-live plan owns that, along with the per-organisation credential
  design agents need beyond the App (a Claude key per organisation).
- **Webhooks.** Nothing here needs to hear from GitHub; state is read live.
- **Several repositories per project**, or a repository shared across
  organisations. One `repo_id` per project row; if a monorepo split is ever
  needed it is a new column, not a change to this one.
- **A listing for project-level audit rows.** `record_event` already writes
  `repository_linked`, `version_created`, `locked` and friends with
  `wireframe_id` NULL, and no page shows them: the only reader is per
  wireframe. Worth a project-level audit page later; not this plan's.
