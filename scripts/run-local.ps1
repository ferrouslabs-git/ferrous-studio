# run-local.ps1 -- start the app locally on Postgres.
#   1. ensures the local Postgres container is up
#   2. applies any pending Alembic migrations
#   3. starts the FastAPI backend (serves the API at http://localhost:8080)
#
# Run `npm run dev` separately in frontend/app/web for the Vite dev server
# (proxies /api to this backend -- see frontend/app/web/vite.config.ts).
#
# Usage:  .\scripts\run-local.ps1
#
# Prereqs: Docker Desktop running, Python 3.12 venv at .\.venv312 with
# backend/requirements.txt installed, and backend/.env.local filled in from
# backend/.env.local.example (Cognito values come from
# 'terraform output cognito' -- auth always talks to the real
# STAGING pool, there is no local Cognito).

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$Py       = Join-Path $RepoRoot ".venv312\Scripts\python.exe"
$Backend  = Join-Path $RepoRoot "backend"

function Fail($msg) { Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }

if (-not (Test-Path $Py)) { Fail "Python env not found at $Py. Create it with: python -m venv .venv312 ; .\.venv312\Scripts\python.exe -m pip install -r backend\requirements.txt" }
if (-not (Test-Path (Join-Path $Backend ".env.local"))) { Fail "backend\.env.local not found. Copy backend\.env.local.example and fill it in first." }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Fail "docker not found on PATH (is Docker Desktop installed?)" }
docker info *> $null
if ($LASTEXITCODE -ne 0) { Fail "Docker does not appear to be running. Start Docker Desktop and retry." }

Write-Host "Postgres: starting (infra/local/docker-compose.yml)..." -ForegroundColor Cyan
Push-Location (Join-Path $RepoRoot "infra\local")
docker compose up -d
Pop-Location

Write-Host "Postgres: waiting for readiness..." -NoNewline
for ($i = 0; $i -lt 30; $i++) {
    docker exec webapp-template-local-db pg_isready -U app -d app_local *> $null
    if ($LASTEXITCODE -eq 0) { Write-Host " ready" -ForegroundColor Green; break }
    Start-Sleep -Seconds 1
    Write-Host "." -NoNewline
    if ($i -eq 29) { Fail "Postgres did not become ready in time" }
}

Push-Location $Backend
$env:PYTHONPATH = $Backend
Write-Host "Alembic: applying migrations..." -ForegroundColor Cyan
& $Py -m alembic upgrade head
if ($LASTEXITCODE -ne 0) { Pop-Location; Fail "alembic upgrade failed" }

Write-Host "`nStarting backend at http://localhost:8080  (Ctrl+C to stop)" -ForegroundColor Green
Write-Host "Sign-in goes against the STAGING Cognito pool -- see infra/scripts/create-local-dev-user.ps1`n" -ForegroundColor DarkGray
& $Py -m uvicorn app.main:app --host 0.0.0.0 --port 8080 --reload
Pop-Location
