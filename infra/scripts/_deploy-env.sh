#!/usr/bin/env bash
# _deploy-env.sh -- shared implementation for deploy-staging.sh / deploy-prod.sh.
# Not meant to be run directly. Usage: _deploy-env.sh <staging|prod>
set -euo pipefail

ENV_NAME="${1:?usage: _deploy-env.sh <staging|prod>}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TERRAFORM_DIR="$REPO_ROOT/infra/terraform"
CONFIG="$REPO_ROOT/app.config.json"

PRODUCT=$(jq -r .product_name "$CONFIG")
REGION=$(jq -r .aws_region "$CONFIG")
CONTAINER_PORT=$(jq -r .container_port "$CONFIG")
SUBNETS=$(jq -r '.shared_infra.subnets | join(",")' "$CONFIG")
ECS_CLUSTER=$(jq -r .shared_infra.ecs_cluster "$CONFIG")
EXEC_ROLE_ARN=$(jq -r .shared_infra.ecs_execution_role_arn "$CONFIG")
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

echo "== Deploying '$PRODUCT' to $ENV_NAME ($REGION) =="

# ── Pull what `terraform apply` created (infra/terraform) ──
TF_OUT=$(cd "$TERRAFORM_DIR" && terraform output -json)
if [ -z "$TF_OUT" ] || [ "$TF_OUT" = "{}" ]; then
  echo "No Terraform outputs found -- run 'terraform apply' in infra/terraform first (see README.md)." >&2
  exit 1
fi
SG_ID=$(echo "$TF_OUT" | jq -r .security_group_id.value)
TG_ARN=$(echo "$TF_OUT" | jq -r --arg env "$ENV_NAME" '.target_group_arns.value[$env]')
TASK_ROLE_ARN=$(echo "$TF_OUT" | jq -r .task_role_arn.value)
REPO_URI=$(echo "$TF_OUT" | jq -r .ecr_repository_url.value)
APP_PUBLIC_URL=$(echo "$TF_OUT" | jq -r --arg env "$ENV_NAME" '.app_public_url.value[$env]')
POOL_ID=$(echo "$TF_OUT" | jq -r --arg env "$ENV_NAME" '.cognito.value[$env].user_pool_id')
CLIENT_ID=$(echo "$TF_OUT" | jq -r --arg env "$ENV_NAME" '.cognito.value[$env].client_id')
COGNITO_DOMAIN=$(echo "$TF_OUT" | jq -r --arg env "$ENV_NAME" '.cognito.value[$env].domain')
DOCUMENTS_BUCKET=$(echo "$TF_OUT" | jq -r --arg env "$ENV_NAME" '.documents_bucket.value[$env]')
SES_SENDER_EMAIL=$(jq -r .email.sender "$REPO_ROOT/app.config.json")
EMAIL_FROM_NAME=$(jq -r .email.from_name "$REPO_ROOT/app.config.json")
EMAIL_LEGAL=$(jq -r .email.legal "$REPO_ROOT/app.config.json")
PLATFORM_ADMIN_EMAILS=$(jq -r '.platform_admin_emails // ""' "$REPO_ROOT/app.config.json")
# CloudOps admin pages: blank means the app default (on in prod, off elsewhere). `CLOUDOPS_ENABLED=true deploy-staging.sh` turns them on for a test.
CLOUDOPS_ENABLED="${CLOUDOPS_ENABLED:-}"

# ── 1. Build + push image ──
echo; echo "[1/5] Build + push :$ENV_NAME image"
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"
docker build -t "$PRODUCT:$ENV_NAME" \
  --build-arg VITE_COGNITO_DOMAIN="$COGNITO_DOMAIN" \
  --build-arg VITE_COGNITO_APP_CLIENT_ID="$CLIENT_ID" \
  "$REPO_ROOT"
docker tag "$PRODUCT:$ENV_NAME" "$REPO_URI:$ENV_NAME"
docker push "$REPO_URI:$ENV_NAME"

# ── 2. Render + register task definition ──
echo; echo "[2/5] Register task definition"
mkdir -p "$REPO_ROOT/infra/ecs/generated"
RENDERED="$REPO_ROOT/infra/ecs/generated/$PRODUCT-$ENV_NAME.taskdef.json"
sed \
  -e "s#{{PRODUCT_NAME}}#$PRODUCT#g" \
  -e "s#{{ENV}}#$ENV_NAME#g" \
  -e "s#{{CONTAINER_PORT}}#$CONTAINER_PORT#g" \
  -e "s#{{IMAGE}}#$REPO_URI:$ENV_NAME#g" \
  -e "s#{{EXECUTION_ROLE_ARN}}#$EXEC_ROLE_ARN#g" \
  -e "s#{{TASK_ROLE_ARN}}#$TASK_ROLE_ARN#g" \
  -e "s#{{AWS_REGION}}#$REGION#g" \
  -e "s#{{ACCOUNT_ID}}#$ACCOUNT_ID#g" \
  -e "s#{{COGNITO_USER_POOL_ID}}#$POOL_ID#g" \
  -e "s#{{COGNITO_CLIENT_ID}}#$CLIENT_ID#g" \
  -e "s#{{COGNITO_DOMAIN}}#$COGNITO_DOMAIN#g" \
  -e "s#{{APP_PUBLIC_URL}}#$APP_PUBLIC_URL#g" \
  -e "s#{{SES_SENDER_EMAIL}}#$SES_SENDER_EMAIL#g" \
  -e "s#{{EMAIL_FROM_NAME}}#$EMAIL_FROM_NAME#g" \
  -e "s#{{EMAIL_LEGAL}}#$EMAIL_LEGAL#g" \
  -e "s#{{DOCUMENTS_BUCKET}}#$DOCUMENTS_BUCKET#g" \
  -e "s#{{PLATFORM_ADMIN_EMAILS}}#$PLATFORM_ADMIN_EMAILS#g" \
  -e "s#{{CLOUDOPS_ENABLED}}#$CLOUDOPS_ENABLED#g" \
  "$REPO_ROOT/infra/ecs/taskdef.template.json" > "$RENDERED"
# Optional secrets: ECS will not start a task whose secret parameter is
# missing, so one not yet created in this environment is left out (the app
# runs without that feature) rather than breaking the deploy.
for OPTIONAL in GOOGLE_SERVICE_ACCOUNT_JSON; do
  PARAM="/$PRODUCT/$ENV_NAME/$OPTIONAL"
  # MSYS_NO_PATHCONV: Git Bash on Windows would rewrite the leading / of the name into a Windows path.
  FOUND=$(MSYS_NO_PATHCONV=1 aws ssm describe-parameters --region "$REGION" --parameter-filters "Key=Name,Values=$PARAM" --query "length(Parameters)" --output text)
  if [ "$FOUND" != "1" ]; then
    echo "  $PARAM not set -- deploying without it"
    sed -i.bak "/\"$OPTIONAL\"/d" "$RENDERED" && rm -f "$RENDERED.bak"
  fi
done
aws ecs register-task-definition --region "$REGION" --cli-input-json "file://$RENDERED" >/dev/null
echo "  registered $PRODUCT-$ENV_NAME"

# ── 3. Run migrations once ──
echo; echo "[3/5] Run Alembic migrations"
NET_CONFIG="awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SG_ID],assignPublicIp=ENABLED}"
OVERRIDES=$(jq -n --arg name "$PRODUCT" '{containerOverrides:[{name:$name,command:["sh","-c","cd /workspace/backend && alembic upgrade head"]}]}')
TASK_ARN=$(aws ecs run-task --region "$REGION" --cluster "$ECS_CLUSTER" --launch-type FARGATE \
  --network-configuration "$NET_CONFIG" --task-definition "$PRODUCT-$ENV_NAME" --overrides "$OVERRIDES" \
  --query "tasks[0].taskArn" --output text)
echo "  migration task $TASK_ARN running..."
aws ecs wait tasks-stopped --region "$REGION" --cluster "$ECS_CLUSTER" --tasks "$TASK_ARN"
EXIT_CODE=$(aws ecs describe-tasks --region "$REGION" --cluster "$ECS_CLUSTER" --tasks "$TASK_ARN" --query "tasks[0].containers[0].exitCode" --output text)
if [ "$EXIT_CODE" != "0" ]; then
  echo "  FAILED (exit $EXIT_CODE) -- see CloudWatch /ecs/$PRODUCT-$ENV_NAME" >&2
  exit 1
fi
echo "  ok"

# ── 4. Create or update the service ──
echo; echo "[4/5] ECS service"
SERVICE_NAME="$PRODUCT-$ENV_NAME"
EXISTING=$(aws ecs describe-services --region "$REGION" --cluster "$ECS_CLUSTER" --services "$SERVICE_NAME" --query "services[?status=='ACTIVE'] | [0]" --output json)
if [ "$EXISTING" != "null" ]; then
  # A sleeping service (CloudOps auto-wake, staging only) has its listener
  # rules parked on the waker, which leaves this target group with no load
  # balancer -- and ECS rejects update-service for that. A visit to the app
  # makes the waker scale the service up and hand the rules back; wait for
  # that before deploying.
  tg_lbs() {
    aws elbv2 describe-target-groups --region "$REGION" --target-group-arns "$TG_ARN" \
      --query "TargetGroups[0].LoadBalancerArns | length(@)" --output text
  }
  if [ "$(tg_lbs)" = "0" ]; then
    printf "  service is asleep -- waking it via %s ..." "$APP_PUBLIC_URL"
    AWAKE=0
    for i in $(seq 1 40); do
      # The waker answers 503 "starting up" until the app is back.
      curl -s -o /dev/null --max-time 15 -H "Accept: text/html" -A "Mozilla/5.0 (deploy script)" "$APP_PUBLIC_URL" || true
      if [ "$(tg_lbs)" != "0" ]; then AWAKE=1; break; fi
      sleep 15
    done
    if [ "$AWAKE" != "1" ]; then
      echo; echo "service did not wake within 10 minutes -- check the CloudOps auto-wake function" >&2
      exit 1
    fi
    echo " awake"
  fi
  DEPLOYMENT_ID=$(aws ecs update-service --region "$REGION" --cluster "$ECS_CLUSTER" --service "$SERVICE_NAME" \
    --task-definition "$PRODUCT-$ENV_NAME" --force-new-deployment \
    --propagate-tags SERVICE --enable-ecs-managed-tags \
    --query "service.deployments[?status=='PRIMARY'].id | [0]" --output text)
  echo "  updated existing service (forced new deployment $DEPLOYMENT_ID)"
else
  DEPLOYMENT_ID=$(aws ecs create-service --region "$REGION" --cluster "$ECS_CLUSTER" \
    --service-name "$SERVICE_NAME" --task-definition "$PRODUCT-$ENV_NAME" \
    --desired-count 1 --launch-type FARGATE \
    --network-configuration "$NET_CONFIG" \
    --load-balancers "targetGroupArn=$TG_ARN,containerName=$PRODUCT,containerPort=$CONTAINER_PORT" \
    --health-check-grace-period-seconds 60 \
    --propagate-tags SERVICE --enable-ecs-managed-tags \
    --tags "key=Product,value=$PRODUCT" "key=Environment,value=$ENV_NAME" "key=ManagedBy,value=deploy-script" \
    --query "service.deployments[?status=='PRIMARY'].id | [0]" --output text)
  echo "  created new service"
fi

# ── 5. Wait for the new deployment to roll out ──
#
# Waits on the SERVICE's primary deployment, not on target health. Target
# health answers "is something healthy behind this target group", and during a
# rolling deploy that something is the OLD task -- still serving, still
# healthy, still running the previous image. Polling it reported "deploy
# succeeded" while the new task was pending, so the next request hit the old
# code and the deploy looked like it had silently done nothing. rolloutState
# is the only signal that means what this step claims -- and only for the
# deployment step 4 started (by id): the service's PRIMARY deployment can
# still be the previous one, already COMPLETED.
echo; echo "[5/5] Waiting for deployment $DEPLOYMENT_ID to roll out..."
ROLLED_OUT=0
for i in $(seq 1 60); do
  STATE=$(aws ecs describe-services --region "$REGION" --cluster "$ECS_CLUSTER" --services "$SERVICE_NAME" \
    --query "services[0].deployments[?id=='$DEPLOYMENT_ID'].rolloutState | [0]" --output text 2>/dev/null || true)
  if [ "$STATE" = "COMPLETED" ]; then ROLLED_OUT=1; break; fi
  if [ "$STATE" = "FAILED" ]; then
    echo "ECS rollout FAILED -- see CloudWatch /ecs/$PRODUCT-$ENV_NAME" >&2
    exit 1
  fi
  sleep 10
done
if [ "$ROLLED_OUT" = "1" ]; then
  echo; echo "== $ENV_NAME deploy succeeded -- new task definition is live =="
else
  echo; echo "== $ENV_NAME deploy NOT confirmed: rollout still in progress after 10 min -- check 'aws ecs describe-services --cluster $ECS_CLUSTER --services $SERVICE_NAME' and CloudWatch /ecs/$PRODUCT-$ENV_NAME ==" >&2
  exit 1
fi
