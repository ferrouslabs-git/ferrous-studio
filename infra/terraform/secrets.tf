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
