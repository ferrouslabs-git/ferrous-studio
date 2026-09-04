---
name: run-local
description: Launch Ferrous Studio locally (Postgres + FastAPI + Vite) and drive the real UI in a browser without a Cognito login. Use when asked to run/start the app, reproduce a bug in the running app, or verify a change end-to-end in the real UI rather than in tests.
---

# Run Ferrous Studio locally

Three processes, plus a fourth only when you need to drive the UI headlessly:

| Process | Port | Started by |
|---|---|---|
| Postgres (Docker) | **5442** | `infra/local/docker-compose.yml` |
| FastAPI backend | **8080** | uvicorn, from `backend/` |
| Vite dev server | **5173** | `npm run dev`, proxies `/api` → `127.0.0.1:8080` |
| Verify backend (Cognito bypassed) | **8081** | `verify_server.py` in this skill dir — only for browser driving |

`scripts/run-local.ps1` does the first two in one go, but see the alembic
gotcha below before trusting its migration step.

## Prerequisites

- Docker Desktop running.
- `.venv312` at the **repo root** (not under `backend/`). The system Pythons
  lack the app's deps — never use them.
- `backend/.env.local` (copy from `.env.local.example`; Cognito values come
  from `terraform output cognito`).
- `frontend/app/web/node_modules` installed.

## Launch

```bash
# 1. Postgres
cd infra/local && docker compose up -d
until docker exec webapp-template-local-db pg_isready -U app -d app_local >/dev/null 2>&1; do sleep 1; done

# 2. Migrations — MUST use the console script, see gotcha
cd backend && PYTHONPATH="$PWD" ../.venv312/Scripts/alembic.exe upgrade head

# 3. Backend — keep --reload, see "parallel sessions" below
cd backend && PYTHONPATH="$PWD" ../.venv312/Scripts/python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8080 --reload

# 4. Frontend
cd frontend/app/web && npm run dev
```

**Alembic gotcha:** `python -m alembic` fails with *"'alembic' is a package and
cannot be directly executed"* — the local `alembic/` migrations directory
shadows the installed package via `sys.path[0]`. Use `.venv312/Scripts/alembic.exe`.
`run-local.ps1` still uses `python -m alembic`; run migrations yourself first.

## Smoke-test the API

```bash
curl -s http://127.0.0.1:8080/api/health           # {"status":"ok",...,"env":"local"}
curl -s -o /dev/null -w "%{http_code}\n" \
     http://127.0.0.1:8080/api/studio/projects     # 401 unauthenticated — correct
```

Routes live under `/api/studio/...` and `/api/um/...`. `/api/projects` is a
404 — don't read that as a broken backend.

Start the long-running processes with the Bash tool's `run_in_background`
rather than `nohup ... &` — plain backgrounded shell jobs do not reliably
survive between turns and you will find them dead next time you look.

### Verifying without a browser

Against the verify server (:8081) every studio route needs **scope headers**,
which the frontend normally adds. Without them you get a bare `400`, which
looks like a broken endpoint but is not:

```bash
B=http://127.0.0.1:8081/api/studio/projects/<projectId>
H=(-H "X-Scope-Type: account" -H "X-Scope-ID: <orgId>")
curl -s "${H[@]}" "$B"                       # project detail
curl -s "${H[@]}" "$B/wireframes"            # wireframe list
```

`X-Scope-Type` must be **`account`** — `tenant` is rejected with a 400 naming
the valid value. (`X-Tenant-ID` alone also works, as an account-scope fallback.)
This is the quickest end-to-end check when the browser is unavailable.

## Driving the UI (no Cognito)

Local dev has **no auth bypass** — it authenticates against the real *staging*
Cognito pool, so a headless browser cannot sign in. Run a second backend with
only `get_current_user` overridden, and bridge the browser to it:

```bash
# from the repo root; needs no PYTHONPATH and leaves :8080 untouched
./.venv312/Scripts/python.exe .claude/skills/run-local/verify_server.py
curl -s http://127.0.0.1:8081/api/um/tenants/my   # expect Ferrous Labs Ltd, account_admin
```

Then in the Playwright MCP browser (or the dev-browser skill — same
`async (page) => {}` file works in both):

1. `browser_navigate` to `http://localhost:5173/`
2. `browser_run_code_unsafe` with `filename: .claude/skills/run-local/bridge.js`
   — rewrites every `/api/**` call to `:8081`. The MCP only reads files inside
   the repo root, so point at the skill dir, never the scratchpad.
   It also seeds the two auth keys the frontend gates on
   (`auth_access_token`, `auth_access_token_expires_at`) — any non-expired
   value works, since the verify backend ignores the token itself.
3. Navigate to an **org-scoped** URL (see below).

Verified cold-start: from cleared cookies/localStorage, this loads the studio
editor with zero failed API calls and zero console errors.

The override must be registered on **both** `app` and the mounted `api`
sub-app — `/api` is a separate FastAPI instance with its own overrides map, so
an override on the outer `app` alone silently does nothing.

## Route shape

Everything authenticated is org-scoped. `/projects` matches the `*` catch-all
and redirects to the landing page — which looks exactly like an auth failure
but isn't.

```
/orgs/:orgId/projects
/orgs/:orgId/projects/:projectId/{details,use-cases,personas,diagrams,wireframes,documents}
/orgs/:orgId/projects/:projectId/wireframes/:wireframeId[/preview|/audit]
```

## Live fixture (dev DB, 2026-09-04)

Query it rather than trusting these ids — rows get recreated:

```bash
docker exec webapp-template-local-db psql -U app -d app_local -c \
  "select p.id, p.name, w.id, w.name from projects p left join wireframes w on w.project_id=p.id;"
```

- User `elliott+studiotest@ferrouslabs.co.uk` is the **only** user with a
  membership (account_admin, "Ferrous Labs Ltd" `ab31713c-a737-467b-93c7-4d33b4970b2c`).
  `elliott@ferrouslabs.co.uk` has none → `/um/tenants/my` returns `[]` and the
  org picker dead-ends.
- Project "Invoice Approvals" `bcec6582-3071-4c4f-b35c-06a774da3163`, wireframes
  `fnAI`, `test`, `Approval queue`.

## Gotchas when driving

- **Uppercase is CSS.** Buttons/links use `text-transform: uppercase`, so
  `innerText()` gives "OPEN" while the DOM says "Open". Match case-insensitively
  (`getByRole('link', { name: /^open$/i })`) or locators time out.
- **No error boundary.** A render throw blanks the whole app — a white page is a
  component crash, so read the console before assuming a launch failure.
- Route closures live in the driving process. With the dev-browser skill or a
  `npx tsx` wrapper they die when the script exits; run navigate → click →
  assert in ONE script. Under the Playwright MCP they survive across tool calls.
- **A bounce to `/signin` with `401 /api/um/me` means the bridge is gone**, not
  that auth broke. The route registration lives in the Playwright server
  process, so it does NOT survive a restart of the stack, a new session, or
  `page.unroute('**/api/**')` — the call then falls through to the real `:8080`
  and 401s. Re-run `bridge.js`; it is idempotent, and re-registering over a
  live one is harmless (routes stack newest-first).
- The editor's outbox flushes ops ~2–4s after an edit; wait before asserting.
- Prefer read-only driving on the shared dev data. Preview mode
  (`/preview`) is guaranteed never to write — a good smoke path.
- The Playwright MCP writes `filename:` screenshots relative to the **repo
  root**; delete the strays afterwards.
- **"Browser is already in use"** means another session holds the shared Chrome
  profile. Don't fight it: either fall back to the dev-browser skill (its own
  server on :9222/:9223, same `async (page) => {}` file works), or verify via
  the curl recipe above.

## Parallel sessions share this database

Other agents/sessions develop against the same local Postgres, so the schema
and the code can both move under a running server. Two symptoms:

- **`asyncpg.InvalidCachedStatementError: cached statement plan is invalid`** —
  someone applied a migration that altered a table you had already queried.
  SQLAlchemy invalidates its prepared caches in response, so the *next* request
  succeeds and the server self-heals; the 500 you saw was a one-off, not a bug
  in your code.
- **Stale model code.** A server started before their code landed keeps serving
  the old models against the migrated DB. `--reload` avoids this; without it,
  restart the backends after `alembic upgrade head` reports new revisions.

Fixture rows are not stable either — wireframes and projects appear and vanish.
Re-query ids rather than reusing ones from notes, and don't treat a changed row
count as a regression.

## Restart

Kill by port, then re-run the launch steps. Don't assume Postgres is still up —
the container stops on its own (Docker Desktop restarts, machine sleep), and
when it does the backends stay "running" but every request fails, so always
re-check it and re-apply migrations.

```bash
for P in 8080 8081 5173; do
  PID=$(netstat -ano | grep ":$P " | grep LISTENING | awk '{print $5}' | head -1)
  [ -n "$PID" ] && taskkill //PID "$PID" //F
done
docker exec webapp-template-local-db pg_isready -U app -d app_local \
  || (cd infra/local && docker compose up -d)
```

Then relaunch, and **re-run `bridge.js`** before driving the browser again.

## Shutdown

```bash
# kill uvicorn/vite by port (as above), then
cd infra/local && docker compose stop
```
