###############################################################################
# iam.tf
#
# IAM roles. No static access keys anywhere — the ECS service assumes these
# roles via the task/instance identity at runtime, consistent with the Tier 3
# "IAM role — no stored secrets" model.
#
#   * ecs_execution  — pulls the image, writes logs, resolves the container
#                      secrets from Secrets Manager. Used by the ECS agent.
#   * ecs_task       — the application's own permissions: invoke the GovCloud
#                      Claude model on Bedrock, write app logs, read the
#                      app secrets, and call Comprehend DetectPiiEntities.
#   * rds_monitoring — Enhanced Monitoring for the Aurora instances.
###############################################################################

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {} # "aws-us-gov" in GovCloud
data "aws_region" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  partition  = data.aws_partition.current.id
  region     = data.aws_region.current.name

  ecs_assume_role = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = {
        StringEquals = {
          "aws:SourceAccount" = local.account_id
        }
      }
    }]
  })

  # Bedrock foundation-model ARNs the task may invoke (versioned + base id).
  bedrock_model_arns = [
    "arn:${local.partition}:bedrock:${local.region}::foundation-model/${var.bedrock_model_id}",
    "arn:${local.partition}:bedrock:${local.region}::foundation-model/${var.bedrock_model_id}:*",
  ]
}

# ── ECS task execution role ────────────────────────────────────────────────────

resource "aws_iam_role" "ecs_execution" {
  name               = "${local.name}-ecs-execution"
  assume_role_policy = local.ecs_assume_role

  tags = {
    Name = "${local.name}-ecs-execution"
  }
}

# AWS-managed base policy: ECR pull + CloudWatch Logs for the agent.
resource "aws_iam_role_policy_attachment" "ecs_execution_managed" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:${local.partition}:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Allow the execution role to resolve the two container secrets (and decrypt
# them if they use a customer-managed KMS key — here the default AWS key).
resource "aws_iam_role_policy" "ecs_execution_secrets" {
  name = "${local.name}-execution-secrets"
  role = aws_iam_role.ecs_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "ReadContainerSecrets"
      Effect = "Allow"
      Action = ["secretsmanager:GetSecretValue"]
      Resource = [
        aws_secretsmanager_secret.db_password.arn,
        aws_secretsmanager_secret.redis_auth.arn,
      ]
    }]
  })
}

# ── ECS task role (the application identity) ─────────────────────────────────────

resource "aws_iam_role" "ecs_task" {
  name               = "${local.name}-ecs-task"
  assume_role_policy = local.ecs_assume_role

  tags = {
    Name = "${local.name}-ecs-task"
  }
}

resource "aws_iam_role_policy" "ecs_task" {
  name = "${local.name}-task-policy"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # Invoke the GovCloud Claude model on Bedrock (streaming + non-streaming).
        Sid    = "BedrockInvokeClaude"
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
        ]
        Resource = local.bedrock_model_arns
      },
      {
        # PII detection for the federal redaction pipeline. Comprehend's
        # detection actions do not support resource-level scoping.
        Sid    = "ComprehendDetectPii"
        Effect = "Allow"
        Action = [
          "comprehend:DetectPiiEntities",
          "comprehend:ContainsPiiEntities",
        ]
        Resource = "*"
      },
      {
        # Write application + audit logs to its own log group only.
        Sid    = "WriteAppLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]
        Resource = "${aws_cloudwatch_log_group.api.arn}:*"
      },
      {
        # Read the application's own secrets at runtime (DB + Redis creds).
        Sid    = "ReadAppSecrets"
        Effect = "Allow"
        Action = ["secretsmanager:GetSecretValue"]
        Resource = [
          aws_secretsmanager_secret.db_password.arn,
          aws_secretsmanager_secret.redis_auth.arn,
        ]
      },
    ]
  })
}

# ── RDS Enhanced Monitoring role ─────────────────────────────────────────────────

resource "aws_iam_role" "rds_monitoring" {
  name = "${local.name}-rds-monitoring"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "monitoring.rds.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = {
    Name = "${local.name}-rds-monitoring"
  }
}

resource "aws_iam_role_policy_attachment" "rds_monitoring" {
  role       = aws_iam_role.rds_monitoring.name
  policy_arn = "arn:${local.partition}:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}
