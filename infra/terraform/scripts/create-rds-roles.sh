#!/usr/bin/env bash
# create-rds-roles.sh -- run by Terraform's null_resource.rds_bootstrap
# (see ../rds.tf) via a local-exec provisioner. Not meant to be run directly,
# though it's safe to: it's idempotent (CREATE ROLE/DATABASE guarded by
# existence checks).
#
# The RDS instance is private -- this can't run from a dev laptop, so it
# executes as a one-off command inside the pre-existing `pg-admin` Fargate
# task (a postgres client with master credentials injected), the same
# technique the processmapper repo's runbook uses.
#
# Required env vars (set by rds.tf's `environment` block): PRODUCT, REGION,
# CLUSTER, SUBNETS, SG, STAGING_PW, PROD_PW.
set -euo pipefail

MASTER_USER=$(aws secretsmanager get-secret-value --region "$REGION" \
  --secret-id "ferrous-internal-tools-database/master" --query SecretString --output text \
  | sed -n 's/.*"username"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')

if [ -z "$MASTER_USER" ]; then
  echo "Could not read the RDS master username from Secrets Manager." >&2
  exit 1
fi

SQL=$(cat <<SQLEOF
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${PRODUCT}_staging_app') THEN
    CREATE ROLE "${PRODUCT}_staging_app" LOGIN PASSWORD '$STAGING_PW' CONNECTION LIMIT 20;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${PRODUCT}_prod_app') THEN
    CREATE ROLE "${PRODUCT}_prod_app" LOGIN PASSWORD '$PROD_PW' CONNECTION LIMIT 20;
  END IF;
END
\$\$;
GRANT "${PRODUCT}_staging_app" TO "$MASTER_USER";
GRANT "${PRODUCT}_prod_app" TO "$MASTER_USER";
SELECT 'CREATE DATABASE "${PRODUCT}_staging" OWNER "${PRODUCT}_staging_app"'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${PRODUCT}_staging')\gexec
SELECT 'CREATE DATABASE "${PRODUCT}_prod" OWNER "${PRODUCT}_prod_app"'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${PRODUCT}_prod')\gexec
REVOKE CONNECT ON DATABASE "${PRODUCT}_staging" FROM PUBLIC;
REVOKE CONNECT ON DATABASE "${PRODUCT}_prod" FROM PUBLIC;
SQLEOF
)

B64=$(printf '%s' "$SQL" | base64 -w0 2>/dev/null || printf '%s' "$SQL" | base64)
SHCMD="echo $B64 | base64 -d | PGPASSWORD=\$MASTER_PW psql -h \$PGHOST -U \$MASTER_USER -d postgres -v ON_ERROR_STOP=1"

OVERRIDES_FILE=$(mktemp)
printf '{"containerOverrides":[{"name":"pgadmin","command":["sh","-c","%s"]}]}' \
  "$(printf '%s' "$SHCMD" | sed 's/\\/\\\\/g; s/"/\\"/g')" > "$OVERRIDES_FILE"

# On Windows, `aws` is a native (non-MSYS) executable -- git-bash's automatic
# POSIX-to-Windows path translation for subprocess args doesn't reliably
# catch a path embedded in a `file://...` URI, so pass a cygpath-converted
# Windows path when running under git-bash/MSYS (cygpath is a no-op-absent
# elsewhere, i.e. real Linux/macOS, where the POSIX path is already correct).
if command -v cygpath >/dev/null 2>&1; then
  OVERRIDES_FILE_ARG="$(cygpath -w "$OVERRIDES_FILE")"
else
  OVERRIDES_FILE_ARG="$OVERRIDES_FILE"
fi

TASK_ARN=$(aws ecs run-task --region "$REGION" --cluster "$CLUSTER" --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SG],assignPublicIp=ENABLED}" \
  --task-definition pg-admin --overrides "file://$OVERRIDES_FILE_ARG" \
  --query 'tasks[0].taskArn' --output text)
rm -f "$OVERRIDES_FILE"

if [ -z "$TASK_ARN" ] || [ "$TASK_ARN" = "None" ]; then
  echo "Failed to start the pg-admin task. Does the 'pg-admin' task definition exist in this account?" >&2
  echo "See infra/docs/onboarding-runbook.md step 1." >&2
  exit 1
fi

echo "pg-admin task $TASK_ARN running..."
aws ecs wait tasks-stopped --region "$REGION" --cluster "$CLUSTER" --tasks "$TASK_ARN"
EXIT_CODE=$(aws ecs describe-tasks --region "$REGION" --cluster "$CLUSTER" --tasks "$TASK_ARN" \
  --query 'tasks[0].containers[0].exitCode' --output text)
if [ "$EXIT_CODE" != "0" ]; then
  echo "pg-admin SQL failed (exit $EXIT_CODE) -- see CloudWatch log group /ecs/pg-admin" >&2
  exit 1
fi
echo "RDS roles + databases ready for $PRODUCT."
