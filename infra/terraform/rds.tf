# The RDS instance is private (no public IP), so Terraform can't reach it
# directly to run SQL -- create-rds-roles.sh executes it as a one-off task
# inside the VPC instead (the pg-admin technique from
# infra/docs/onboarding-runbook.md). Re-runs are safe: the script only
# creates what's missing.
resource "null_resource" "rds_bootstrap" {
  triggers = {
    product_name = local.product_name
    staging_pw   = random_password.db["staging"].result
    prod_pw      = random_password.db["prod"].result
  }

  depends_on = [aws_security_group_rule.task_to_rds]

  provisioner "local-exec" {
    interpreter = [local.bash_path, "-c"]
    command     = "'${path.module}/scripts/create-rds-roles.sh'"
    environment = {
      PRODUCT    = local.product_name
      REGION     = local.region
      CLUSTER    = local.shared.ecs_cluster
      SUBNETS    = join(",", local.shared.subnets)
      SG         = aws_security_group.ecs.id
      STAGING_PW = random_password.db["staging"].result
      PROD_PW    = random_password.db["prod"].result
    }
  }
}
