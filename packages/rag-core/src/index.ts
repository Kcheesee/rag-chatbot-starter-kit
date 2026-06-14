/**
 * @rag-chat-agent/rag-core — public surface.
 *
 * Phase 2 exports the typed contracts. The pipeline implementation (the 16 stages,
 * guardrails, grounded cache, session stores) and the env schema land in Phase 7.
 * The validated env schema is also re-exported from the `./env` subpath.
 */
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
