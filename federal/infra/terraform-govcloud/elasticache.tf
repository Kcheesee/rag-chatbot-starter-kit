###############################################################################
# elasticache.tf
#
# ElastiCache Redis replication group for sessions / response cache. Lives in
# the private subnets, encryption in transit AND at rest enabled, AUTH token
# required, and reachable only from the ECS tasks' security group.
###############################################################################

# ── Subnet group ───────────────────────────────────────────────────────────────

resource "aws_elasticache_subnet_group" "redis" {
  name       = "${local.name}-redis"
  subnet_ids = aws_subnet.private[*].id

  tags = {
    Name = "${local.name}-redis-subnets"
  }
}

# ── Security group ─────────────────────────────────────────────────────────────

resource "aws_security_group" "redis" {
  name        = "${local.name}-redis"
  description = "ElastiCache Redis for ${local.name}"
  vpc_id      = aws_vpc.this.id

  tags = {
    Name = "${local.name}-redis"
  }
}

resource "aws_security_group_rule" "redis_ingress_from_ecs" {
  type                     = "ingress"
  description              = "Redis from ECS tasks only"
  from_port                = 6379
  to_port                  = 6379
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.ecs_tasks.id
  security_group_id        = aws_security_group.redis.id
}

# ── KMS key (encryption at rest) ────────────────────────────────────────────────

resource "aws_kms_key" "redis" {
  description             = "KMS key for ${local.name} ElastiCache encryption at rest"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  tags = {
    Name = "${local.name}-redis-kms"
  }
}

resource "aws_kms_alias" "redis" {
  name          = "alias/${local.name}-redis"
  target_key_id = aws_kms_key.redis.key_id
}

# ── Replication group ────────────────────────────────────────────────────────────

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id = "${local.name}-redis"
  description          = "Sessions and response cache for ${local.name}"

  engine         = "redis"
  engine_version = "7.1"
  node_type      = var.redis_node_type
  port           = 6379

  # One node group; primary + replicas. >=1 replica enables automatic failover.
  num_node_groups            = 1
  replicas_per_node_group    = var.redis_num_replicas
  automatic_failover_enabled = var.redis_num_replicas >= 1
  multi_az_enabled           = var.redis_num_replicas >= 1

  subnet_group_name  = aws_elasticache_subnet_group.redis.name
  security_group_ids = [aws_security_group.redis.id]

  # Encryption: at rest (KMS) + in transit (TLS) with AUTH token.
  at_rest_encryption_enabled = true
  kms_key_id                 = aws_kms_key.redis.arn
  transit_encryption_enabled = true
  auth_token                 = var.redis_auth_token

  snapshot_retention_limit = 7
  snapshot_window          = "02:00-03:00"
  maintenance_window       = "sun:05:30-sun:06:30"

  apply_immediately = false

  tags = {
    Name = "${local.name}-redis"
  }

  lifecycle {
    ignore_changes = [auth_token] # rotate via Secrets Manager / AWS, not TF
  }
}
