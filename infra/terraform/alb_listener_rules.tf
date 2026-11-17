# Associates each target group with the shared ALB via a host-header rule on
# its plain HTTP:80 listener -- required even before you have a real domain:
# `aws ecs create-service --load-balancers` rejects a target group that
# isn't already associated with a load balancer, and that association is
# only made by a listener referencing it (an unattached target group, as
# created by target_groups.tf alone, doesn't count).
#
# This does NOT put the app on the public internet by itself -- nothing
# resolves e.g. "staging.webapp-template-smoke.invalid" until you own a real
# domain and add matching DNS + an HTTPS rule (see
# infra/docs/onboarding-runbook.md's "real domain" section). It only
# satisfies the ECS API's requirement and gives you a same-VPC/local way to
# smoke-test via the target group's health state.
resource "aws_lb_listener_rule" "http" {
  for_each     = toset(local.envs)
  listener_arn = local.shared.alb_http_listener_arn
  priority     = local.config.alb_priority_base + (each.key == "staging" ? 0 : 1)
  # cloudops:service marks the rule as belonging to this service. Auto-wake (INT-REQ-13) reads it, so
  # Terraform must keep it or the next apply would strip it. Only staging has auto-wake.
  tags = merge(
    { Environment = each.key },
    each.key == "staging" ? { "cloudops:service" = "ferrous-studio-staging" } : {},
  )

  lifecycle {
    # Auto-wake swaps this rule between the app and its "waker" while the service sleeps. Without this,
    # an apply during sleep would point the rule back at a stopped app and visitors would get a 503.
    ignore_changes = [action]
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.this[each.key].arn
  }

  condition {
    host_header {
      # Strip the "https://" scheme -- host-header conditions want a bare hostname.
      values = [replace(local.app_public_url[each.key], "https://", "")]
    }
  }
}
