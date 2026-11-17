# CloudOps > Costs (INT-REQ-14, phase 1): the platform-admin cost report reads AWS Cost Explorer.
#
# Read-only, and nothing else: no ecs:UpdateService, no tagging, no secrets. The start/stop panel (a later
# phase) will need more and gets its own reviewed policy then.
#
# The task role is shared by staging and prod, so staging technically holds this too. What stops staging
# using it is the CLOUDOPS_ENABLED switch in the app (on in prod only, see backend/app/config.py), and the
# permission is read-only billing data either way. Cost Explorer has no resource-level permissions, so
# the resource is "*" by necessity.
resource "aws_iam_role_policy" "cloudops_costs" {
  name = "cloudops-cost-explorer-read"
  role = aws_iam_role.task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "ce:GetCostAndUsage",
        "ce:GetCostForecast",
        "ce:GetDimensionValues",
        "ce:GetTags",
      ]
      Resource = "*"
    }]
  })
}

# CloudOps > Resources (INT-REQ-14, phase 2): the read-only list of ECS services, their state and web addresses.
#
# Describe/List only: nothing here can start, stop, scale, tag or re-route anything. The start/stop panel (phase 3)
# will add ecs:UpdateService and tagging in its own policy, reviewed on its own. Describe and List actions have no
# useful resource-level scoping, so the resource is "*".
resource "aws_iam_role_policy" "cloudops_resources_read" {
  name = "cloudops-resources-read"
  role = aws_iam_role.task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ecs:ListServices",
          "ecs:DescribeServices",
          "ecs:DescribeTaskDefinition",
          "ecs:ListTagsForResource",
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "elasticloadbalancing:DescribeListeners",
          "elasticloadbalancing:DescribeRules",
          "elasticloadbalancing:DescribeTargetGroups",
          "elasticloadbalancing:DescribeTargetHealth",
          "elasticloadbalancing:DescribeTags",
        ]
        Resource = "*"
      },
    ]
  })
}

# CloudOps > Resources actions (INT-REQ-14, phase 3): Studio may only INVOKE the control function.
#
# Studio's task role is shared by staging and prod, so it is deliberately given no permission to change ECS
# services itself. The cloudops-control function (infra/cloudops/control in the functionAI repo) does the changing,
# and AWS stops that function touching any service whose name contains "-prod". This policy names exactly one
# function, so it cannot invoke anything else. The function's own resource policy also lists only this role.
resource "aws_iam_role_policy" "cloudops_control_invoke" {
  name = "cloudops-control-invoke"
  role = aws_iam_role.task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "lambda:InvokeFunction"
      Resource = "arn:aws:lambda:${local.region}:${local.shared.account_id}:function:cloudops-control"
    }]
  })
}
