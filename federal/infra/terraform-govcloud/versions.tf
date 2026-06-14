###############################################################################
# versions.tf
#
# Terraform + provider version pins and the AWS provider configuration for the
# AWS GovCloud (US) partition.
#
# STARTING TEMPLATE — review and harden for your agency's ATO. See README.md.
###############################################################################

terraform {
  required_version = ">= 1.6.0, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # ---------------------------------------------------------------------------
  # Remote state is intentionally left for the agency to wire up. Federal
  # deployments MUST keep state inside the authorization boundary (a GovCloud
  # S3 bucket with SSE-KMS + a DynamoDB lock table), never in a commercial
  # account. Uncomment and fill in, or pass via `-backend-config`.
  # ---------------------------------------------------------------------------
  # backend "s3" {
  #   bucket         = "my-agency-tfstate-govcloud"
  #   key            = "rag-chat-agent/federal/terraform.tfstate"
  #   region         = "us-gov-west-1"
  #   dynamodb_table = "my-agency-tfstate-locks"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.region

  # Every resource created by this module is tagged for the federal tier so it
  # can be inventoried and reported on during continuous monitoring.
  default_tags {
    tags = merge(
      {
        deployment_mode = "federal"
        project         = var.project_name
        managed_by      = "terraform"
      },
      var.tags,
    )
  }
}
