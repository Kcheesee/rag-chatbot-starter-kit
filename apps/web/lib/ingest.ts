/**
 * Server-side ingest wiring used by the admin ingest route.
 *
 * Builds the embedder, vector store, and (optional) PII redactor from validated env,
 * then runs the ingestion pipeline. File/URL/sitemap sources only here — Notion and
 * Confluence need tokens that aren't in the validated env schema, so those go through
 * the CLI (`scripts/ingest.ts`).
 */

import { initAuditLogger } from "@rag-chat-agent/audit-logger";
import { createEmbeddingAdapter } from "@rag-chat-agent/llm-adapters";
import { createVectorAdapter } from "@rag-chat-agent/vector-adapters";
import { toAuditLoggerConfig } from "@rag-chat-agent/rag-core";
import {
  createLoaders,
  createPIIRedactor,
  ingest,
  type IngestResult,
  type LoaderSecurity,
  type LoaderSourceType,
} from "@rag-chat-agent/ingestion";

import type { Env } from "@rag-chat-agent/rag-core";

import { getEnv } from "./pipeline";

export interface IngestRequest {
  source: string;
  types: LoaderSourceType[];
  namespace: string;
  dryRun?: boolean;
}

/**
 * Build the loader security policy from validated env. This is what confines file
 * ingestion to INGEST_ROOT and blocks SSRF (private networks / off-allowlist hosts)
 * for the url/sitemap loaders. Defaults already block private networks; setting
 * INGEST_ROOT / INGEST_URL_ALLOWLIST tightens it further.
 */
export function toLoaderSecurity(env: Env): LoaderSecurity {
  return {
    allowPrivateNetworks: env.INGEST_ALLOW_PRIVATE_NETWORKS,
    maxBytes: env.INGEST_MAX_BYTES,
    timeoutMs: env.INGEST_TIMEOUT_MS,
    ...(env.INGEST_ROOT ? { ingestRoot: env.INGEST_ROOT } : {}),
    ...(env.INGEST_URL_ALLOWLIST
      ? {
          urlAllowlist: env.INGEST_URL_ALLOWLIST.split(",")
            .map((h) => h.trim())
            .filter(Boolean),
        }
      : {}),
  };
}

export async function runIngest(params: IngestRequest): Promise<IngestResult> {
  const env = getEnv();
  const embedder = createEmbeddingAdapter(env);
  const vectorStore = createVectorAdapter(env);
  const redactor = createPIIRedactor({
    PII_REDACTION_ENABLED: env.PII_REDACTION_ENABLED,
    PII_REDACTION_PROVIDER: env.PII_REDACTION_PROVIDER,
    ...(env.PRESIDIO_URL ? { PRESIDIO_URL: env.PRESIDIO_URL } : {}),
    ...(env.AWS_REGION ? { AWS_REGION: env.AWS_REGION } : {}),
  });
  const audit = initAuditLogger(toAuditLoggerConfig(env));

  const loaders = await createLoaders(params.source, params.types, {}, toLoaderSecurity(env));

  return ingest(
    loaders,
    {
      namespace: params.namespace,
      chunkSize: env.CHUNK_SIZE,
      chunkOverlap: env.CHUNK_OVERLAP,
      ...(params.dryRun ? { dryRun: true } : {}),
    },
    {
      embedder,
      vectorStore,
      audit,
      ...(redactor ? { redactor } : {}),
      environment: env.NODE_ENV,
      deploymentMode: env.DEPLOYMENT_MODE,
      // Cache invalidation is an optimisation only — the pipeline's grounding check
      // is the correctness net for stale cache entries, so no second cache is wired.
    },
  );
}
