# Every email leaves from app.config.json's email.sender on the verified
# ferrouslabs.co.uk SES domain identity: the app sends invitations itself
# (iam.tf send_email), and Cognito sends its verification / password-reset
# codes through the same identity so they carry the same From name and
# branding instead of Cognito's default no-reply@verificationemail.com.
#
# The identity is verified out of band (DKIM etc.) and shared with other
# products, so it is read rather than managed here.
data "aws_ses_domain_identity" "sender" {
  domain = local.sender_domain
}

# Sending authorisation for Cognito (its email_configuration is DEVELOPER
# mode, which means "use my SES identity" and requires this policy).
resource "aws_ses_identity_policy" "cognito_send" {
  identity = data.aws_ses_domain_identity.sender.arn
  name     = "${local.product_name}-cognito-send"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowCognitoToSendAs${replace(title(local.product_name), "-", "")}"
      Effect    = "Allow"
      Principal = { Service = "cognito-idp.amazonaws.com" }
      Action    = ["ses:SendEmail", "ses:SendRawEmail"]
      Resource  = data.aws_ses_domain_identity.sender.arn
      Condition = {
        StringEquals = { "aws:SourceAccount" = local.shared.account_id }
        ArnLike      = { "aws:SourceArn" = "arn:aws:cognito-idp:${local.region}:${local.shared.account_id}:userpool/*" }
      }
    }]
  })
}
