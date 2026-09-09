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
  "$REPO_ROOT/infra/ecs/taskdef.template.json" > "$RENDERED"
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
  aws ecs update-service --region "$REGION" --cluster "$ECS_CLUSTER" --service "$SERVICE_NAME" \
    --task-definition "$PRODUCT-$ENV_NAME" --force-new-deployment >/dev/null
  echo "  updated existing service (forced new deployment)"
else
  aws ecs create-service --region "$REGION" --cluster "$ECS_CLUSTER" \
    --service-name "$SERVICE_NAME" --task-definition "$PRODUCT-$ENV_NAME" \
    --desired-count 1 --launch-type FARGATE \
    --network-configuration "$NET_CONFIG" \
    --load-balancers "targetGroupArn=$TG_ARN,containerName=$PRODUCT,containerPort=$CONTAINER_PORT" \
    --health-check-grace-period-seconds 60 >/dev/null
  echo "  created new service"
fi

# ── 5. Wait for a healthy target ──
echo; echo "[5/5] Waiting for target group health..."
HEALTHY=0
for i in $(seq 1 30); do
  STATE=$(aws elbv2 describe-target-health --region "$REGION" --target-group-arn "$TG_ARN" --query "TargetHealthDescriptions[0].TargetHealth.State" --output text 2>/dev/null || true)
  if [ "$STATE" = "healthy" ]; then HEALTHY=1; break; fi
  sleep 10
done
if [ "$HEALTHY" = "1" ]; then
  echo; echo "== $ENV_NAME deploy succeeded -- target is healthy =="
else
  echo; echo "== $ENV_NAME deploy: target not healthy yet -- check 'aws ecs describe-services --cluster $ECS_CLUSTER --services $SERVICE_NAME' and CloudWatch /ecs/$PRODUCT-$ENV_NAME =="
fi
