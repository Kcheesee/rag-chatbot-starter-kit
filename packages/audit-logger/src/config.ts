/**
 * Audit logger configuration.
 *
 * This package deliberately does NOT read process.env. The application builds this
 * config from its validated env (the one place env is parsed) and passes it to
 * `initAuditLogger`. That keeps the "process.env is read in exactly one module"
 * invariant intact even though the audit logger is a low-level leaf package built
 * before the env schema exists.
 */

import type { AuditLogTarget, DeploymentMode } from "./types";

/** CloudWatch Logs target settings (federal / enterprise). */
export interface CloudWatchConfig {
  region: string;
  logGroup: string;
  logStream: string;
}

/** S3 target settings — audit records written as NDJSON objects. */
export interface S3Config {
  region: string;
  bucket: string;
  /** Key prefix; a timestamped object is written per flush. */
  prefix: string;
}

/** Splunk HTTP Event Collector (HEC) target settings. */
export interface SplunkConfig {
  /** Base URL of the HEC endpoint, e.g. https://splunk.agency.gov:8088. */
  url: string;
  /** HEC token. */
  token: string;
  index?: string;
  sourcetype?: string;
}

/** Fully-resolved audit logger configuration. */
export interface AuditLoggerConfig {
  /** AUDIT_LOG_ENABLED. When false, all emission is a no-op. */
  enabled: boolean;
  /** Where records go. */
  target: AuditLogTarget;
  /** process.env.NODE_ENV, supplied by the app. */
  environment: string;
  /** standard | federal. */
  deploymentMode: DeploymentMode;
  /** LOG_QUERY_HASHES — when false, `query_hash` is stripped before emission. */
  logQueryHashes: boolean;
  /** LOG_RESPONSES — when false, any response text fields are stripped. */
  logResponses: boolean;
  /** AUDIT_LOG_RETENTION_DAYS — informational; targets that manage retention use it. */
  retentionDays: number;
  cloudwatch?: CloudWatchConfig;
  s3?: S3Config;
  splunk?: SplunkConfig;
}

/**
 * Safe default used when `getAuditLogger()` is called before the app initialises
 * one. Emission is disabled, so library code can log unconditionally without
 * producing output until the app opts in via `initAuditLogger`.
 *
 * `environment` falls back to NODE_ENV here only — this is the single, documented
 * place this package touches process.env, and only for a human-readable label.
 */
export const DEFAULT_AUDIT_CONFIG: AuditLoggerConfig = {
  enabled: false,
  target: "console",
  environment: process.env.NODE_ENV ?? "development",
  deploymentMode: "standard",
  logQueryHashes: false,
  logResponses: false,
  retentionDays: 90,
};
