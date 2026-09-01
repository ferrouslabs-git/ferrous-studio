# The shared ecsTaskExecutionRole (pre-existing, used by every product on
# this ALB/cluster) gets one extra inline policy scoped to just this
# product's secrets -- it isn't otherwise managed by this Terraform config.
data "aws_iam_role" "ecs_execution" {
  name = reverse(split("/", local.shared.ecs_execution_role_arn))[0]
}

resource "aws_iam_role_policy" "read_secrets" {
  name = "read-${local.product_name}-secrets"
  role = data.aws_iam_role.ecs_execution.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "secretsmanager:GetSecretValue"
      Resource = "arn:aws:secretsmanager:${local.region}:${local.shared.account_id}:secret:${local.product_name}/*"
    }]
  })
}

# The shared role's AmazonECSTaskExecutionRolePolicy covers CreateLogStream +
# PutLogEvents but not CreateLogGroup, which the task definitions need
# (awslogs-create-group: true) the first time each log group is used.
resource "aws_iam_role_policy" "create_log_group" {
  name = "create-${local.product_name}-log-group"
  role = data.aws_iam_role.ecs_execution.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "logs:CreateLogGroup"
      Resource = "arn:aws:logs:${local.region}:${local.shared.account_id}:log-group:/ecs/${local.product_name}-*"
    }]
  })
}

# This product's own task role -- for its own AWS calls (SES for invitation
# emails and Cognito admin actions below; add S3 etc. here as needed).
resource "aws_iam_role" "task" {
  name = "${local.product_name}-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# Invitation emails: the app sends via SES from app.config.json's email.sender.
# Scoped to that address's domain identity so the task cannot send as anyone
# else in the account.
resource "aws_iam_role_policy" "send_email" {
  name = "send-invitation-email"
  role = aws_iam_role.task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["ses:SendEmail", "ses:SendRawEmail"]
      Resource = "arn:aws:ses:${local.region}:${local.shared.account_id}:identity/${local.sender_domain}"
      Condition = {
        StringEquals = { "ses:FromAddress" = local.sender_email }
      }
    }]
  })
}

# Invitation sign-up: the API pre-creates the invitee in Cognito, sets the
# password they choose and signs them in server-side. Scoped to this
# product's own user pools only.
resource "aws_iam_role_policy" "cognito_admin" {
  name = "cognito-invitation-admin"
  role = aws_iam_role.task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "cognito-idp:AdminCreateUser",
        "cognito-idp:AdminGetUser",
        "cognito-idp:AdminSetUserPassword",
        "cognito-idp:AdminInitiateAuth",
        "cognito-idp:AdminUserGlobalSignOut",
        "cognito-idp:ListUsers",
      ]
      Resource = [for env in local.envs : aws_cognito_user_pool.this[env].arn]
    }]
  })
}

# Project documents: the API signs upload/download URLs for the browser and
# reads objects itself for transcript extraction. Both environments' buckets,
# since one task role serves both (as with the Cognito pools above).
resource "aws_iam_role_policy" "documents_bucket" {
  name = "project-documents"
  role = aws_iam_role.task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
        Resource = [for env in local.envs : "${aws_s3_bucket.documents[env].arn}/*"]
      },
      {
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = [for env in local.envs : aws_s3_bucket.documents[env].arn]
      },
    ]
  })
}
