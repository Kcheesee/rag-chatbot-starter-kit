###############################################################################
# vpc.tf
#
# VPC with public + private subnets across `az_count` AZs, an internet gateway,
# one NAT gateway per AZ, and the associated route tables. Raw resources are
# used (rather than the community module) so the boundary is fully explicit and
# easy to review for the ATO package.
###############################################################################

locals {
  name = var.project_name

  # Carve /20 public + /20 private subnets out of the VPC CIDR, one pair per AZ.
  azs = slice(data.aws_availability_zones.available.names, 0, var.az_count)

  public_subnet_cidrs = [
    for i in range(var.az_count) : cidrsubnet(var.vpc_cidr, 4, i)
  ]
  private_subnet_cidrs = [
    for i in range(var.az_count) : cidrsubnet(var.vpc_cidr, 4, i + 8)
  ]
}

data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "${local.name}-vpc"
  }
}

# ── Internet gateway (egress/ingress for public subnets) ──────────────────────

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id

  tags = {
    Name = "${local.name}-igw"
  }
}

# ── Public subnets ────────────────────────────────────────────────────────────

resource "aws_subnet" "public" {
  count = var.az_count

  vpc_id                  = aws_vpc.this.id
  cidr_block              = local.public_subnet_cidrs[count.index]
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = false # ALB gets EIPs via the service; no auto-public IPs

  tags = {
    Name = "${local.name}-public-${local.azs[count.index]}"
    Tier = "public"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id

  tags = {
    Name = "${local.name}-public-rt"
  }
}

resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.this.id
}

resource "aws_route_table_association" "public" {
  count = var.az_count

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# ── Private subnets (ECS tasks, Aurora, ElastiCache) ──────────────────────────

resource "aws_subnet" "private" {
  count = var.az_count

  vpc_id            = aws_vpc.this.id
  cidr_block        = local.private_subnet_cidrs[count.index]
  availability_zone = local.azs[count.index]

  tags = {
    Name = "${local.name}-private-${local.azs[count.index]}"
    Tier = "private"
  }
}

# ── NAT gateways (one per AZ for HA egress) ───────────────────────────────────

resource "aws_eip" "nat" {
  count = var.az_count

  domain = "vpc"

  tags = {
    Name = "${local.name}-nat-eip-${local.azs[count.index]}"
  }

  depends_on = [aws_internet_gateway.this]
}

resource "aws_nat_gateway" "this" {
  count = var.az_count

  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id

  tags = {
    Name = "${local.name}-nat-${local.azs[count.index]}"
  }

  depends_on = [aws_internet_gateway.this]
}

resource "aws_route_table" "private" {
  count = var.az_count

  vpc_id = aws_vpc.this.id

  tags = {
    Name = "${local.name}-private-rt-${local.azs[count.index]}"
  }
}

resource "aws_route" "private_nat" {
  count = var.az_count

  route_table_id         = aws_route_table.private[count.index].id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.this[count.index].id
}

resource "aws_route_table_association" "private" {
  count = var.az_count

  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

# ── VPC Flow Logs (NIST 800-53 AU-2 / SC-7 — capture all traffic) ────────────

resource "aws_cloudwatch_log_group" "vpc_flow" {
  name              = "/aws/vpc/${local.name}/flow-logs"
  retention_in_days = var.log_retention_days

  tags = {
    Name = "${local.name}-vpc-flow-logs"
  }
}

resource "aws_iam_role" "vpc_flow" {
  name = "${local.name}-vpc-flow-logs"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "vpc-flow-logs.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "vpc_flow" {
  name = "${local.name}-vpc-flow-logs"
  role = aws_iam_role.vpc_flow.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:DescribeLogGroups",
        "logs:DescribeLogStreams",
      ]
      Resource = "${aws_cloudwatch_log_group.vpc_flow.arn}:*"
    }]
  })
}

resource "aws_flow_log" "this" {
  vpc_id                   = aws_vpc.this.id
  traffic_type             = "ALL"
  log_destination_type     = "cloud-watch-logs"
  log_destination          = aws_cloudwatch_log_group.vpc_flow.arn
  iam_role_arn             = aws_iam_role.vpc_flow.arn
  max_aggregation_interval = 60

  tags = {
    Name = "${local.name}-flow-log"
  }
}
