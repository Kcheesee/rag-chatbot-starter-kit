/**
 * The ingestion pipeline: loaders → chunk → redact → embed → upsert, with cache
 * invalidation and an audit event on completion.
 *
 * PII redaction runs BEFORE embedding and hashing, so the vector store and the
 * cache grounding hash both reflect the redacted text — raw PII never reaches the
 * embedding model or the store.
 */

import type { DocumentLoader, ResponseCache } from "@rag-chat-agent/rag-core";
import type { EmbeddingAdapter } from "@rag-chat-agent/llm-adapters";
import type { EmbeddedChunk, VectorAdapter } from "@rag-chat-agent/vector-adapters";
import type { AuditLogger, DeploymentMode } from "@rag-chat-agent/audit-logger";

import type { Chunk, IngestOptions, IngestResult, PIIEntity, PIIRedactor } from "./types";
import { chunkDocuments, estimateTokens } from "./chunker";
import { sha256Hex } from "./hash";

/** Collaborators the pipeline needs. Pass null/undefined to skip optional ones. */
export interface IngestDeps {
  /** Required for a real ingest; may be omitted for a `dryRun` (no embedding). */
  embedder?: EmbeddingAdapter;
  vectorStore: VectorAdapter;
  /** Invalidated for the namespace after a successful re-ingest. */
  cache?: ResponseCache | null;
  audit?: AuditLogger | null;
  /** When set, chunk text is redacted before embedding. */
  redactor?: PIIRedactor | null;
  /** Embedding batch size (default 64). */
  embedBatchSize?: number;
  /** For the audit event; defaults to NODE_ENV / standard. */
  environment?: string;
  deploymentMode?: DeploymentMode;
}

const DEFAULT_CHUNK_SIZE = 512;
const DEFAULT_CHUNK_OVERLAP = 64;
const DEFAULT_BATCH = 64;

/** Run the full ingest pipeline over a set of loaders. */
export async function ingest(
  loaders: DocumentLoader[],
  options: IngestOptions,
  deps: IngestDeps,
): Promise<IngestResult> {
  const { namespace } = options;
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const chunkOverlap = options.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP;
  const started = Date.now();

  const allChunks: Chunk[] = [];
  const redactCounts = new Map<PIIEntity, number>();
  let filesProcessed = 0;
  let errors = 0;

  for (const loader of loaders) {
    try {
      const docs = await loader.load();
      const chunks = chunkDocuments(docs, { chunkSize, chunkOverlap, namespace });

      if (deps.redactor) {
        for (const chunk of chunks) {
          const { text, entitiesFound } = await deps.redactor.redact(chunk.text);
          chunk.text = text;
          chunk.contentHash = sha256Hex(text);
          chunk.metadata.contentHash = chunk.contentHash;
          for (const { type, count } of entitiesFound) {
            redactCounts.set(type, (redactCounts.get(type) ?? 0) + count);
          }
        }
      }

      allChunks.push(...chunks);
      filesProcessed += 1;
    } catch (err) {
      errors += 1;
      process.stderr.write(`[ingest] loader "${loader.sourceType}" failed: ${String(err)}\n`);
    }
  }

  const tokensProcessed = allChunks.reduce((sum, chunk) => sum + estimateTokens(chunk.text), 0);

  if (!options.dryRun && allChunks.length > 0) {
    if (!deps.embedder) {
      throw new Error("An embedder is required to ingest. Only a dry run may omit it.");
    }
    const embedder = deps.embedder;
    const store = deps.vectorStore.namespace(namespace);
    const batchSize = deps.embedBatchSize ?? DEFAULT_BATCH;
    for (let i = 0; i < allChunks.length; i += batchSize) {
      const batch = allChunks.slice(i, i + batchSize);
      const vectors = await embedder.embed(batch.map((c) => c.text));
      // Fail loudly on a provider/batch misalignment rather than silently storing an
      // empty embedding, which would corrupt retrieval for the affected chunks.
      if (vectors.length !== batch.length) {
        throw new Error(
          `Embedding provider returned ${vectors.length} vectors for ${batch.length} ` +
            `chunks (namespace "${namespace}"). Aborting to avoid corrupt embeddings.`,
        );
      }
      const embedded: EmbeddedChunk[] = batch.map((chunk, j) => ({
        id: chunk.id,
        text: chunk.text,
        embedding: vectors[j],
        metadata: chunk.metadata,
        contentHash: chunk.contentHash,
      }));
      await store.upsert(embedded);
    }
    // The knowledge base changed — drop cached answers for this namespace so the
    // grounding check doesn't have to invalidate them one by one on next query.
    if (deps.cache) await deps.cache.invalidate(namespace);
  }

  const result: IngestResult = {
    filesProcessed,
    chunksCreated: allChunks.length,
    tokensProcessed,
    errors,
    namespace,
    redacted: [...redactCounts.entries()].map(([type, count]) => ({ type, count })),
  };

  deps.audit?.logIngest({
    timestamp: new Date().toISOString(),
    event_type: "ingest",
    session_id: "ingest",
    latency_ms: Date.now() - started,
    environment: deps.environment ?? process.env.NODE_ENV ?? "development",
    deployment_mode: deps.deploymentMode ?? "standard",
    namespace,
    source_type: [...new Set(loaders.map((l) => l.sourceType))].join(","),
    files_processed: filesProcessed,
    chunks_created: allChunks.length,
    tokens_processed: tokensProcessed,
    errors,
    pii_redacted: deps.redactor != null,
  });

  return result;
}
