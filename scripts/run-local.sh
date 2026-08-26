#!/usr/bin/env bash
# run-local.sh — start the app locally on Postgres. See run-local.ps1's header
# comment for prereqs and details.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PY="$REPO_ROOT/.venv312/bin/python"
BACKEND="$REPO_ROOT/backend"

[ -x "$PY" ] || { echo "ERROR: Python env not found at $PY. Create it with: python3 -m venv .venv312 && .venv312/bin/pip install -r backend/requirements.txt" >&2; exit 1; }
[ -f "$BACKEND/.env.local" ] || { echo "ERROR: backend/.env.local not found. Copy backend/.env.local.example and fill it in first." >&2; exit 1; }
command -v docker >/dev/null || { echo "ERROR: docker not found on PATH" >&2; exit 1; }

echo "Postgres: starting (infra/local/docker-compose.yml)..."
(cd "$REPO_ROOT/infra/local" && docker compose up -d)

echo -n "Postgres: waiting for readiness..."
for i in $(seq 1 30); do
  if docker exec webapp-template-local-db pg_isready -U app -d app_local >/dev/null 2>&1; then echo " ready"; break; fi
  sleep 1; echo -n "."
  [ "$i" = "30" ] && { echo; echo "ERROR: Postgres did not become ready in time" >&2; exit 1; }
done

cd "$BACKEND"
export PYTHONPATH="$BACKEND"
echo "Alembic: applying migrations..."
"$PY" -m alembic upgrade head

echo
echo "Starting backend at http://localhost:8080  (Ctrl+C to stop)"
echo "Sign-in goes against the STAGING Cognito pool — see infra/scripts/create-local-dev-user.sh"
echo
"$PY" -m uvicorn app.main:app --host 0.0.0.0 --port 8080 --reload
