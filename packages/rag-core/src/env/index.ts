/**
 * Environment loading and config mapping.
 *
 * `loadEnv()` is the ONE place process.env is read in the whole repo. It fails fast
 * with a readable, multi-line error listing every invalid field. Mappers turn the
 * validated `Env` into the camelCase `AuditLoggerConfig` the audit package expects
 * (the env-keyed adapter configs need no mapping — `Env` is assignable directly).
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { config as loadDotenv } from "dotenv";

import type { AuditLoggerConfig } from "@rag-chat-agent/audit-logger";

import { EnvSchema, type Env } from "./schema";

export { EnvSchema, type Env } from "./schema";

let cached: Env | null = null;
let envFilesLoaded = false;

/**
 * Load `.env.local` then `.env` from the monorepo ROOT into process.env (without
 * overriding anything already set), once per process.
 *
 * WHY this exists: Next.js only auto-loads env files from the app directory
 * (`apps/web/`), and the tsx CLIs (`npm run seed`/`ingest`) load none at all — so the
 * documented "put your keys in a root `.env.local`" only works because we load it
 * here. `loadEnv()` is the single entry point both the web server (via
 * instrumentation) and the scripts go through, so this is the right seam.
 */
function loadRootEnvFiles(): void {
  if (envFilesLoaded) return;
  envFilesLoaded = true;

  // Find the repo root by walking up for turbo.json (unique to the workspace root);
  // fall back to cwd if not found (e.g. the package used standalone).
  let dir = process.cwd();
  let root = process.cwd();
  for (;;) {
    if (existsSync(join(dir, "turbo.json"))) {
      root = dir;
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // `.env.local` wins over `.env`; neither overrides a variable already in the
  // environment (real shell/secret-manager values take precedence over files).
  loadDotenv({ path: [join(root, ".env.local"), join(root, ".env")], override: false });
}

/** Drop empty-string values so optionals fall back to their schema defaults. */
function dropEmpty(source: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value !== "") out[key] = value;
  }
  return out;
}

function parse(source: Record<string, string | undefined>): Env {
  const result = EnvSchema.safeParse(dropEmpty(source));
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment configuration — the app will not start:\n${issues}\n` +
        `See CONFIG.md for the full reference.`,
    );
  }
  return result.data;
}

/**
 * Validate and return the environment. With no argument it reads (and memoises)
 * process.env; pass an explicit source (e.g. in tests) to parse without caching.
 */
export function loadEnv(source?: Record<string, string | undefined>): Env {
  if (source) return parse(source);
  if (!cached) {
    loadRootEnvFiles();
    cached = parse(process.env);
  }
  return cached;
}

/** Clear the memoised env. Test-only. */
export function resetEnvCache(): void {
  cached = null;
}

/** Map the validated env to the audit logger's camelCase config. */
export function toAuditLoggerConfig(env: Env): AuditLoggerConfig {
  return {
    enabled: env.AUDIT_LOG_ENABLED,
    target: env.AUDIT_LOG_TARGET,
    environment: env.NODE_ENV,
    deploymentMode: env.DEPLOYMENT_MODE,
    logQueryHashes: env.LOG_QUERY_HASHES,
    logResponses: env.LOG_RESPONSES,
    retentionDays: env.AUDIT_LOG_RETENTION_DAYS,
    ...(env.AUDIT_LOG_TARGET === "cloudwatch" &&
    env.AWS_REGION &&
    env.AUDIT_CLOUDWATCH_LOG_GROUP &&
    env.AUDIT_CLOUDWATCH_LOG_STREAM
      ? {
          cloudwatch: {
            region: env.AWS_REGION,
            logGroup: env.AUDIT_CLOUDWATCH_LOG_GROUP,
            logStream: env.AUDIT_CLOUDWATCH_LOG_STREAM,
          },
        }
      : {}),
    ...(env.AUDIT_LOG_TARGET === "s3" && env.AWS_REGION && env.AUDIT_S3_BUCKET
      ? { s3: { region: env.AWS_REGION, bucket: env.AUDIT_S3_BUCKET, prefix: env.AUDIT_S3_PREFIX } }
      : {}),
    ...(env.AUDIT_LOG_TARGET === "splunk" && env.AUDIT_SPLUNK_URL && env.AUDIT_SPLUNK_TOKEN
      ? { splunk: { url: env.AUDIT_SPLUNK_URL, token: env.AUDIT_SPLUNK_TOKEN } }
      : {}),
  };
}
