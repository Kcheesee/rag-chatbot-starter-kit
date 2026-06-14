/**
 * `createPipeline(env)` — the primary consumer API.
 *
 * Wires every collaborator from the validated env and returns a ready `RAGPipeline`.
 * The web app, bots, and widget all build their pipeline through this one function,
 * so they share identical wiring and guardrail behaviour. The env-keyed adapter
 * configs are assignable straight from `Env`; only the audit logger needs mapping.
 */

import { initAuditLogger } from "@rag-chat-agent/audit-logger";
import { createEmbeddingAdapter, createLLMAdapter } from "@rag-chat-agent/llm-adapters";
import { createVectorAdapter } from "@rag-chat-agent/vector-adapters";

import { toAuditLoggerConfig, type Env } from "./env";
import type { RAGPipeline } from "./types";
import { RAGPipelineImpl } from "./pipeline";
import { createResponseCache } from "./cache/factory";
import { createSessionStore } from "./session/factory";
import { createReranker } from "./rerank/reranker";
import { createRedisClient } from "./redis-client";

/** Build a fully-wired RAG pipeline from validated env. */
export function createPipeline(env: Env): RAGPipeline {
  const audit = initAuditLogger(toAuditLoggerConfig(env));
  const llm = createLLMAdapter(env);
  const embedder = createEmbeddingAdapter(env);
  const vectorStore = createVectorAdapter(env);

  // One Redis connection, shared by the session store and the response cache.
  const redis = env.SESSION_STORE === "redis" ? createRedisClient(env) : undefined;
  const cache = createResponseCache(env, redis);
  const sessionStore = createSessionStore(env, redis);
  const reranker = createReranker(env);

  return new RAGPipelineImpl(
    { llm, embedder, vectorStore, cache, sessionStore, reranker, audit },
    {
      persona: env.BOT_PERSONA,
      topK: env.TOP_K_RESULTS,
      topN: env.TOP_K_AFTER_RERANK,
      minConfidence: env.MIN_RETRIEVAL_CONFIDENCE,
      maxContextTokens: env.MAX_CONTEXT_TOKENS,
      queryRewrite: env.QUERY_REWRITE,
      faithfulnessCheck: env.FAITHFULNESS_CHECK,
      faithfulnessThreshold: env.FAITHFULNESS_THRESHOLD,
      cacheEnabled: env.CACHE_ENABLED,
      logQueryHashes: env.LOG_QUERY_HASHES,
      environment: env.NODE_ENV,
      deploymentMode: env.DEPLOYMENT_MODE,
      maxTokens: env.MAX_TOKENS,
      temperature: env.TEMPERATURE,
      model: env.LLM_MODEL,
    },
  );
}
