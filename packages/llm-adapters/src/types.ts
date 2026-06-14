/**
 * Typed contracts for the LLM and embedding provider layer.
 *
 * Why this exists: the whole repo is config-driven — switching from Anthropic to
 * Bedrock GovCloud must be an env change, never a code change. Every provider is
 * hidden behind one of these interfaces, so `rag-core` and the apps depend only on
 * the shape, never on a concrete SDK. The factory functions (`createLLMAdapter`,
 * `createEmbeddingAdapter`) are the only place a provider is chosen.
 */

/** A single message in a chat exchange. The system prompt is passed separately. */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Per-call generation options. Defaults come from validated env, not hardcoded. */
export interface ChatOptions {
  /** Server-controlled system prompt. Assembled by rag-core; never user-supplied. */
  system?: string;
  /** Hard ceiling on output tokens. */
  maxTokens?: number;
  /** Sampling temperature. Pipeline-internal calls use low values for determinism. */
  temperature?: number;
  /** Optional stop sequences. */
  stop?: string[];
  /** Abort signal so streaming requests can be cancelled when a client disconnects. */
  signal?: AbortSignal;
}

/** Token usage for a single generation, when the provider reports it. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Result of a non-streaming `chat()` call. */
export interface ChatResponse {
  content: string;
  model: string;
  usage?: TokenUsage;
  /** Provider-reported stop reason, normalised where possible. */
  finishReason?: "stop" | "length" | "content_filter" | "tool_use" | "unknown";
}

/**
 * The contract every LLM provider implements.
 *
 * `stream()` yields raw text deltas (token strings) and is what the web app and
 * widget consume. `chat()` is the non-streaming path used for internal pipeline
 * calls — query rewrite and faithfulness scoring — where we want the whole answer
 * before continuing.
 */
export interface LLMAdapter {
  /** One-shot completion. Used for internal pipeline steps. */
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>;
  /** Streaming completion. Yields text deltas as they arrive. */
  stream(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<string, void, unknown>;
  /** Provider identifier, e.g. `"anthropic"`, `"bedrock-gov"`. */
  readonly provider: string;
  /** Resolved model identifier the adapter will call. */
  readonly model: string;
}

/**
 * The contract every embedding provider implements.
 *
 * Embeddings are deliberately a separate interface from chat: a deployment can run
 * Claude for generation while embedding with OpenAI, Cohere, Voyage, or a GovCloud
 * model. `dimensions` is exposed so the vector store can validate index shape.
 */
export interface EmbeddingAdapter {
  /** Embed a batch of texts. Used by ingestion to embed many chunks at once. */
  embed(texts: string[]): Promise<number[][]>;
  /** Embed a single text. Used by the pipeline to embed an incoming query. */
  embedOne(text: string): Promise<number[]>;
  /** Provider identifier, e.g. `"openai"`, `"bedrock"`. */
  readonly provider: string;
  /** Resolved embedding model identifier. */
  readonly model: string;
  /** Output vector dimensionality. Must match the vector store's index. */
  readonly dimensions: number;
}
