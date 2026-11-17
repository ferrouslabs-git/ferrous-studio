# Secrets and config for the app live in AWS Systems Manager Parameter Store
# (SecureString), NOT in Secrets Manager (INT-REQ-11: every Secrets Manager secret costs
# $0.40 a month, Parameter Store costs nothing). The values are set once by hand
# and are deliberately not in Terraform, so they never land in Terraform state:
#
#   printf '%s' '<value>' > /tmp/v.txt
#   aws ssm put-parameter --name /ferrous-studio/<env>/<KEY> --type SecureString \
#     --tier Standard --value file:///tmp/v.txt --no-overwrite
#
# Keys per environment (staging and prod): DATABASE_URL, GITHUB_APP_ID, GITHUB_APP_SLUG,
# GITHUB_APP_PRIVATE_KEY, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, SLACK_CLIENT_ID,
# SLACK_CLIENT_SECRET, SLACK_SIGNING_SECRET, SLACK_TOKEN_KEY. The task definition
# (infra/ecs/taskdef.template.json) names them, and the execution role may read them
# (read_parameters in iam.tf). Leaving an environment's GitHub or Slack values as a
# placeholder is valid: the backend then reports configured: false.

# Still needed: rds.tf uses these as the passwords it sets on the per-environment
# database roles. The same values were copied into the DATABASE_URL parameters.
resource "random_password" "db" {
  for_each = toset(local.envs)
  length   = 40
  special  = false # keep it URL-safe for a postgresql:// connection string
}
