/**
 * @rag-chat-agent/llm-adapters — public surface.
 *
 * Two factories are the consumer API: `createLLMAdapter(env)` and
 * `createEmbeddingAdapter(env)`. Every provider lives behind the `LLMAdapter` /
 * `EmbeddingAdapter` interfaces, so switching providers is an env change only.
 */
export type {
  ChatMessage,
  ChatOptions,
  ChatResponse,
  TokenUsage,
  LLMAdapter,
  EmbeddingAdapter,
} from "./types";

export type { LLMConfig, EmbeddingConfig, LLMProvider, EmbeddingProvider } from "./config";
export {
  GOVCLOUD_REGIONS,
  isGovCloudRegion,
  modelSupportsSampling,
  samplingParams,
} from "./config";

export { createLLMAdapter } from "./chat/factory";
export { createEmbeddingAdapter } from "./embeddings/factory";

// Concrete adapters are exported too, for advanced consumers who want to wire one
// up directly or extend it.
export { AnthropicAdapter } from "./chat/anthropic";
export { OpenAIAdapter } from "./chat/openai";
export { BedrockAdapter, BedrockGovAdapter } from "./chat/bedrock";
export { AzureOpenAIAdapter, AzureGovAdapter } from "./chat/azure";
export { VertexAdapter } from "./chat/vertex";
export { InternalAdapter } from "./chat/internal";

export { OpenAIEmbeddingAdapter } from "./embeddings/openai";
export { CohereEmbeddingAdapter } from "./embeddings/cohere";
export { VoyageEmbeddingAdapter } from "./embeddings/voyage";
export { BedrockEmbeddingAdapter } from "./embeddings/bedrock";
export { VertexEmbeddingAdapter } from "./embeddings/vertex";
