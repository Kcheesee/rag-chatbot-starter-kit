/**
 * Provider selection and the config the adapters need.
 *
 * Like every package below the env schema, this one does NOT read process.env.
 * `LLMConfig` / `EmbeddingConfig` use the env-variable key names so the validated
 * `Env` object (Phase 7) is structurally assignable — `createLLMAdapter(env)` then
 * "just works" while keeping this package a leaf with no dependency on rag-core.
 */

/** Chat providers, spanning the three credential tiers. */
export type LLMProvider =
  | "anthropic"
  | "openai"
  | "bedrock"
  | "vertex"
  | "azure-openai"
  | "bedrock-gov"
  | "azure-gov"
  | "internal";

/** Embedding providers. */
export type EmbeddingProvider = "openai" | "cohere" | "voyage" | "bedrock" | "vertex";

/** Subset of env needed to build a chat adapter. Keys match the env var names. */
export interface LLMConfig {
  LLM_PROVIDER: LLMProvider;
  LLM_MODEL: string;
  MAX_TOKENS?: number;
  TEMPERATURE?: number;

  // Tier 1 — direct keys
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;

  // Tier 2/3 — Bedrock (+ GovCloud)
  AWS_REGION?: string;
  AWS_BEDROCK_MODEL?: string;

  // Tier 2 — Vertex AI
  VERTEX_PROJECT?: string;
  VERTEX_LOCATION?: string;
  VERTEX_MODEL?: string;

  // Tier 2/3 — Azure OpenAI (+ Government)
  AZURE_OPENAI_ENDPOINT?: string;
  AZURE_OPENAI_DEPLOYMENT?: string;
  AZURE_OPENAI_API_VERSION?: string;
  AZURE_OPENAI_API_KEY?: string;

  // Tier 3 — internal / 1P (OpenAI-compatible over mTLS)
  INTERNAL_LLM_ENDPOINT?: string;
  INTERNAL_LLM_MODEL?: string;
  INTERNAL_LLM_CERT_PATH?: string;
  INTERNAL_LLM_KEY_PATH?: string;
  /** Optional CA bundle to trust a self-signed agency server cert. */
  INTERNAL_LLM_CA_PATH?: string;
}

/** Subset of env needed to build an embedding adapter. */
export interface EmbeddingConfig {
  EMBEDDING_PROVIDER: EmbeddingProvider;
  EMBEDDING_MODEL: string;
  OPENAI_API_KEY?: string;
  COHERE_API_KEY?: string;
  VOYAGE_API_KEY?: string;
  AWS_REGION?: string;
  VERTEX_PROJECT?: string;
  VERTEX_LOCATION?: string;
}

/** AWS GovCloud regions. `bedrock-gov` must target one of these. */
export const GOVCLOUD_REGIONS = ["us-gov-west-1", "us-gov-east-1"] as const;

/** True when `region` is an AWS GovCloud region. */
export function isGovCloudRegion(region: string | undefined): boolean {
  return region !== undefined && (GOVCLOUD_REGIONS as readonly string[]).includes(region);
}

/**
 * Anthropic models that reject sampling parameters (`temperature`, `top_p`,
 * `top_k`) with a 400. Opus 4.7+, Opus 4.8, and Fable 5 dropped these — only
 * Sonnet 4.6 and older still accept them. Because `LLM_MODEL` is user-configurable,
 * the Anthropic-family adapters consult this before attaching `temperature`, so the
 * boilerplate doesn't break when someone sets `LLM_MODEL=claude-opus-4-8`.
 *
 * Matching is by substring so the rule covers Bedrock/Vertex IDs too
 * (e.g. `anthropic.claude-opus-4-8`).
 */
const NO_SAMPLING_MODEL_MARKERS = ["opus-4-8", "opus-4-7", "fable-5"];

/** Whether `model` accepts `temperature`/`top_p`/`top_k`. */
export function modelSupportsSampling(model: string): boolean {
  const id = model.toLowerCase();
  return !NO_SAMPLING_MODEL_MARKERS.some((marker) => id.includes(marker));
}

/**
 * Build the sampling-parameter slice of a request body. Returns `{ temperature }`
 * only when the model supports it and a temperature is configured — otherwise an
 * empty object, so callers can spread it unconditionally.
 */
export function samplingParams(
  model: string,
  temperature: number | undefined,
): { temperature?: number } {
  if (temperature === undefined) return {};
  if (!modelSupportsSampling(model)) return {};
  return { temperature };
}

/** Throw a clear, CONFIG.md-pointing error for a required-but-missing setting. */
export function requireConfig<T>(value: T | undefined, varName: string, hint: string): T {
  if (value === undefined || value === null || value === "") {
    throw new Error(
      `${varName} is required for the selected provider but was empty. ${hint} ` +
        `See CONFIG.md#llm-provider.`,
    );
  }
  return value;
}
