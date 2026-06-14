###############################################################################
# aurora.tf
#
# Aurora PostgreSQL (Serverless v2) cluster for the pgvector store. Lives in the
# private subnets, encrypted at rest, SSL/TLS enforced via a custom parameter
# group, and reachable only from the ECS tasks' security group.
#
# IMPORTANT: the `vector` extension is NOT created by Terraform. After the
# cluster is up, connect (over SSL) and run, once per database:
#
#     CREATE EXTENSION IF NOT EXISTS vector;
#
# Aurora PostgreSQL 15.x+ ships pgvector in its available extensions list; no
# superuser is required for the rds_superuser-owned role to enable it. Run this
# as part of your DB bootstrap / migration step, not via this IaC.
###############################################################################

# ── Subnet group ───────────────────────────────────────────────────────────────

resource "aws_db_subnet_group" "aurora" {
  name       = "${local.name}-aurora"
  subnet_ids = aws_subnet.private[*].id

  tags = {
    Name = "${local.name}-aurora-subnets"
  }
}

# ── Security group ─────────────────────────────────────────────────────────────

resource "aws_security_group" "aurora" {
  name        = "${local.name}-aurora"
  description = "Aurora PostgreSQL for ${local.name}"
  vpc_id      = aws_vpc.this.id

  tags = {
    Name = "${local.name}-aurora"
  }
}

resource "aws_security_group_rule" "aurora_ingress_from_ecs" {
  type                     = "ingress"
  description              = "PostgreSQL from ECS tasks only"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.ecs_tasks.id
  security_group_id        = aws_security_group.aurora.id
}

# No egress rule needed beyond the implicit default; Aurora does not initiate
# outbound connections in this design.

# ── KMS key (encryption at rest) ────────────────────────────────────────────────

resource "aws_kms_key" "aurora" {
  description             = "KMS key for ${local.name} Aurora encryption at rest"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  tags = {
    Name = "${local.name}-aurora-kms"
  }
}

resource "aws_kms_alias" "aurora" {
  name          = "alias/${local.name}-aurora"
  target_key_id = aws_kms_key.aurora.key_id
}

# ── Cluster parameter group: force SSL ──────────────────────────────────────────

resource "aws_rds_cluster_parameter_group" "aurora" {
  name        = "${local.name}-aurora-pg15"
  family      = "aurora-postgresql15"
  description = "Force SSL/TLS and log connections for ${local.name}"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  parameter {
    name  = "log_connections"
    value = "1"
  }

  parameter {
    name  = "log_disconnections"
    value = "1"
  }

  tags = {
    Name = "${local.name}-aurora-pg"
  }
}

# ── Cluster + instances (Serverless v2) ──────────────────────────────────────────

resource "aws_rds_cluster" "aurora" {
  cluster_identifier = "${local.name}-aurora"
  engine             = "aurora-postgresql"
  engine_mode        = "provisioned" # required for Serverless v2 scaling config
  engine_version     = "15.4"

  database_name   = var.db_name
  master_username = var.db_username
  master_password = var.db_password
  port            = 5432

  db_subnet_group_name            = aws_db_subnet_group.aurora.name
  vpc_security_group_ids          = [aws_security_group.aurora.id]
  db_cluster_parameter_group_name = aws_rds_cluster_parameter_group.aurora.name

  storage_encrypted = true
  kms_key_id        = aws_kms_key.aurora.arn

  iam_database_authentication_enabled = true

  backup_retention_period      = 14
  preferred_backup_window      = "03:00-04:00"
  preferred_maintenance_window = "sun:04:30-sun:05:30"
  copy_tags_to_snapshot        = true

  deletion_protection       = var.db_deletion_protection
  skip_final_snapshot       = false
  final_snapshot_identifier = "${local.name}-aurora-final"

  enabled_cloudwatch_logs_exports = ["postgresql"]

  serverlessv2_scaling_configuration {
    min_capacity = var.db_min_acu
    max_capacity = var.db_max_acu
  }

  tags = {
    Name = "${local.name}-aurora"
  }

  lifecycle {
    ignore_changes = [master_password] # rotate via Secrets Manager, not TF
  }
}

resource "aws_rds_cluster_instance" "aurora" {
  count = var.db_instance_count

  identifier         = "${local.name}-aurora-${count.index}"
  cluster_identifier = aws_rds_cluster.aurora.id
  instance_class     = "db.serverless"
  engine             = aws_rds_cluster.aurora.engine
  engine_version     = aws_rds_cluster.aurora.engine_version

  db_subnet_group_name = aws_db_subnet_group.aurora.name

  performance_insights_enabled    = true
  performance_insights_kms_key_id = aws_kms_key.aurora.arn
  monitoring_interval             = 60
  monitoring_role_arn             = aws_iam_role.rds_monitoring.arn

  # First instance is the writer; subsequent ones are readers.
  promotion_tier = count.index

  tags = {
    Name = "${local.name}-aurora-${count.index}"
  }
}
