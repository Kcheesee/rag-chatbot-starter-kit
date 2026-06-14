/**
 * Typed contracts for the audit logger.
 *
 * Events are shaped to map cleanly onto NIST 800-53 audit requirements (AU-2,
 * AU-3, AU-12). The cardinal rule encoded here: events carry *metadata and
 * scores*, never raw query or response text. Hashing and response suppression are
 * enforced by the implementation (Phase 3) based on env flags.
 */

/** Deployment posture, copied onto every event for downstream filtering. */
export type DeploymentMode = "standard" | "federal";

/**
 * Fields present on every audit event. AU-3 ("content of audit records") requires
 * who/what/when/where — `session_id`, `user_id`, `timestamp`, and `environment`
 * cover that without leaking the user's actual question.
 */
export interface BaseAuditEvent {
  /** ISO 8601 timestamp. */
  timestamp: string;
  /** Discriminator, e.g. "query", "ingest", "cache", "security". */
  event_type: string;
  /** Opaque session identifier. */
  session_id: string;
  /** Authenticated user id, when auth is enabled. */
  user_id?: string;
  /** End-to-end latency for the operation, in milliseconds. */
  latency_ms: number;
  /** process.env.NODE_ENV. */
  environment: string;
  /** standard | federal. */
  deployment_mode: DeploymentMode;
}

/** Emitted once per user query handled by the pipeline. */
export interface QueryEvent extends BaseAuditEvent {
  event_type: "query";
  /** sha256(query) when LOG_QUERY_HASHES=true; otherwise omitted. Never raw text. */
  query_hash?: string;
  /** Namespace the query was served from. */
  namespace: string;
  /** Best retrieval similarity score in [0, 1]. */
  retrieval_confidence: number;
  /** Whether the answer was served from the response cache. */
  from_cache: boolean;
  /** Whether the query hit the low-confidence fallback and was flagged for handoff. */
  escalated: boolean;
  /** Number of source chunks cited in the answer. */
  source_count: number;
  /** Resolved model that produced the answer (absent on cache hits / fallbacks). */
  model?: string;
  /** Faithfulness score, when FAITHFULNESS_CHECK=true. */
  faithfulness_score?: number;
}

/** Emitted once per ingest run (per source set / namespace). */
export interface IngestEvent extends BaseAuditEvent {
  event_type: "ingest";
  namespace: string;
  source_type: string;
  files_processed: number;
  chunks_created: number;
  tokens_processed: number;
  errors: number;
  /** Whether PII redaction ran on the ingested content. */
  pii_redacted: boolean;
}

/** Emitted on cache lifecycle events (hit, miss, grounding failure, invalidation). */
export interface CacheEvent extends BaseAuditEvent {
  event_type: "cache";
  namespace: string;
  action: "hit" | "miss" | "grounding_failed" | "store" | "invalidate";
}

/** Emitted on security-relevant events (injection attempts, auth failures, etc.). */
export interface SecurityEvent extends BaseAuditEvent {
  event_type: "security";
  /** Category of the security event. */
  category:
    | "prompt_injection_suspected"
    | "auth_failure"
    | "rate_limit_exceeded"
    | "unauthorized_namespace"
    | "knowledge_poisoning_suspected";
  /** Human-readable, PII-free description of what triggered the event. */
  detail: string;
  /** Source IP or principal, when available and permitted by policy. */
  principal?: string;
}

/**
 * The contract the rest of the repo logs through. A singleton instance is created
 * once from env and imported anywhere; a no-op implementation is provided for tests.
 *
 * Methods are fire-and-forget (`void`, not `Promise`) so logging never blocks the
 * request path. The implementation buffers/flushes to the configured target.
 */
export interface AuditLogger {
  logQuery(event: QueryEvent): void;
  logIngest(event: IngestEvent): void;
  logCacheEvent(event: CacheEvent): void;
  logSecurityEvent(event: SecurityEvent): void;
}

/** Where audit records are emitted. */
export type AuditLogTarget = "console" | "cloudwatch" | "s3" | "splunk";
