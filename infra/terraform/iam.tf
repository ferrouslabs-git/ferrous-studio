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

# This product's own task role -- for its own AWS calls (Cognito admin
# actions, S3, etc. as you add them). Starts with no permissions attached.
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
