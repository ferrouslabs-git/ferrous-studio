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
