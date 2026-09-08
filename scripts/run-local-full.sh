#!/usr/bin/env bash
# run-local-full.sh — start Postgres, backend and frontend together for local dev.
# Backend: http://localhost:8080  |  Frontend (Vite): http://localhost:5173
# Ctrl+C stops both the backend and frontend (Postgres container keeps running;
# stop it separately with: docker compose -f infra/local/docker-compose.yml down).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PY="$REPO_ROOT/.venv312/bin/python"
BACKEND="$REPO_ROOT/backend"
FRONTEND="$REPO_ROOT/frontend/app/web"

[ -x "$PY" ] || { echo "ERROR: Python env not found at $PY. Create it with: python3 -m venv .venv312 && .venv312/bin/pip install -r backend/requirements.txt" >&2; exit 1; }
[ -f "$BACKEND/.env.local" ] || { echo "ERROR: backend/.env.local not found. Copy backend/.env.local.example and fill it in first." >&2; exit 1; }
[ -f "$FRONTEND/.env.local" ] || { echo "ERROR: frontend/app/web/.env.local not found. Copy frontend/app/web/.env.local.example and fill it in first." >&2; exit 1; }
[ -d "$FRONTEND/node_modules" ] || { echo "ERROR: frontend deps not installed. Run: (cd frontend/app/web && npm install)" >&2; exit 1; }
command -v docker >/dev/null || { echo "ERROR: docker not found on PATH" >&2; exit 1; }
command -v npm >/dev/null || { echo "ERROR: npm not found on PATH" >&2; exit 1; }

echo "Postgres: starting (infra/local/docker-compose.yml)..."
(cd "$REPO_ROOT/infra/local" && docker compose up -d)

echo -n "Postgres: waiting for readiness..."
for i in $(seq 1 30); do
  if docker exec webapp-template-local-db pg_isready -U app -d app_local >/dev/null 2>&1; then echo " ready"; break; fi
  sleep 1; echo -n "."
  [ "$i" = "30" ] && { echo; echo "ERROR: Postgres did not become ready in time" >&2; exit 1; }
done

echo "Alembic: applying migrations..."
(cd "$BACKEND" && PYTHONPATH="$BACKEND" "$PY" -m alembic upgrade head)

BACKEND_PID=""
FRONTEND_PID=""
cleanup() {
  echo
  echo "Stopping..."
  [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null || true
  [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo
echo "Starting backend  at http://localhost:8080  (log prefix: [backend])"
(
  cd "$BACKEND"
  export PYTHONPATH="$BACKEND"
  "$PY" -m uvicorn app.main:app --host 0.0.0.0 --port 8080 --reload 2>&1 | sed -u 's/^/[backend]  /'
) &
BACKEND_PID=$!

echo "Starting frontend at http://localhost:5173  (log prefix: [frontend])"
(
  cd "$FRONTEND"
  npm run dev -- --host 2>&1 | sed -u 's/^/[frontend] /'
) &
FRONTEND_PID=$!

echo
echo "Both running. Sign-in goes against the STAGING Cognito pool. Press Ctrl+C to stop both."
wait "$BACKEND_PID" "$FRONTEND_PID"
