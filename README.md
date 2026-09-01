# Ferrous Studio

A low-fidelity analysis and wireframing tool designed for speed. Product
owners and designers describe a project — its rationale, use cases,
personas, UML diagrams, wireframes and reference documents — then
export the result as a structured payload an LLM can consume to generate code.

A **project** opens in its own browser tab with its own menu:

| Section | What it holds | Where |
|---|---|---|
| Project details | Name, description, rationale | `projects` |
| Personas | Name, role, primary interface, traits, jobs to be done, pain points, feelings | `personas` |
| Diagrams | Free-form UML (maxGraph editor, `frontend/app/web/src/features/diagrams/`), saved whole with a version check | `project_diagrams` |
| Wireframes | Each wireframe is its own studio document (pages, frames, op batches, versions), tagged with personas and an interface type | `wireframes`, `project_pages`, … |
| Documents | Uploaded files, browser → S3 via presigned URLs | `project_documents` + the S3 bucket |

- Product vision and design philosophy: [`docs/product-vision.md`](docs/product-vision.md)
- Component and feature requirements (PRD): [`requirements.md`](requirements.md)

## Layout

| Path | What it is |
|---|---|
| `backend/` | FastAPI + Postgres (SQLAlchemy 2 / Alembic). `app/auth/` is the reusable Cognito auth, tenancy and RBAC module — treat it as a library. `app/studio/` is the Ferrous domain — one module per resource (`projects.py`, `wireframes.py`, `personas.py`, `diagrams.py`, `documents.py`) mounted by `router.py`; `storage.py` is the only place that calls S3. |
| `frontend/app/web/` | React 18 + Vite + TypeScript SPA. Landing page, org/project management, and the studio canvas. |
| `infra/` | Terraform for the shared AWS estate (Cognito pools, RDS roles/databases, ECR, IAM, target groups) plus manual deploy scripts. Read `infra/docs/onboarding-runbook.md` before touching AWS by hand. |
| `legacy/` | The original zero-dependency vanilla builder (`mockup.html` + `js/*.global.js`). Reference source for the React port; opens directly from the filesystem. |
| `app.config.json` | Single source of truth for the product name, port and domain. Terraform and the deploy scripts read it — do not hardcode the product name elsewhere. |

## Roles

Two tiers, config-driven in `backend/app/auth/auth_config.yaml`. An
organisation owns its projects directly — there is no workspace layer.

| Tier | Role | Can |
|---|---|---|
| Platform | `super_admin` | Create and manage organisations, manage users |
| Organisation | `account_admin` | Everything below, plus manage members and invitations |
| Organisation | `account_member` | Create, edit and delete projects |
| Organisation | `account_viewer` | Read every project in the organisation |

Organisations are invite-only: a super admin creates the organisation and
invites its first admin, who invites everyone else.

Inviting someone pre-creates their Cognito user (Cognito's own email is
suppressed) and sends our own email with a `/invite/<token>` link. Opening it
shows a set-password page with the address prefilled; submitting calls
`POST /api/um/invites/complete`, which sets the password, signs the user in
server-side (`ADMIN_USER_PASSWORD_AUTH`), creates the local user row and
accepts the invitation in one step, so they land in the organisation already
signed in. An address that already has a password is asked to sign in through
the hosted UI instead and is brought back to the link to accept.

## Local development

There is no local Cognito — local dev authenticates against the real
**staging** user pool.

1. `cd infra/terraform && terraform init && terraform apply` (once per app).
2. Copy `backend/.env.local.example` → `backend/.env.local` and
   `frontend/app/web/.env.local.example` → `frontend/app/web/.env.local`,
   filling the Cognito values from `terraform output cognito` (`staging`).
3. `docker compose -f infra/local/docker-compose.yml up -d` for Postgres.
4. `infra/scripts/create-local-dev-user.ps1` (or `.sh`) for a login.
5. `python backend/scripts/bootstrap_admin.py <email>` to make that login the
   first super admin (refuses to run if one already exists).
6. `.\scripts\run-local.ps1` (backend) and `npm run dev` in
   `frontend/app/web` (frontend).
7. Optional features, configured in `backend/.env.local`:
   - **Documents** need `DOCUMENTS_BUCKET` (local dev uses the real staging
     bucket `terraform output documents_bucket` creates; the AWS profile the
     backend runs under needs S3 access to it). Unset = the section reports
     "not configured".
   Note that `uvicorn --reload` does not re-read `.env.local`; `touch
   backend/app/config.py` after changing it.

> **Row-level security is bypassed locally.** The Docker Postgres user (`app`)
> is a superuser, and superusers skip RLS regardless of `FORCE ROW LEVEL
> SECURITY`. The RDS app roles are plain `LOGIN` roles, so RLS is live in
> staging and prod. To exercise the policies locally, `SET ROLE` to a
> non-superuser role that has been granted the tables.

## Deploying

No CI/CD — deploy manually, matching the branch you're on:
`infra/scripts/deploy-staging.ps1` on `staging`, `infra/scripts/deploy-prod.ps1`
for prod. Both are idempotent.

## Conventions

- British English in all user-visible text and comments (see `CLAUDE.md`).
- Every studio query is filtered by organisation (`account_id`) in Python
  **and** protected by Postgres row-level security. Both layers, always.

## Tests

- Backend (op applier, ordering keys): `.venv312\Scripts\python -m pytest backend`
  (dev deps: `pip install -r backend/requirements-dev.txt`).
- Frontend (sync outbox, op application, diagram model derivation): `npm test` in `frontend/app/web`.

Neither suite talks to Postgres or S3; the browser flows (new-tab
project shell, wireframe studio, diagram autosave/409, uploads)
are verified by hand against the dev servers.
