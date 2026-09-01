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

  # Cognito's own emails -- password-reset codes, email-change verification,
  # admin-triggered resets -- go out through our SES identity with the same
  # From name as the app's invitation emails (see ses.tf for the sending
  # authorisation). Invitations themselves are never sent by Cognito: the
  # app pre-creates users with MessageAction=SUPPRESS and emails its own.
  email_configuration {
    email_sending_account = "DEVELOPER"
    source_arn            = data.aws_ses_domain_identity.sender.arn
    from_email_address    = "${local.email_from_name} <${local.sender_email}>"
  }

  # One branded template serves every code Cognito sends ({####} is the code).
  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
    email_subject        = "Your ${local.email_from_name} verification code"
    email_message = templatefile("${path.module}/templates/cognito-code-email.html", {
      product_name = local.email_from_name
      legal        = local.email_legal
    })
  }

  # Safety net: Cognito never sends invitations (suppressed), but if it ever
  # did, the message must not be its unbranded default.
  admin_create_user_config {
    invite_message_template {
      email_subject = "You are invited to ${local.email_from_name}"
      email_message = "You have been invited to ${local.email_from_name}. Your username is {username} and your temporary password is {####}."
      sms_message   = "Your ${local.email_from_name} username is {username} and your temporary password is {####}."
    }
  }
}

resource "aws_cognito_user_pool_client" "this" {
  for_each     = toset(local.envs)
  name         = "${local.product_name}-${each.key}-app-client"
  user_pool_id = aws_cognito_user_pool.this[each.key].id

  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["phone", "email", "openid", "profile"]
  supported_identity_providers         = ["COGNITO"]

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

  # ALLOW_ADMIN_USER_PASSWORD_AUTH is the server-side (IAM-authenticated)
  # password flow the API uses to sign an invitee in straight after they set
  # their password on the invitation page. The browser still uses SRP / the
  # hosted UI; USER_PASSWORD_AUTH stays off.
  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_ADMIN_USER_PASSWORD_AUTH",
  ]
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
