# One Cognito user pool per environment (not one pool shared across
# environments, unlike processmapper) -- staging and prod users are entirely
# separate. See infra/docs/onboarding-runbook.md.
resource "aws_cognito_user_pool" "this" {
  for_each = toset(local.envs)
  name     = "${local.product_name}-${each.key}"

  auto_verified_attributes = ["email"]
  username_attributes      = ["email"]

  password_policy {
    minimum_length    = 8
    require_uppercase = true
    require_lowercase = true
    require_numbers   = true
    require_symbols   = false
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }
}

resource "aws_cognito_user_pool_client" "this" {
  for_each     = toset(local.envs)
  name         = "${local.product_name}-${each.key}-app-client"
  user_pool_id = aws_cognito_user_pool.this[each.key].id

  generate_secret                     = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                 = ["code"]
  allowed_oauth_scopes                = ["phone", "email", "openid", "profile"]
  supported_identity_providers        = ["COGNITO"]

  callback_urls = [
    "${local.app_public_url[each.key]}/auth/callback",
    "http://localhost:5173/auth/callback",
    "http://localhost:8080/auth/callback",
  ]
  logout_urls = [
    "${local.app_public_url[each.key]}/",
    "http://localhost:5173/",
    "http://localhost:8080/",
  ]

  explicit_auth_flows           = ["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
  prevent_user_existence_errors = "ENABLED"

  access_token_validity  = 1
  id_token_validity      = 1
  refresh_token_validity = 30
  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }
}

resource "aws_cognito_user_pool_domain" "this" {
  for_each     = toset(local.envs)
  domain       = "${local.product_name}-${each.key}-${local.shared.account_id}"
  user_pool_id = aws_cognito_user_pool.this[each.key].id
}
