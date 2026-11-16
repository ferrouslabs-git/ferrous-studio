# Shared infra — onboarding a new product (RDS databases + VPC/ALB/ECS)

Recipe for onboarding a **new product** onto the shared infrastructure:
staging and prod databases on the shared RDS instance (each product isolated
behind its own login roles), and an ECS service behind the shared ALB.

## The shared instance

| Thing | Value |
|---|---|
| RDS instance | `ferrous-internal-tools-database` (PG 18, private) |
| Endpoint | `ferrous-internal-tools-database.crwye4eoshr1.eu-west-1.rds.amazonaws.com:5432` |
| RDS security group | `sg-08e796da657fd810b` |
| VPC | `vpc-00c249242b11cbcb5` |

## Chosen pattern: one database per product **per environment**

```
Instance: ferrous-internal-tools-database        (live state, 2026-07-30)
├── processmapper_staging  ← owned by processmapper_staging_app (schema "staging" inside)
├── processmapper_prod     ← owned by processmapper_prod_app   (schema "prod" inside)
├── processmapper          ← RETIRED (old shared DB; connections revoked, kept as archive)
├── fnai_staging           ← owned by fnai_staging_owner
└── <product>_staging / <product>_prod   ← the pattern for every new product
```

> ProcessMapper was migrated to this pattern on 2026-07-30. Its tables still
> live in schemas named `staging`/`prod` *inside* their respective databases
> (so the app's `DB_SCHEMA` env var is unchanged); new products should just
> use `public`. The old shared `processmapper` database and its
> `processmapper_app` role are locked (NOLOGIN, connections revoked) and can
> be dropped once nobody misses them.

Why per-environment databases (rather than processmapper's schema-per-env):

- **Blast radius** — staging credentials physically cannot touch prod data;
  with schemas, one role usually has rights to both.
- **Backups** — `pg_dump <product>_prod` restores prod alone; RDS snapshots
  still cover everything.
- **Migrations** — no `DB_SCHEMA` / `search_path` plumbing in the app; each
  environment's `DATABASE_URL` is a plain connection string.

Naming: databases `<product>_staging` / `<product>_prod`; roles
`<product>_staging_app` / `<product>_prod_app`; config and secrets
`/<product>/<env>/DATABASE_URL` (AWS Parameter Store, see §3).

## 1. Connect as the master user (in-VPC)

The instance is private — SQL must run from inside the VPC. The easiest way
is the **`pg-admin` Fargate task definition** (already registered): a
`postgres:18` container with `MASTER_USER`/`MASTER_PW` injected from the
`ferrous-internal-tools-database/master` secret and `PGHOST` preset. Run any
one-off SQL like this:

```bash
aws ecs run-task --region eu-west-1 --cluster default --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-05c30c94cbcf72903,subnet-04c3f3b9f167905ed],securityGroups=[sg-0e9ba22c9ab0054e8],assignPublicIp=ENABLED}" \
  --task-definition pg-admin \
  --overrides '{"containerOverrides":[{"name":"pgadmin","command":["sh","-c","export PGPASSWORD=\"$MASTER_PW\"; psql -h $PGHOST -U $MASTER_USER -d postgres -c \"SELECT 1\""]}]}'
# output lands in CloudWatch log group /ecs/pg-admin, stream run/pgadmin/<task-id>
```

## 2. Create roles + databases (one-off SQL)

Generate two strong passwords first. Prefer URL-safe characters (letters,
digits, `-`, `_`) so they can go into `postgresql://` URLs without escaping:

```bash
openssl rand -base64 30 | tr '+/' '-_'
```

Then, connected to the instance as the master user (`postgres` database):

```sql
-- Login roles, one per environment. CONNECTION LIMIT protects the shared
-- instance's max_connections pool from a runaway app.
CREATE ROLE <product>_staging_app LOGIN PASSWORD '<staging-pw>' CONNECTION LIMIT 20;
CREATE ROLE <product>_prod_app    LOGIN PASSWORD '<prod-pw>'    CONNECTION LIMIT 20;

-- RDS master is not a superuser: it must be a member of a role to create a
-- database owned by it.
GRANT <product>_staging_app TO <master-user>;
GRANT <product>_prod_app    TO <master-user>;

CREATE DATABASE <product>_staging OWNER <product>_staging_app;
CREATE DATABASE <product>_prod    OWNER <product>_prod_app;

-- By default ANY role on the instance may connect to ANY database.
-- Lock each database down to its own role.
REVOKE CONNECT ON DATABASE <product>_staging FROM PUBLIC;
REVOKE CONNECT ON DATABASE <product>_prod    FROM PUBLIC;
```

Because each role **owns** its database it can create schemas, tables and
extensions-that-don't-need-superuser there — no further grants needed, and the
app's migration tool (Alembic etc.) just works. On PG 15+ the `public` schema
inside each database is owned by `pg_database_owner`, i.e. the app role — also
fine out of the box.

### Verify isolation

```sql
-- should FAIL with "permission denied for database":
psql "postgresql://<product>_staging_app:<pw>@<endpoint>:5432/<product>_prod"
-- should succeed:
psql "postgresql://<product>_staging_app:<pw>@<endpoint>:5432/<product>_staging"
```

## 3. Secrets and config — Parameter Store by default

**Default: AWS Systems Manager Parameter Store, type `SecureString`, standard
tier.** It is encrypted with the AWS-managed key, costs nothing (up to 10,000
parameters), and ECS reads it natively. **Do not create new Secrets Manager
secrets** for a new product: each one costs $0.40/month forever, and a shared
account with dozens of products and tenants adds up (we cut 64 secrets to 5 in
Nov 2026 — INT-REQ-11).

Naming: `/<product>/<env>/<KEY>`, for example `/<product>/staging/DATABASE_URL`.
The path prefix is what the IAM policy in §4 is scoped to.

**What goes where**

| Value | Put it in |
|---|---|
| Passwords, API keys, tokens, DB URLs, signing keys | Parameter Store `SecureString` |
| Identifiers that are not credentials (Cognito pool/client ID, bucket name, sender email, public keys) | a plain `environment` entry in the task definition |
| Per-customer / per-tenant secrets created at runtime | **never one Secrets Manager secret each.** Store them as SecureStrings under `/<product>/<env>/tenants/<tenant>/…` (as fnai does) or encrypted in the product's own database |
| Secrets that need *automatic rotation* (e.g. the RDS master, which RDS manages) or a service that only accepts Secrets Manager (AgentCore Identity) | Secrets Manager — the exception, and say why in the ticket |

Create a parameter (pass the value from a file so it never lands in shell
history, and write it **without a trailing newline** — a stray newline breaks
database URLs):

```bash
printf '%s' 'postgresql+psycopg://<product>_staging_app:<pw>@ferrous-internal-tools-database.crwye4eoshr1.eu-west-1.rds.amazonaws.com:5432/<product>_staging' > /tmp/v.txt
aws ssm put-parameter --region eu-west-1 \
  --name /<product>/staging/DATABASE_URL --type SecureString --tier Standard \
  --value file:///tmp/v.txt --no-overwrite
shred -u /tmp/v.txt

# repeat for /<product>/prod/DATABASE_URL (the prod DB URL)
```

(Adjust the `+psycopg` driver suffix to whatever the new product's stack
expects — plain `postgresql://` for most non-SQLAlchemy stacks.)

Verify the stored value is exactly what you meant (compare, don't print):

```bash
aws ssm get-parameter --region eu-west-1 --name /<product>/staging/DATABASE_URL \
  --with-decryption --query Parameter.Value --output text | wc -c   # = length + 1 newline from the CLI
```

## 4. IAM and task definition — let the new product read *its* parameters only

ECS reads parameters **at task start** using the task *execution* role (not the
task role), so rotating a value means redeploying the service.

Give the new product its own execution role (preferred — the shared
`ecsTaskExecutionRole` already carries many inline policies and IAM caps a
role's inline policies at 10,240 characters in total):

```bash
cat > /tmp/pol.json <<'EOF'
{"Version":"2012-10-17","Statement":[
 {"Effect":"Allow","Action":["ssm:GetParameters","ssm:GetParameter"],
  "Resource":"arn:aws:ssm:eu-west-1:690488446356:parameter/<product>/*"},
 {"Effect":"Allow","Action":"kms:Decrypt","Resource":"*",
  "Condition":{"StringEquals":{"kms:ViaService":"ssm.eu-west-1.amazonaws.com"}}}]}
EOF
aws iam put-role-policy --role-name <product>EcsTaskExecutionRole \
  --policy-name read-<product>-params --policy-document file:///tmp/pol.json
```

In the task definition, reference the parameter by ARN in `secrets`, and keep
non-secret identifiers in `environment`:

```json
"secrets": [
  { "name": "DATABASE_URL",
    "valueFrom": "arn:aws:ssm:eu-west-1:690488446356:parameter/<product>/staging/DATABASE_URL" }
],
"environment": [
  { "name": "COGNITO_USER_POOL_ID", "value": "eu-west-1_xxxxxxxxx" }
]
```

Do not let one product's policy reach another's prefix, and never use `*` as
the parameter resource.

## 5. Network — allow the new app to reach RDS

Whatever runs the new product (ECS task, Lambda in-VPC, App Runner VPC
connector) gets its own security group; authorise it on the RDS security
group:

```bash
aws ec2 authorize-security-group-ingress --group-id sg-08e796da657fd810b \
  --protocol tcp --port 5432 --source-group <new-app-sg>
```

## 6. Migrations

Run the product's migration tool once per environment with the matching
`DATABASE_URL` (e.g. an ECS `run-task` override, as in `ecs-deploy.md` §8).
No schema/search-path configuration is needed — everything lives in the
database's default `public` schema.

## 7. Shared VPC / ALB / ECS — running the new app behind the same ALB

Current live topology (verified 2026-07-23; supersedes the IDs in
`ecs-deploy.md`, whose GrowthGorilla ALB no longer exists):

| Thing | Value |
|---|---|
| VPC | `vpc-00c249242b11cbcb5` |
| Subnets (public, IGW route) | `subnet-05c30c94cbcf72903`, `subnet-04c3f3b9f167905ed`, `subnet-06de3d3eae18c9463` |
| ECS cluster | `default` |
| ALB | `processmapper-staging-alb` (name is historical — it now serves staging **and** prod, i.e. it *is* the shared ALB) |
| ALB ARN | `arn:aws:elasticloadbalancing:eu-west-1:690488446356:loadbalancer/app/processmapper-staging-alb/64e29e0f481898b8` |
| ALB DNS | `processmapper-staging-alb-1723655842.eu-west-1.elb.amazonaws.com` |
| ALB security group | `sg-028541a15b9aa42ba` (`processmapper-alb-sg`, 80/443 from anywhere) |
| HTTPS:443 listener | `arn:aws:elasticloadbalancing:eu-west-1:690488446356:listener/app/processmapper-staging-alb/64e29e0f481898b8/62688514204f110f` |
| HTTP:80 listener | `.../6295fb591f3700e2` (currently forwards straight to staging TG) |
| Listener certs (SNI) | `staging.process-flow.app` (default), `process-flow.app` |
| Existing HTTPS rules | prio 5 `process-flow.app` → `pm-prod-tg`; prio 10 `prod-preview.process-flow.app` → `pm-prod-tg`; **default → `pm-staging-tg`** |
| processmapper task SG | `sg-0e9ba22c9ab0054e8` (`processmapper-ecs-sg`, 8080 from ALB SG) |
| Tasks run with | `assignPublicIp=ENABLED` (public subnets + IGW — no NAT needed) |

> **Routing gotcha:** the HTTPS listener's *default* action forwards to
> processmapper staging. A new product must therefore be routed by
> **host-header rules** — any hostname you don't add a rule for will land on
> processmapper staging.

Per new product (`<product>`, container port `<port>`, domains
`staging.<domain>` / `<domain>`):

```bash
# a. ACM cert(s) for the new domain, then attach to the shared HTTPS listener (SNI)
CERT=$(aws acm request-certificate --region eu-west-1 \
  --domain-name '<domain>' --subject-alternative-names 'staging.<domain>' \
  --validation-method DNS --query CertificateArn --output text)
# ...create the DNS validation records, wait for ISSUED, then:
aws elbv2 add-listener-certificates --region eu-west-1 \
  --listener-arn arn:aws:elasticloadbalancing:eu-west-1:690488446356:listener/app/processmapper-staging-alb/64e29e0f481898b8/62688514204f110f \
  --certificates CertificateArn=$CERT

# b. Target groups (one per environment)
TG_STAGING=$(aws elbv2 create-target-group --region eu-west-1 \
  --name <product>-staging-tg --protocol HTTP --port <port> \
  --vpc-id vpc-00c249242b11cbcb5 --target-type ip \
  --health-check-path /api/health \
  --query 'TargetGroups[0].TargetGroupArn' --output text)
# repeat for <product>-prod-tg

# c. Host-header rules on the HTTPS listener.
#    Priorities in use: 5, 10 (processmapper). Give each product its own
#    block of 10 — next free block starts at 20.
aws elbv2 create-rule --region eu-west-1 \
  --listener-arn arn:aws:elasticloadbalancing:eu-west-1:690488446356:listener/app/processmapper-staging-alb/64e29e0f481898b8/62688514204f110f \
  --priority 20 --conditions Field=host-header,Values='<domain>' \
  --actions Type=forward,TargetGroupArn=$TG_PROD
aws elbv2 create-rule --region eu-west-1 \
  --listener-arn ...62688514204f110f \
  --priority 21 --conditions Field=host-header,Values='staging.<domain>' \
  --actions Type=forward,TargetGroupArn=$TG_STAGING

# d. Task security group: ALB -> task on the app port, task -> RDS (per §5)
SG=$(aws ec2 create-security-group --region eu-west-1 \
  --group-name <product>-ecs-sg --description "<product> ECS tasks" \
  --vpc-id vpc-00c249242b11cbcb5 --query GroupId --output text)
aws ec2 authorize-security-group-ingress --region eu-west-1 --group-id $SG \
  --protocol tcp --port <port> --source-group sg-028541a15b9aa42ba
aws ec2 authorize-security-group-ingress --region eu-west-1 \
  --group-id sg-08e796da657fd810b --protocol tcp --port 5432 --source-group $SG

# e. Service on the shared cluster (after registering the task definition)
aws ecs create-service --region eu-west-1 --cluster default \
  --service-name <product>-staging \
  --task-definition <product>-staging \
  --desired-count 1 --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-05c30c94cbcf72903,subnet-04c3f3b9f167905ed,subnet-06de3d3eae18c9463],securityGroups=[$SG],assignPublicIp=ENABLED}" \
  --load-balancers "targetGroupArn=$TG_STAGING,containerName=<product>,containerPort=<port>" \
  --health-check-grace-period-seconds 60
# repeat for <product>-prod

# f. DNS: point the new domains at the shared ALB
#    (alias/CNAME -> processmapper-staging-alb-1723655842.eu-west-1.elb.amazonaws.com)
```

Notes:

- **HTTP:80** currently forwards everything to processmapper staging. If the
  new product needs port 80 handled properly, the clean shared fix is to
  change that listener's default action to a 301 redirect to HTTPS — this
  affects processmapper too, so do it deliberately, not per-product.
- The ALB and its 80/443-from-anywhere security group are shared as-is; a new
  product only ever adds *SNI certificates* and *listener rules* to it.
- Each product keeps its **own** task security group, execution/task IAM
  roles, ECR repo, log group, and Parameter Store prefix (`/<product>/…`) — the only shared
  pieces are the VPC/subnets, ALB, ECS cluster, and RDS instance.

## Instance-level housekeeping (as products accumulate)

- **Connections** — `db.t*.micro`/`small` classes have low `max_connections`;
  the per-role `CONNECTION LIMIT` above keeps one product from starving the
  rest. Check usage: `SELECT datname, count(*) FROM pg_stat_activity GROUP BY 1;`
- **Noisy neighbours** — CPU/IO are shared; a heavy staging batch job affects
  every product's prod. Fine for internal tools, worth remembering before
  putting a latency-sensitive product here.
- **Upgrades** — a PG major-version upgrade now takes *every* product down
  together; coordinate maintenance windows accordingly.
- **Storage** — one product filling the disk stops all of them; keep the RDS
  free-storage CloudWatch alarm pointed somewhere someone reads.
