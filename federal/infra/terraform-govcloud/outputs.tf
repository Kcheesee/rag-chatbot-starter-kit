###############################################################################
# outputs.tf
###############################################################################

output "alb_dns_name" {
  description = "Public/internal DNS name of the API load balancer. Point your DNS / agency record at this."
  value       = aws_lb.this.dns_name
}

output "alb_zone_id" {
  description = "Route 53 hosted zone ID of the ALB (for alias records)."
  value       = aws_lb.this.zone_id
}

output "aurora_endpoint" {
  description = "Writer endpoint of the Aurora PostgreSQL cluster (PGVECTOR_HOST)."
  value       = aws_rds_cluster.aurora.endpoint
}

output "aurora_reader_endpoint" {
  description = "Reader endpoint of the Aurora PostgreSQL cluster."
  value       = aws_rds_cluster.aurora.reader_endpoint
}

output "redis_primary_endpoint" {
  description = "Primary endpoint address of the Redis replication group (REDIS_HOST)."
  value       = aws_elasticache_replication_group.redis.primary_endpoint_address
}

output "ecs_cluster_name" {
  description = "Name of the ECS cluster."
  value       = aws_ecs_cluster.this.name
}

output "ecs_service_name" {
  description = "Name of the ECS API service."
  value       = aws_ecs_service.api.name
}
