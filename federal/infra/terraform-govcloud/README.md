# terraform-govcloud — Federal (Tier 3) infrastructure

Terraform module that provisions the `rag-chat-agent` federal stack inside the
**AWS GovCloud (US)** boundary (`us-gov-west-1` by default):

- **VPC** — 2+ AZs, public + private subnets, IGW, per-AZ NAT gateways, VPC Flow Logs
- **ALB** — HTTPS-only (TLS 1.2/1.3) with an ACM cert; HTTP redirects to HTTPS
- **ECS Fargate** — API container on port `3000`, secrets pulled from Secrets Manager
- **Aurora PostgreSQL (Serverless v2)** — pgvector store, encrypted, SSL enforced
- **ElastiCache Redis** — sessions/cache, encryption in transit + at rest, AUTH token
- **IAM** — least-privilege task roles (Bedrock invoke, CloudWatch Logs, Secrets Manager read, Comprehend `DetectPiiEntities`); no static keys

Everything is tagged `deployment_mode = "federal"` via the provider
`default_tags` block.

---

> ## ⚠️ This is a STARTING TEMPLATE — not an authorized baseline
>
> This module is a head start, not an ATO. It must be **reviewed and hardened**
> by your agency's security team and signed off by the ISSO before it carries
> live workloads. Things you are expected to own before production:
>
> - Independent security assessment against your NIST 800-53 control baseline
>   (see `federal/compliance/controls-matrix.md`)
> - Remote state inside the boundary (GovCloud S3 + KMS + DynamoDB lock table)
>   — see the commented `backend "s3"` block in `versions.tf`
> - Secret rotation via Secrets Manager rotation lambdas (the module seeds the
>   secrets but does not rotate them)
> - WAF / Shield, GuardDuty, Config rules, Security Hub, and SCP guardrails
> - Tightening `alb_ingress_cidrs` (defaults to `0.0.0.0/0`) to agency ranges
> - Confirming the chosen Bedrock model and engine versions are available and
>   authorized in your GovCloud region/account
>
> Templates accelerate the process. They do not replace it.

---

## Prerequisites

- Terraform `>= 1.6`, AWS provider `~> 5.0`
- Credentials for a GovCloud account assumed via SSO / role (no static keys)
- An **ACM certificate** in the target region for the API hostname
- A container image published to a **GovCloud ECR** repository
- Aurora `vector` extension enabled post-deploy (see below)

## Required variables (no safe defaults)

| Variable | Notes |
|---|---|
| `acm_certificate_arn` | ACM cert ARN in `aws-us-gov` for the 443 listener |
| `container_image` | Fully-qualified image URI (ECR GovCloud) |
| `db_password` | **sensitive** — Aurora master password |
| `redis_auth_token` | **sensitive** — Redis AUTH token (>= 16 chars) |

Supply secrets via environment, never in a committed `.tfvars`:

```bash
export TF_VAR_db_password='...'
export TF_VAR_redis_auth_token='...'
```

Common non-secret overrides go in a `terraform.tfvars` (safe to commit if it
contains no secrets), e.g.:

```hcl
project_name        = "rag-chat-agent"
region              = "us-gov-west-1"
acm_certificate_arn = "arn:aws-us-gov:acm:us-gov-west-1:111122223333:certificate/abc-123"
container_image     = "111122223333.dkr.ecr.us-gov-west-1.amazonaws.com/rag-chat-agent:1.0.0"
alb_ingress_cidrs   = ["10.0.0.0/8"]   # tighten from the 0.0.0.0/0 default
desired_count       = 2
```

## Usage

```bash
# from federal/infra/terraform-govcloud/
terraform init        # add -backend-config=... for the GovCloud S3 backend
terraform fmt -check   # formatting gate
terraform validate     # static validation
terraform plan -out tfplan
terraform apply tfplan
```

## Post-deploy: enable pgvector

Terraform creates the cluster but **does not** enable the extension. Connect to
the writer endpoint **over SSL** (the cluster enforces `rds.force_ssl=1`) and
run, once per database:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Then run the application's schema/migration step to create the
`PGVECTOR_TABLE` (default `rag_chunks`) and its index.

## Outputs

| Output | Use |
|---|---|
| `alb_dns_name` | DNS target for the API endpoint |
| `aurora_endpoint` | `PGVECTOR_HOST` for the app |
| `redis_primary_endpoint` | `REDIS_HOST` for the app |

See `federal/.env.federal.example` and the root `README.md` "Federal
deployment" section for how these wire into the application config.
