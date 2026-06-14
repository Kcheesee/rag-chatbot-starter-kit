###############################################################################
# ecs.tf
#
# ECS Fargate cluster, task definition (single API container on container_port),
# service wired to the ALB target group, and the CloudWatch log group.
#
# Secrets are pulled at runtime from Secrets Manager / SSM via the task
# execution role — they are never baked into the image or the env map.
###############################################################################

# ── Cluster ────────────────────────────────────────────────────────────────────

resource "aws_ecs_cluster" "this" {
  name = "${local.name}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = {
    Name = "${local.name}-cluster"
  }
}

resource "aws_ecs_cluster_capacity_providers" "this" {
  cluster_name       = aws_ecs_cluster.this.name
  capacity_providers = ["FARGATE"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
  }
}

# ── Log group ────────────────────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${local.name}/api"
  retention_in_days = var.log_retention_days

  tags = {
    Name = "${local.name}-api-logs"
  }
}

# ── Secrets Manager secrets the container reads at start-up ──────────────────────
# We store the DB and Redis credentials here so the application receives them as
# container "secrets" (resolved by the execution role) rather than plaintext env.

resource "aws_secretsmanager_secret" "db_password" {
  name        = "${local.name}/db-password"
  description = "Aurora master password for ${local.name}"

  tags = {
    Name = "${local.name}-db-password"
  }
}

resource "aws_secretsmanager_secret_version" "db_password" {
  secret_id     = aws_secretsmanager_secret.db_password.id
  secret_string = var.db_password
}

resource "aws_secretsmanager_secret" "redis_auth" {
  name        = "${local.name}/redis-auth-token"
  description = "ElastiCache Redis AUTH token for ${local.name}"

  tags = {
    Name = "${local.name}-redis-auth"
  }
}

resource "aws_secretsmanager_secret_version" "redis_auth" {
  secret_id     = aws_secretsmanager_secret.redis_auth.id
  secret_string = var.redis_auth_token
}

# ── Security group for the tasks ───────────────────────────────────────────────

resource "aws_security_group" "ecs_tasks" {
  name        = "${local.name}-ecs-tasks"
  description = "ECS task ENIs for ${local.name}"
  vpc_id      = aws_vpc.this.id

  tags = {
    Name = "${local.name}-ecs-tasks"
  }
}

resource "aws_security_group_rule" "ecs_ingress_from_alb" {
  type                     = "ingress"
  description              = "Container port from the ALB only"
  from_port                = var.container_port
  to_port                  = var.container_port
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.alb.id
  security_group_id        = aws_security_group.ecs_tasks.id
}

resource "aws_security_group_rule" "ecs_egress_all" {
  type              = "egress"
  description       = "Egress to AWS endpoints, Aurora, Redis, Bedrock (via NAT)"
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.ecs_tasks.id
}

# ── Task definition ─────────────────────────────────────────────────────────────

locals {
  # Resolve the env map into the container-definition shape.
  container_env = [
    for k, v in merge(var.container_environment, {
      PORT              = tostring(var.container_port)
      AWS_REGION        = var.region
      AWS_BEDROCK_MODEL = var.bedrock_model_id
      PGVECTOR_HOST     = aws_rds_cluster.aurora.endpoint
      PGVECTOR_PORT     = tostring(aws_rds_cluster.aurora.port)
      PGVECTOR_DATABASE = var.db_name
      PGVECTOR_USER     = var.db_username
      REDIS_HOST        = aws_elasticache_replication_group.redis.primary_endpoint_address
      REDIS_PORT        = tostring(aws_elasticache_replication_group.redis.port)
      REDIS_TLS         = "true"
    }) : { name = k, value = v }
  ]
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${local.name}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name      = "api"
      image     = var.container_image
      essential = true

      portMappings = [
        {
          containerPort = var.container_port
          protocol      = "tcp"
        },
      ]

      environment = local.container_env

      # Secrets are resolved by the execution role from Secrets Manager and
      # injected as env vars at container start. Never stored in the image.
      secrets = [
        {
          name      = "PGVECTOR_PASSWORD"
          valueFrom = aws_secretsmanager_secret.db_password.arn
        },
        {
          name      = "REDIS_AUTH_TOKEN"
          valueFrom = aws_secretsmanager_secret.redis_auth.arn
        },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.api.name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "api"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "node -e \"fetch('http://localhost:${var.container_port}${var.health_check_path}').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
    },
  ])

  tags = {
    Name = "${local.name}-api-task"
  }
}

# ── Service ──────────────────────────────────────────────────────────────────────

resource "aws_ecs_service" "api" {
  name            = "${local.name}-api"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  enable_execute_command = false # Disable ECS Exec by default in the boundary

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = var.container_port
  }

  # Wait for the ALB listener so registration succeeds on first apply.
  depends_on = [aws_lb_listener.https]

  tags = {
    Name = "${local.name}-api-service"
  }

  lifecycle {
    ignore_changes = [desired_count] # Allow external autoscaling to manage count
  }
}
