#!/usr/bin/env bash
# create-super-admin.sh — bootstrap the very first login for a fresh clone.
#
# There is no signup form and no API route that grants the first super_admin
# (see backend/scripts/bootstrap_admin.py's docstring) — this script does the
# three manual steps by hand:
#   1. Create a permanent-password user directly in the STAGING Cognito pool
#      (admin-create-user + admin-set-user-password; skips the invite email
#      since there's nobody yet to send it).
#   2. Log that user in against the running backend (POST /custom/login) and
#      sync them into Postgres (POST /sync) — this is exactly what the
#      browser does on first sign-in, just from curl instead of the SPA.
#   3. Run bootstrap_admin.py to promote that Postgres user to super_admin.
#      It refuses if a super_admin already exists, so this script is only
#      useful once per environment.
#
# Requires: backend/.env.local filled in, the backend already running
# (./scripts/run-local-full.sh or ./scripts/run-local.sh), and the AWS
# profile in backend/.env.local (AWS_PROFILE) able to call
# cognito-idp:AdminCreateUser/AdminSetUserPassword on that pool.
#
# Usage: ./scripts/create-super-admin.sh you@example.com ['Some strong password']
# If the password is omitted, a random one is generated and printed at the end.
set -euo pipefail

EMAIL="${1:?usage: create-super-admin.sh <email> [password]}"
PASSWORD="${2:-}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$REPO_ROOT/backend"
ENV_FILE="$BACKEND/.env.local"
PY="$REPO_ROOT/.venv312/bin/python"
BACKEND_URL="${BACKEND_URL:-http://localhost:8080}"

[ -f "$ENV_FILE" ] || { echo "ERROR: $ENV_FILE not found. Copy backend/.env.local.example and fill it in first." >&2; exit 1; }
[ -x "$PY" ] || { echo "ERROR: Python env not found at $PY." >&2; exit 1; }
command -v aws >/dev/null || { echo "ERROR: aws CLI not found on PATH" >&2; exit 1; }
command -v jq >/dev/null || { echo "ERROR: jq not found on PATH" >&2; exit 1; }

# Pull region/pool/profile straight from the same .env.local the backend reads,
# so this never drifts from what the app is actually configured against.
env_val() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-; }
REGION="$(env_val COGNITO_REGION)"
POOL_ID="$(env_val COGNITO_USER_POOL_ID)"
AWS_PROFILE_NAME="$(env_val AWS_PROFILE)"
[ -n "$REGION" ] && [ -n "$POOL_ID" ] || { echo "ERROR: COGNITO_REGION / COGNITO_USER_POOL_ID missing from $ENV_FILE" >&2; exit 1; }

AWS_ARGS=(--region "$REGION")
[ -n "$AWS_PROFILE_NAME" ] && AWS_ARGS+=(--profile "$AWS_PROFILE_NAME")

if [ -z "$PASSWORD" ]; then
  # Cognito's default password policy wants upper/lower/digit/symbol; this shape satisfies it.
  PASSWORD="$(openssl rand -base64 18 | tr -d '=+/')Aa1!"
  GENERATED=1
else
  GENERATED=0
fi

echo "Checking backend at $BACKEND_URL..."
curl -sf -o /dev/null "$BACKEND_URL/docs" || {
  echo "ERROR: backend is not responding at $BACKEND_URL. Start it first (./scripts/run-local-full.sh)." >&2
  exit 1
}

echo "Cognito: creating user $EMAIL in pool $POOL_ID..."
if aws "${AWS_ARGS[@]}" cognito-idp admin-get-user --user-pool-id "$POOL_ID" --username "$EMAIL" >/dev/null 2>&1; then
  echo "  user already exists in Cognito, reusing it and resetting the password."
else
  aws "${AWS_ARGS[@]}" cognito-idp admin-create-user \
    --user-pool-id "$POOL_ID" --username "$EMAIL" \
    --user-attributes Name=email,Value="$EMAIL" Name=email_verified,Value=true \
    --message-action SUPPRESS >/dev/null
fi
aws "${AWS_ARGS[@]}" cognito-idp admin-set-user-password \
  --user-pool-id "$POOL_ID" --username "$EMAIL" --password "$PASSWORD" --permanent >/dev/null

# Plain curl (no -f): an HTTP error still returns a body we want to show,
# rather than curl failing silently and set -e killing the script with no
# explanation.
http_post() {
  local url="$1" data="$2" auth_header="${3:-}"
  local args=(-s -w '\n%{http_code}' -X POST "$url" -H "Content-Type: application/json")
  [ -n "$auth_header" ] && args+=(-H "Authorization: $auth_header")
  [ -n "$data" ] && args+=(-d "$data")
  curl "${args[@]}"
}

echo "Backend: signing in as $EMAIL..."
RAW="$(http_post "$BACKEND_URL/api/um/custom/login" "$(jq -n --arg email "$EMAIL" --arg password "$PASSWORD" '{email:$email,password:$password}')")"
LOGIN_STATUS="$(echo "$RAW" | tail -1)"
LOGIN_RESPONSE="$(echo "$RAW" | sed '$d')"
[ "$LOGIN_STATUS" = "200" ] || { echo "ERROR: login failed (HTTP $LOGIN_STATUS): $LOGIN_RESPONSE" >&2; exit 1; }
# /sync needs the id_token, not the access_token: only the id_token carries the
# email claim (see frontend/app/web/src/core/auth.ts's completeSignIn, which
# does the same thing) -- an access_token here fails with 400 "Token missing
# email claim for user provisioning".
ID_TOKEN="$(echo "$LOGIN_RESPONSE" | jq -r '.id_token // empty')"
[ -n "$ID_TOKEN" ] || { echo "ERROR: login did not return an id token: $LOGIN_RESPONSE" >&2; exit 1; }

echo "Backend: syncing user into Postgres..."
RAW="$(http_post "$BACKEND_URL/api/um/sync" "" "Bearer $ID_TOKEN")"
SYNC_STATUS="$(echo "$RAW" | tail -1)"
SYNC_RESPONSE="$(echo "$RAW" | sed '$d')"
[ "$SYNC_STATUS" = "200" ] || { echo "ERROR: sync failed (HTTP $SYNC_STATUS): $SYNC_RESPONSE" >&2; exit 1; }
echo "$SYNC_RESPONSE" | jq '{user_id,email,is_platform_admin}'

echo "Postgres: promoting $EMAIL to super_admin..."
(cd "$BACKEND" && PYTHONPATH="$BACKEND" "$PY" scripts/bootstrap_admin.py "$EMAIL")

echo
echo "Done. Sign in at the frontend with:"
echo "  Email:    $EMAIL"
if [ "$GENERATED" = 1 ]; then
  echo "  Password: $PASSWORD   (generated — save it, it is not stored anywhere else)"
else
  echo "  Password: (the one you passed in)"
fi
