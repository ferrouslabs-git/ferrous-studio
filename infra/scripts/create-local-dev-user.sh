#!/usr/bin/env bash
# create-local-dev-user.sh -- seed one Cognito user in the STAGING pool so a
# fresh clone has a real login to start with (there is no local Cognito).
# Usage: ./create-local-dev-user.sh dev@example.com 'Someth1ng!'
set -euo pipefail

EMAIL="${1:?usage: create-local-dev-user.sh <email> <password>}"
PASSWORD="${2:?usage: create-local-dev-user.sh <email> <password>}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONFIG="$REPO_ROOT/app.config.json"
REGION=$(jq -r .aws_region "$CONFIG")

POOL_ID=$(cd "$REPO_ROOT/infra/terraform" && terraform output -json | jq -r .cognito.value.staging.user_pool_id)
if [ -z "$POOL_ID" ] || [ "$POOL_ID" = "null" ]; then
  echo "Could not find the staging Cognito pool -- run 'terraform apply' in infra/terraform first." >&2
  exit 1
fi

aws cognito-idp admin-create-user --region "$REGION" --user-pool-id "$POOL_ID" --username "$EMAIL" \
  --user-attributes Name=email,Value="$EMAIL" Name=email_verified,Value=true --message-action SUPPRESS >/dev/null
aws cognito-idp admin-set-user-password --region "$REGION" --user-pool-id "$POOL_ID" --username "$EMAIL" \
  --password "$PASSWORD" --permanent >/dev/null

echo "Created $EMAIL in the staging pool ($POOL_ID). Sign in with it locally."
