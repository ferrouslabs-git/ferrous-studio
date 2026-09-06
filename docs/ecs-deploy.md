# ProcessMapper → ECS (Fargate) deploy runbook — staging

Deploys this branch as **staging** on ECS Fargate, against the shared RDS, using
the `processmapper` database + `staging` schema. Prod stays on App Runner until
you promote (last section).

> Everything is additive — it reuses the existing ALB and an existing RDS
> instance. Nothing touches the running App Runner prod or the GrowthGorilla ECS.

## 0. Known IDs (this account)

| Thing | Value |
|---|---|
| Account / Region | `690488446356` / `eu-west-1` |
| VPC | `vpc-00c249242b11cbcb5` |
| Subnets (RDS subnet group) | `subnet-05c30c94cbcf72903`, `subnet-04c3f3b9f167905ed`, `subnet-06de3d3eae18c9463` |
| RDS instance | `ferrous-internal-tools-database` (PG 18, private) |
| RDS endpoint | `ferrous-internal-tools-database.crwye4eoshr1.eu-west-1.rds.amazonaws.com:5432` |
| RDS security group | `sg-08e796da657fd810b` |
| ECR repo | `690488446356.dkr.ecr.eu-west-1.amazonaws.com/process-mapper-dev-app` |
| ALB | `arn:aws:elasticloadbalancing:eu-west-1:690488446356:loadbalancer/app/ecs-express-gateway-alb-d2917228/07ac3163b918c8cb` |
| HTTPS:443 listener | `arn:aws:elasticloadbalancing:eu-west-1:690488446356:listener/app/ecs-express-gateway-alb-d2917228/07ac3163b918c8cb/7e5c5811976b2e4b` |
| ECS cluster | `default` (reuse) |

**Networking (resolved — no NAT needed):** the 3 subnets above are **public**
(they have an Internet Gateway route). Run the task with `assignPublicIp=ENABLED`
— it reaches ECR/Cognito/S3 via the IGW and the private RDS via the security
group. **No NAT gateway, no VPC endpoints, $0 extra.**

**URL / HTTPS:** the existing shared ALB's cert only covers GrowthGorilla's
`*.ecs.eu-west-1.on.aws` name, so we don't reuse it. Cognito hosted-UI login
needs HTTPS for any non-localhost callback, so use the **ECS managed public
endpoint** (the same feature GrowthGorilla uses): ECS auto-provisions a
`*.ecs.eu-west-1.on.aws` HTTPS URL + cert — no domain, no NAT. Add that URL as a
callback in the Cognito app client. Wire `process-flow.app` later (last section).

> Easiest way to get the managed endpoint: create the service in the **ECS
> console** ("Create service" → Networking → turn on a public endpoint). It
> provisions the load balancer + `*.on.aws` cert for you. The CLI steps below
> (own target group / listener rule) are the alternative if you'd rather script
> a dedicated ALB.

---

## 1. Create the database, schema-owner role (one-off, in-VPC)

The RDS is private, so run this from inside the VPC (a bastion, an EC2 in the
VPC, or a throwaway `psql` Fargate task). Alembic creates the *schema*; it does
**not** create the *database* or *role* — do that once:

```sql
-- as the RDS master user, connected to the instance:
CREATE DATABASE processmapper;
CREATE ROLE processmapper_app LOGIN PASSWORD '<choose-strong-pw>';
\connect processmapper
GRANT ALL ON SCHEMA public TO processmapper_app;   -- or restrict later
GRANT CREATE ON DATABASE processmapper TO processmapper_app;  -- so Alembic can CREATE SCHEMA staging
```

(Schemas `staging` / `prod` are created automatically by `alembic upgrade`.)

## 2. Store secrets in Secrets Manager

The task definition reads three secrets (DB URL + Stripe secret/webhook). The
Stripe **publishable** key is public, so it stays as a plain env var.

```bash
aws secretsmanager create-secret --region eu-west-1 \
  --name processmapper/staging/DATABASE_URL \
  --secret-string 'postgresql+psycopg://processmapper_app:<pw>@ferrous-internal-tools-database.crwye4eoshr1.eu-west-1.rds.amazonaws.com:5432/processmapper'

aws secretsmanager create-secret --region eu-west-1 \
  --name processmapper/staging/STRIPE_SECRET_KEY \
  --secret-string 'sk_test_...'        # from your Stripe dashboard (test mode)

aws secretsmanager create-secret --region eu-west-1 \
  --name processmapper/staging/STRIPE_WEBHOOK_SECRET \
  --secret-string 'whsec_...'          # from a Stripe webhook endpoint (or placeholder until wired)
```

## 3. Build & push the image (tag `staging`)

```bash
aws ecr get-login-password --region eu-west-1 | docker login --username AWS \
  --password-stdin 690488446356.dkr.ecr.eu-west-1.amazonaws.com
docker build -t process-mapper-dev-app:staging .
docker tag process-mapper-dev-app:staging \
  690488446356.dkr.ecr.eu-west-1.amazonaws.com/process-mapper-dev-app:staging
docker push 690488446356.dkr.ecr.eu-west-1.amazonaws.com/process-mapper-dev-app:staging
```

## 4. IAM roles

`ecsTaskExecutionRole` (pull image + read secret + write logs) and a task role:

```bash
# execution role (skip create if it already exists)
aws iam create-role --role-name ecsTaskExecutionRole \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
aws iam attach-role-policy --role-name ecsTaskExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
# allow reading the DB secret
aws iam put-role-policy --role-name ecsTaskExecutionRole --policy-name read-pm-secret \
  --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"secretsmanager:GetSecretValue","Resource":"arn:aws:secretsmanager:eu-west-1:690488446356:secret:processmapper/*"}]}'

# task role (app's own AWS calls: S3 + Cognito + the still-read DynamoDB tables)
aws iam create-role --role-name processmapper-task-role \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
# attach the same S3/Cognito/DDB policy the App Runner instance role uses.
```

## 5. Security group for the task + let it reach RDS

```bash
SG=$(aws ec2 create-security-group --group-name processmapper-ecs-sg \
  --description "ProcessMapper ECS tasks" --vpc-id vpc-00c249242b11cbcb5 \
  --query GroupId --output text)
# task -> RDS:5432
aws ec2 authorize-security-group-ingress --group-id sg-08e796da657fd810b \
  --protocol tcp --port 5432 --source-group $SG
# ALB -> task:8080  (use the ALB's security group as the source)
aws ec2 authorize-security-group-ingress --group-id $SG \
  --protocol tcp --port 8080 --source-group <ALB_SECURITY_GROUP_ID>
echo "task SG = $SG"
```

## 6. Target group + ALB listener rule

```bash
TG=$(aws elbv2 create-target-group --name processmapper-staging-tg \
  --protocol HTTP --port 8080 --vpc-id vpc-00c249242b11cbcb5 \
  --target-type ip --health-check-path /api/health \
  --query 'TargetGroups[0].TargetGroupArn' --output text)

# route a host header to it (priority must be unused on the listener)
aws elbv2 create-rule \
  --listener-arn arn:aws:elasticloadbalancing:eu-west-1:690488446356:listener/app/ecs-express-gateway-alb-d2917228/07ac3163b918c8cb/7e5c5811976b2e4b \
  --priority 50 \
  --conditions Field=host-header,Values=staging.process-flow.app \
  --actions Type=forward,TargetGroupArn=$TG
```

## 7. Register the task definition

```bash
aws ecs register-task-definition --region eu-west-1 \
  --cli-input-json file://infra/ecs/processmapper-staging.taskdef.json
```

## 8. Run DB migrations once (Alembic), before serving

```bash
aws ecs run-task --region eu-west-1 --cluster default \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-05c30c94cbcf72903,subnet-04c3f3b9f167905ed],securityGroups=[$SG],assignPublicIp=ENABLED}" \
  --overrides '{"containerOverrides":[{"name":"processmapper","command":["sh","-c","cd /workspace/backend && alembic upgrade head"]}]}' \
  --task-definition processmapper-staging
# watch logs in /ecs/processmapper-staging ; it should create schema "staging" + tables
```

(Optionally run `scripts/backfill_dynamodb_to_postgres.py` the same way to seed
staging from the live DynamoDB data.)

## 9. Create the service

```bash
aws ecs create-service --region eu-west-1 --cluster default \
  --service-name processmapper-staging \
  --task-definition processmapper-staging \
  --desired-count 1 --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-05c30c94cbcf72903,subnet-04c3f3b9f167905ed],securityGroups=[$SG],assignPublicIp=ENABLED}" \
  --load-balancers "targetGroupArn=$TG,containerName=processmapper,containerPort=8080" \
  --health-check-grace-period-seconds 60
```

## 10. Verify (AWS-assigned URL now; domain later)

The managed endpoint gives you a URL like `https://gr-xxxx.ecs.eu-west-1.on.aws`.

```bash
curl -fsS https://<your>.ecs.eu-west-1.on.aws/api/health    # -> ok
```
Then add that URL to the Cognito app client's **callback / sign-out URLs**, sign
in through the existing hosted UI, and confirm orgs/snapshots load.

**Custom domain later:** when ready, add `staging.process-flow.app` (or similar)
to an ACM cert on the load balancer and point a Route53 record at it — no app
changes needed.

---

## Redeploys

```bash
docker build -t ... :staging . && docker push ...:staging
aws ecs update-service --cluster default --service processmapper-staging \
  --force-new-deployment
```

## Promote to prod (when happy)

Two options:

**A. Keep prod on App Runner**, just flip its data layer — lowest effort:
- Create `processmapper/prod/DATABASE_URL` secret (same DB, schema `prod`).
- Run `alembic upgrade head` with `DB_SCHEMA=prod` (creates the `prod` schema).
- Set App Runner env: `DB_BACKEND=postgres`, `DATABASE_URL=<prod secret>`,
  `DB_SCHEMA=prod`, plus `COGNITO_CLIENT_ID`, then deploy.
- Rollback = unset `DB_BACKEND` → back to DynamoDB instantly.

**B. Mirror this ECS setup for prod** — duplicate steps 2/6/7/9 with
`processmapper-prod`, `DB_SCHEMA=prod`, host `app.process-flow.app`.
