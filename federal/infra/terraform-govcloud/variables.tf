###############################################################################
# variables.tf
#
# Inputs for the federal GovCloud stack. Secret values have NO defaults and are
# marked sensitive — supply them via a TF_VAR_* env var, a tfvars file kept out
# of version control, or (preferred) a CI/CD secret store inside the boundary.
###############################################################################

# ── Core / location ─────────────────────────────────────────────────────────

variable "region" {
  description = "AWS GovCloud region to deploy into."
  type        = string
  default     = "us-gov-west-1"

  validation {
    condition     = can(regex("^us-gov-", var.region))
    error_message = "Federal deployments must use a GovCloud region (us-gov-*)."
  }
}

variable "project_name" {
  description = "Short project/system name used as a prefix for resource names and tags."
  type        = string
  default     = "rag-chat-agent"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,30}$", var.project_name))
    error_message = "project_name must be lowercase alphanumeric/hyphen, 2-31 chars, starting with a letter."
  }
}

variable "tags" {
  description = "Additional tags merged into the provider default_tags block."
  type        = map(string)
  default     = {}
}

# ── Networking ───────────────────────────────────────────────────────────────

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.50.0.0/16"

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0))
    error_message = "vpc_cidr must be a valid IPv4 CIDR block."
  }
}

variable "az_count" {
  description = "Number of Availability Zones to spread subnets across."
  type        = number
  default     = 2

  validation {
    condition     = var.az_count >= 2 && var.az_count <= 3
    error_message = "az_count must be 2 or 3 for a resilient federal deployment."
  }
}

# ── ALB / TLS ─────────────────────────────────────────────────────────────────

variable "alb_internal" {
  description = "If true the ALB is internal (no public IPs). Set true when fronted by API Gateway / a transit boundary; false for a directly internet-facing endpoint."
  type        = bool
  default     = false
}

variable "acm_certificate_arn" {
  description = "ARN of an ACM certificate in this region for the HTTPS 443 listener."
  type        = string

  validation {
    condition     = can(regex("^arn:aws-us-gov:acm:", var.acm_certificate_arn))
    error_message = "acm_certificate_arn must be an ACM cert ARN in the aws-us-gov partition."
  }
}

variable "alb_ingress_cidrs" {
  description = "CIDR blocks allowed to reach the ALB on 443. Restrict this for internal/agency-only access."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "health_check_path" {
  description = "HTTP path the target group uses for health checks."
  type        = string
  default     = "/api/health"
}

# ── ECS / container ───────────────────────────────────────────────────────────

variable "container_image" {
  description = "Fully-qualified container image URI (e.g. an ECR GovCloud repo URI with tag/digest)."
  type        = string
}

variable "container_port" {
  description = "Port the API container listens on."
  type        = number
  default     = 3000
}

variable "desired_count" {
  description = "Number of ECS service tasks to run."
  type        = number
  default     = 2
}

variable "task_cpu" {
  description = "Fargate task CPU units (e.g. 512, 1024, 2048)."
  type        = number
  default     = 1024
}

variable "task_memory" {
  description = "Fargate task memory in MiB (must be valid for the chosen CPU)."
  type        = number
  default     = 2048
}

variable "container_environment" {
  description = "Non-secret environment variables injected into the container as a name=>value map."
  type        = map(string)
  default = {
    NODE_ENV              = "production"
    DEPLOYMENT_MODE       = "federal"
    LLM_PROVIDER          = "bedrock-gov"
    VECTOR_STORE          = "pgvector"
    PGVECTOR_SSL          = "require"
    SESSION_STORE         = "redis"
    AUDIT_LOG_ENABLED     = "true"
    AUDIT_LOG_TARGET      = "cloudwatch"
    PII_REDACTION_ENABLED = "true"
    A11Y_MODE             = "true"
  }
}

variable "bedrock_model_id" {
  description = "Bedrock model id the task role is permitted to invoke (GovCloud Claude)."
  type        = string
  default     = "anthropic.claude-sonnet-4-6"
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention. Federal audit retention is often 1095 days (3 years)."
  type        = number
  default     = 1095
}

# ── Database (Aurora PostgreSQL / pgvector) ────────────────────────────────────

variable "db_name" {
  description = "Initial database name created on the Aurora cluster."
  type        = string
  default     = "rag"
}

variable "db_username" {
  description = "Master username for the Aurora cluster."
  type        = string
  default     = "rag_admin"
}

variable "db_password" {
  description = "Master password for the Aurora cluster. No default — supply at runtime, never commit."
  type        = string
  sensitive   = true
}

variable "db_min_acu" {
  description = "Aurora Serverless v2 minimum capacity (ACUs)."
  type        = number
  default     = 0.5
}

variable "db_max_acu" {
  description = "Aurora Serverless v2 maximum capacity (ACUs)."
  type        = number
  default     = 8
}

variable "db_instance_count" {
  description = "Number of Aurora instances (1 writer + N-1 readers)."
  type        = number
  default     = 2
}

variable "db_deletion_protection" {
  description = "Enable deletion protection on the Aurora cluster."
  type        = bool
  default     = true
}

# ── ElastiCache (Redis) ────────────────────────────────────────────────────────

variable "redis_node_type" {
  description = "ElastiCache node type for the Redis replication group."
  type        = string
  default     = "cache.t3.medium"
}

variable "redis_num_replicas" {
  description = "Number of read replicas per node group (0 = primary only; >=1 enables Multi-AZ failover)."
  type        = number
  default     = 1
}

variable "redis_auth_token" {
  description = "AUTH token (password) for Redis. Required because transit encryption is enabled. No default — supply at runtime."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.redis_auth_token) >= 16
    error_message = "redis_auth_token must be at least 16 characters."
  }
}
