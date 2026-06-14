/**
 * @rag-chat-agent/audit-logger — public surface.
 *
 * NIST 800-53-format structured audit logging. Build once from validated env via
 * `initAuditLogger`, then `getAuditLogger()` anywhere. Records carry metadata and
 * scores only — never raw query or response text.
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

export type {
  AuditLoggerConfig,
  CloudWatchConfig,
  S3Config,
  SplunkConfig,
} from "./config";
export { DEFAULT_AUDIT_CONFIG } from "./config";

export type { AuditTarget, AuditRecord } from "./targets";

export {
  type FlushableAuditLogger,
  StructuredAuditLogger,
  NoOpAuditLogger,
  createAuditLogger,
  initAuditLogger,
  getAuditLogger,
  resetAuditLogger,
} from "./logger";

export { hashText } from "./hash";
