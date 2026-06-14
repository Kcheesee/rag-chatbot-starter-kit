/**
 * Process-wide singletons for the validated env and the RAG pipeline.
 *
 * Both are built lazily on first use (not at module load) so `next build` — which
 * imports route modules to collect them — never tries to construct an adapter
 * without credentials. At runtime the pipeline is created once per process and
 * reused across requests, as the spec requires.
 */

import { createPipeline, loadEnv, type Env, type RAGPipeline } from "@rag-chat-agent/rag-core";

let env: Env | null = null;
let pipeline: RAGPipeline | null = null;

/** The validated environment (memoised). */
export function getEnv(): Env {
  if (!env) env = loadEnv();
  return env;
}

/** The shared RAG pipeline (memoised, one per process). */
export function getPipeline(): RAGPipeline {
  if (!pipeline) pipeline = createPipeline(getEnv());
  return pipeline;
}
