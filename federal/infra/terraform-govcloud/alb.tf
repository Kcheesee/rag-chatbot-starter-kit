###############################################################################
# alb.tf
#
# Application Load Balancer fronting the ECS API service. HTTPS-only: port 80 is
# redirected to 443, and the 443 listener terminates TLS with the supplied ACM
# certificate using a modern TLS 1.2+ security policy.
###############################################################################

# ── Security group for the ALB ────────────────────────────────────────────────

resource "aws_security_group" "alb" {
  name        = "${local.name}-alb"
  description = "Ingress to the ${local.name} ALB"
  vpc_id      = aws_vpc.this.id

  tags = {
    Name = "${local.name}-alb"
  }
}

resource "aws_security_group_rule" "alb_ingress_https" {
  type              = "ingress"
  description       = "HTTPS from allowed clients"
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  cidr_blocks       = var.alb_ingress_cidrs
  security_group_id = aws_security_group.alb.id
}

resource "aws_security_group_rule" "alb_ingress_http_redirect" {
  type              = "ingress"
  description       = "HTTP (redirected to HTTPS)"
  from_port         = 80
  to_port           = 80
  protocol          = "tcp"
  cidr_blocks       = var.alb_ingress_cidrs
  security_group_id = aws_security_group.alb.id
}

resource "aws_security_group_rule" "alb_egress_to_tasks" {
  type                     = "egress"
  description              = "To ECS tasks on the container port"
  from_port                = var.container_port
  to_port                  = var.container_port
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.ecs_tasks.id
  security_group_id        = aws_security_group.alb.id
}

# ── Load balancer ──────────────────────────────────────────────────────────────

resource "aws_lb" "this" {
  name               = "${local.name}-alb"
  internal           = var.alb_internal
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.alb_internal ? aws_subnet.private[*].id : aws_subnet.public[*].id

  drop_invalid_header_fields = true
  enable_deletion_protection = true

  tags = {
    Name = "${local.name}-alb"
  }
}

# ── Target group ────────────────────────────────────────────────────────────────

resource "aws_lb_target_group" "api" {
  name        = "${local.name}-api"
  port        = var.container_port
  protocol    = "HTTP"
  vpc_id      = aws_vpc.this.id
  target_type = "ip" # Fargate awsvpc networking registers task ENIs by IP

  health_check {
    enabled             = true
    path                = var.health_check_path
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 3
    unhealthy_threshold = 3
  }

  tags = {
    Name = "${local.name}-api-tg"
  }
}

# ── Listeners ────────────────────────────────────────────────────────────────────

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.acm_certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

resource "aws_lb_listener" "http_redirect" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}
