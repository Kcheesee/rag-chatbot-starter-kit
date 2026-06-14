/**
 * @rag-chat-agent/llm-adapters — public surface.
 *
 * Phase 2 exports the typed contracts. The provider implementations and the
 * `createLLMAdapter(env)` / `createEmbeddingAdapter(env)` factories land in Phase 4.
 */
export type {
  ChatMessage,
  ChatOptions,
  ChatResponse,
  TokenUsage,
  LLMAdapter,
  EmbeddingAdapter,
} from "./types";
