/**
 * The audit logger: enriches, redacts, and dispatches events to the configured
 * target. A no-op variant is provided for tests and disabled deployments.
 */

import type {
  AuditLogger,
  BaseAuditEvent,
  CacheEvent,
  IngestEvent,
  QueryEvent,
  SecurityEvent,
} from "./types";
import { DEFAULT_AUDIT_CONFIG, type AuditLoggerConfig } from "./config";
import { createTarget, type AuditRecord, type AuditTarget } from "./targets";

/**
 * An `AuditLogger` whose buffers can be drained. Concrete loggers expose this so
 * the app can flush on shutdown (SIGTERM); the base `AuditLogger` contract stays
 * minimal for callers that only emit.
 */
export interface FlushableAuditLogger extends AuditLogger {
  flush(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Strip fields the deployment's policy forbids before a record leaves the process.
 * This is defence-in-depth: the pipeline already avoids putting raw text in events,
 * but the logger enforces it regardless of caller behaviour.
 */
function redact(event: BaseAuditEvent, config: AuditLoggerConfig): AuditRecord {
  const record: AuditRecord = { ...event };
  if (!config.logQueryHashes) {
    delete record["query_hash"];
  }
  if (!config.logResponses) {
    // No response text is carried today, but guard future fields explicitly.
    delete record["response"];
    delete record["response_text"];
    delete record["answer"];
  }
  return record;
}

/** Emits structured, redacted audit records to a target. */
export class StructuredAuditLogger implements FlushableAuditLogger {
  constructor(
    private readonly config: AuditLoggerConfig,
    private readonly target: AuditTarget,
  ) {}

  logQuery(event: QueryEvent): void {
    this.emit(event);
  }
  logIngest(event: IngestEvent): void {
    this.emit(event);
  }
  logCacheEvent(event: CacheEvent): void {
    this.emit(event);
  }
  logSecurityEvent(event: SecurityEvent): void {
    this.emit(event);
  }

  async flush(): Promise<void> {
    await this.target.flush();
  }
  async close(): Promise<void> {
    await this.target.close();
  }

  private emit(event: BaseAuditEvent): void {
    // `enabled` is also gated in the factory, but guard here too in case a logger
    // is constructed directly.
    if (!this.config.enabled) return;
    this.target.write(redact(event, this.config));
  }
}

/** Does nothing. Used in tests and when AUDIT_LOG_ENABLED=false. */
export class NoOpAuditLogger implements FlushableAuditLogger {
  logQuery(): void {}
  logIngest(): void {}
  logCacheEvent(): void {}
  logSecurityEvent(): void {}
  async flush(): Promise<void> {}
  async close(): Promise<void> {}
}

/**
 * Build a logger from config. When disabled, returns a no-op without constructing
 * any target — so a commercial deployment never instantiates an AWS client.
 */
export function createAuditLogger(config: AuditLoggerConfig): FlushableAuditLogger {
  if (!config.enabled) return new NoOpAuditLogger();
  return new StructuredAuditLogger(config, createTarget(config));
}

// ── Process-wide singleton ──────────────────────────────────────────────────
// Initialised once from validated env at app startup; imported anywhere.

let instance: FlushableAuditLogger | null = null;

/** Initialise the singleton from the app's validated config. Call once at startup. */
export function initAuditLogger(config: AuditLoggerConfig): FlushableAuditLogger {
  instance = createAuditLogger(config);
  return instance;
}

/**
 * Return the singleton, lazily creating a disabled no-op default if the app never
 * called `initAuditLogger`. This means importing modules can log unconditionally
 * without crashing in contexts (tests, scripts) that didn't wire up audit.
 */
export function getAuditLogger(): FlushableAuditLogger {
  if (!instance) instance = createAuditLogger(DEFAULT_AUDIT_CONFIG);
  return instance;
}

/** Reset the singleton. Test-only. */
export function resetAuditLogger(): void {
  instance = null;
}
