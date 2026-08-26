resource "aws_lb_target_group" "this" {
  for_each    = toset(local.envs)
  name        = "${local.product_name}-${each.key}-tg"
  protocol    = "HTTP"
  port        = local.container_port
  vpc_id      = local.shared.vpc_id
  target_type = "ip"

  health_check {
    path = "/api/health"
  }
}
