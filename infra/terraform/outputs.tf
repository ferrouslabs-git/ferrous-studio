output "security_group_id" {
  value = aws_security_group.ecs.id
}

output "task_role_arn" {
  value = aws_iam_role.task.arn
}

output "ecr_repository_url" {
  value = aws_ecr_repository.app.repository_url
}

output "target_group_arns" {
  value = { for e in local.envs : e => aws_lb_target_group.this[e].arn }
}

output "app_public_url" {
  value = local.app_public_url
}

output "cognito" {
  value = {
    for e in local.envs : e => {
      user_pool_id = aws_cognito_user_pool.this[e].id
      client_id    = aws_cognito_user_pool_client.this[e].id
      domain       = "https://${aws_cognito_user_pool_domain.this[e].domain}.auth.${local.region}.amazoncognito.com"
    }
  }
}
