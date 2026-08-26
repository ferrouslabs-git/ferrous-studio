resource "aws_security_group" "ecs" {
  name        = "${local.product_name}-ecs-sg"
  description = "${local.product_name} ECS tasks"
  vpc_id      = local.shared.vpc_id

  ingress {
    description     = "ALB to task"
    from_port       = local.container_port
    to_port         = local.container_port
    protocol        = "tcp"
    security_groups = [local.shared.alb_sg]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Product = local.product_name }
}

# Authorise this product's tasks on the shared RDS security group. This is a
# rule ON the shared RDS SG, not a new SG -- every product accumulates one
# such rule, which is the intended shape (see infra/docs/onboarding-runbook.md).
resource "aws_security_group_rule" "task_to_rds" {
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  security_group_id        = local.shared.rds_sg
  source_security_group_id = aws_security_group.ecs.id
  description               = "${local.product_name} tasks to RDS"
}
