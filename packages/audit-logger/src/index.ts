/**
 * @rag-chat-agent/audit-logger — public surface.
 *
 * Phase 2 exports the typed event contracts. The singleton emitter, target
 * backends (console/CloudWatch/S3/Splunk), and no-op test logger land in Phase 3.
 */
export type {
  DeploymentMode,
  BaseAuditEvent,
  QueryEvent,
  IngestEvent,
  CacheEvent,
  SecurityEvent,
  AuditLogger,
  AuditLogTarget,
} from "./types";
