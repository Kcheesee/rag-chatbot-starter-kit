/**
 * Typed contracts at the heart of the repo: the pipeline, the grounded response
 * cache, document loaders, the reranker, and the session store.
 *
 * These are the interfaces the apps (web/bot/widget) program against. The concrete
 * pipeline and its 16 guardrail-bearing stages are implemented in Phase 7.
 */

import type { SearchResult } from "@rag-chat-agent/vector-adapters";

/** Input to a single pipeline invocation. */
export interface QueryInput {
  /** The user's raw question. Sanitised inside the pipeline before use. */
  query: string;
  /** Conversation/session identifier. Drives history and per-thread memory. */
  sessionId: string;
  /** Namespace to retrieve from (tenant / RBAC partition). */
  namespace: string;
  /** Authenticated user id, when auth is enabled. */
  userId?: string;
  /** Abort signal, propagated to the LLM stream when a client disconnects. */
  signal?: AbortSignal;
}

/**
 * A citation surfaced to the client. The UI renders these as expandable cards and,
 * in accessible mode, announces them descriptively ("Source 1: returns policy,
 * page 2") rather than as a bare "[1]".
 */
export interface Citation {
  /** 1-based marker matching the `[N]` reference in the answer text. */
  index: number;
  /** Id of the source chunk this citation points at. */
  chunkId: string;
  /** Original file path or URL. */
  sourceFile: string;
  /** Source type (pdf | md | url | ...). */
  sourceType: string;
  /** Page number, when the source is paginated. */
  pageNumber?: number;
  /** Nearest parent heading, when available. */
  heading?: string;
}

/** The final result of a pipeline run. */
export interface RAGResponse {
  /** The generated answer, or the fallback message when confidence is too low. */
  answer: string;
  /** Citations backing the answer. Empty on the low-confidence fallback. */
  sources: Citation[];
  /** Best retrieval similarity score in [0, 1]. */
  confidence: number;
  /** True when served from the response cache. */
  fromCache: boolean;
  /** True when the answer should be handed to a human (low confidence, ungrounded, or unfaithful). */
  escalate: boolean;
  /**
   * Machine-readable reason for `escalate` — e.g. "low_retrieval_confidence",
   * "no_grounded_citations", "faithfulness_below_threshold", "faithfulness_unparseable".
   * Lets a regulated surface decide whether to suppress, badge, or route the answer.
   */
  escalateReason?: string;
  /** End-to-end latency, in milliseconds. */
  latencyMs?: number;
  /** Model that produced the answer (absent on cache hits / fallbacks). */
  model?: string;
}

/**
 * A unit emitted by the streaming pipeline. A discriminated union so consumers can
 * switch exhaustively: tokens stream first, then citations, then a terminal `done`
 * carrying the assembled response (or `error`).
 */
export type StreamChunk =
  | { type: "token"; token: string }
  | { type: "sources"; sources: Citation[] }
  | { type: "done"; response: RAGResponse }
  | { type: "error"; error: string };

/** The contract the apps invoke. */
export interface RAGPipeline {
  /** Run the full pipeline and return the assembled response. */
  query(input: QueryInput): Promise<RAGResponse>;
  /** Run the pipeline, streaming tokens then a terminal response. */
  stream(input: QueryInput): AsyncGenerator<StreamChunk, void, unknown>;
}

/**
 * A reference to a source chunk a cached answer was built from. Stored alongside the
 * cached response so the grounding check can re-verify the source still matches.
 */
export interface SourceChunk {
  chunkId: string;
  /** The chunk's content hash at the time the answer was cached. */
  contentHash: string;
}

/** A response held in the semantic response cache. */
export interface CachedResponse {
  answer: string;
  sources: Citation[];
  /** The chunks this answer was grounded in, for the grounding check. */
  sourceChunks: SourceChunk[];
  /** Model that produced the cached answer. */
  model: string;
  /** ISO 8601 timestamp the entry was written. */
  createdAt: string;
}

/**
 * The grounded response cache.
 *
 * Distinct from an ordinary cache because a hit is not automatically served: the
 * pipeline first re-checks that every `sourceChunk` still exists and still matches
 * its stored `contentHash`. If the knowledge base changed under it, the entry is
 * invalidated and the full pipeline re-runs. See Phase 7.
 */
export interface ResponseCache {
  /** Semantic lookup by query embedding within a namespace. */
  get(embedding: number[], namespace: string): Promise<CachedResponse | null>;
  /** Store a response under its query embedding. */
  set(
    embedding: number[],
    namespace: string,
    response: CachedResponse,
    ttl?: number,
  ): Promise<void>;
  /** Delete a single entry by its internal key. */
  delete(key: string): Promise<void>;
  /** Invalidate every entry in a namespace (called after re-ingest). */
  invalidate(namespace: string): Promise<void>;
}

/** Raw metadata attached to a loaded document, before chunking. */
export interface DocumentMetadata {
  sourceFile: string;
  sourceType: string;
  pageNumber?: number;
  heading?: string;
  [key: string]: string | number | boolean | undefined;
}

/** A document as produced by a loader, before chunking and embedding. */
export interface RAGDocument {
  content: string;
  metadata: DocumentMetadata;
}

/** The contract every document source implements. */
export interface DocumentLoader {
  /** Load and return the source's documents. */
  load(): Promise<RAGDocument[]>;
  /** Source type identifier (pdf | md | url | ...). */
  readonly sourceType: string;
}

/**
 * Reranker contract. Initial retrieval casts wide (top-K); the reranker refines to
 * top-N before generation. This two-stage pattern consistently beats naive top-K.
 */
export interface Reranker {
  rerank(query: string, results: SearchResult[], topN: number): Promise<SearchResult[]>;
}

/** A single turn of conversation history. */
export interface SessionTurn {
  role: "user" | "assistant";
  content: string;
  /** ISO 8601 timestamp. */
  timestamp: string;
}

/**
 * The contract for conversation memory. Two implementations exist: an in-memory
 * store for development and a Redis-backed store for production (Upstash /
 * ElastiCache GovCloud). History is bounded by `SESSION_MAX_TURNS`.
 */
export interface SessionStore {
  /** Return the (bounded) history for a session, oldest first. */
  getHistory(sessionId: string): Promise<SessionTurn[]>;
  /** Append a turn to a session's history. */
  append(sessionId: string, turn: SessionTurn): Promise<void>;
  /** Clear a session's history. */
  clear(sessionId: string): Promise<void>;
}
