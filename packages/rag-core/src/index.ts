/**
 * @rag-chat-agent/rag-core — public surface.
 *
 * `createPipeline(env)` is the primary consumer API; `loadEnv()` (also on the
 * `./env` subpath) validates the environment. Everything below is exported so the
 * apps can wire pieces directly or swap an implementation behind its interface.
 */

// Typed contracts.
export type {
  QueryInput,
  Citation,
  RAGResponse,
  StreamChunk,
  RAGPipeline,
  SourceChunk,
  CachedResponse,
  ResponseCache,
  DocumentMetadata,
  RAGDocument,
  DocumentLoader,
  Reranker,
  SessionTurn,
  SessionStore,
} from "./types";

// Pipeline.
export { createPipeline } from "./factory";
export {
  RAGPipelineImpl,
  type PipelineConfig,
  type PipelineDeps,
  type NamespacePolicy,
} from "./pipeline";

// Environment.
export {
  loadEnv,
  resetEnvCache,
  toAuditLoggerConfig,
  toNamespacePolicies,
  DEMO_NAMESPACE_POLICIES,
  EnvSchema,
  type Env,
} from "./env";

// Guardrail building blocks.
export { sanitizeInput, type SanitizedInput } from "./sanitize";
export { validateCacheGrounding } from "./cache/grounding";
export {
  buildSystemPrompt,
  buildCitations,
  formatContext,
  extractCitedIndices,
  FALLBACK_ANSWER,
} from "./prompt";
export { estimateTokens } from "./tokens";
export { cosineSimilarity } from "./vectors";

// Cache implementations.
export { InMemoryResponseCache } from "./cache/memory";
export { RedisResponseCache } from "./cache/redis";
export { NoOpResponseCache } from "./cache/noop";
export { createResponseCache } from "./cache/factory";

// Session stores.
export { InMemorySessionStore } from "./session/memory";
export { RedisSessionStore } from "./session/redis";
export { createSessionStore } from "./session/factory";

// Rerankers.
export { HybridReranker, CohereReranker, createReranker } from "./rerank/reranker";

// Shared Redis client.
export { createRedisClient } from "./redis-client";
