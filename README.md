# Ferrous Studio

A low-fidelity wireframing tool designed for speed. Product owners and
designers define screen structure, component configuration and
engineer-facing annotations, then export the result as a structured payload
an LLM can consume to generate code.

- Product vision and design philosophy: [`docs/product-vision.md`](docs/product-vision.md)
- Component and feature requirements (PRD): [`requirements.md`](requirements.md)

## Layout

| Path | What it is |
|---|---|
| `backend/` | FastAPI + Postgres (SQLAlchemy 2 / Alembic). `app/auth/` is the reusable Cognito auth, tenancy and RBAC module — treat it as a library. `app/studio/` is the Ferrous domain (projects, pages, ops). |
| `frontend/app/web/` | React 18 + Vite + TypeScript SPA. Landing page, org/project management, and the studio canvas. |
| `infra/` | Terraform for the shared AWS estate (Cognito pools, RDS roles/databases, ECR, IAM, target groups) plus manual deploy scripts. Read `infra/docs/onboarding-runbook.md` before touching AWS by hand. |
| `legacy/` | The original zero-dependency vanilla builder (`mockup.html` + `js/*.global.js`). Reference source for the React port; opens directly from the filesystem. |
| `app.config.json` | Single source of truth for the product name, port and domain. Terraform and the deploy scripts read it — do not hardcode the product name elsewhere. |

## Roles

Three tiers, config-driven in `backend/app/auth/auth_config.yaml`:

| Tier | Role | Can |
|---|---|---|
| Platform | `super_admin` | Create and manage organisations, manage users |
| Organisation | `account_owner`, `account_admin`, `account_member` | Create workspaces, invite members |
| Workspace | `space_admin`, `space_member`, `space_viewer` | Create/edit projects; viewers read only |

Organisations are invite-only: a super admin creates the organisation and
invites its owner, who invites everyone else.

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

## Deploying

No CI/CD — deploy manually, matching the branch you're on:
`infra/scripts/deploy-staging.ps1` on `staging`, `infra/scripts/deploy-prod.ps1`
for prod. Both are idempotent.

## Conventions

- British English in all user-visible text and comments (see `CLAUDE.md`).
- Every studio query is filtered by workspace in Python **and** protected by
  Postgres row-level security. Both layers, always.

## Tests

- Backend (op applier and other pure logic): `.venv312\Scripts\python -m pytest backend`
  (dev deps: `pip install -r backend/requirements-dev.txt`).
- Frontend (sync outbox, op application): `npm test` in `frontend/app/web`.
