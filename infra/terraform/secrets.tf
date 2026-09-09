resource "random_password" "db" {
  for_each = toset(local.envs)
  length   = 40
  special  = false # keep it URL-safe for a postgresql:// connection string
}

resource "aws_secretsmanager_secret" "database_url" {
  for_each = toset(local.envs)
  name     = "${local.product_name}/${each.key}/DATABASE_URL"
}

resource "aws_secretsmanager_secret_version" "database_url" {
  for_each      = toset(local.envs)
  secret_id     = aws_secretsmanager_secret.database_url[each.key].id
  secret_string = "postgresql+psycopg://${local.product_name}_${each.key}_app:${random_password.db[each.key].result}@${local.shared.rds_endpoint}:5432/${local.product_name}_${each.key}"
}

# The Claude API key for requirements extraction. Deliberately no
# aws_secretsmanager_secret_version: the value is set once by hand so the key
# never lands in Terraform state --
#   aws secretsmanager put-secret-value \
#     --secret-id ferrous-studio/<env>/ANTHROPIC_API_KEY --secret-string sk-ant-...
# The execution role's read_secrets policy (iam.tf) already covers it.
resource "aws_secretsmanager_secret" "anthropic_api_key" {
  for_each = toset(local.envs)
  name     = "${local.product_name}/${each.key}/ANTHROPIC_API_KEY"
}

# The GitHub App's credentials. GITHUB_APP_ID and GITHUB_APP_SLUG are not
# secret, but keeping all five together means one mechanism and one runbook
# entry (infra/docs/onboarding-runbook.md). Deliberately no
# aws_secretsmanager_secret_version, same reasoning as anthropic_api_key
# above: each App is created by hand per environment (its Setup URL must
# match that environment's own domain), so the values are set once by hand --
#   aws secretsmanager put-secret-value \
#     --secret-id ferrous-studio/<env>/GITHUB_APP_PRIVATE_KEY --secret-string "$(base64 -w0 <key>.pem)"
# Leaving an environment's values empty is a valid choice: the backend
# reports configured: false and the Repository/GitHub pages say so.
locals {
  github_secrets = ["GITHUB_APP_ID", "GITHUB_APP_SLUG", "GITHUB_APP_PRIVATE_KEY", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"]
}

resource "aws_secretsmanager_secret" "github" {
  for_each = { for pair in setproduct(local.envs, local.github_secrets) : "${pair[0]}/${pair[1]}" => pair }
  name     = "${local.product_name}/${each.value[0]}/${each.value[1]}"
}
