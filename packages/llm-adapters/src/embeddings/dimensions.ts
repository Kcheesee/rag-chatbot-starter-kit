/**
 * Best-effort output dimensionality for known embedding models.
 *
 * The vector store ultimately learns the true dimension from the first upsert, but
 * adapters expose `dimensions` so callers (and index provisioning) can validate
 * shape up front. Unknown models fall back to a provider-typical default.
 */
const KNOWN_DIMENSIONS: Record<string, number> = {
  // OpenAI
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
  "text-embedding-ada-002": 1536,
  // Cohere
  "embed-english-v3.0": 1024,
  "embed-multilingual-v3.0": 1024,
  // Voyage
  "voyage-3": 1024,
  "voyage-3-lite": 512,
  "voyage-large-2": 1536,
  // Bedrock (Amazon Titan / Cohere on Bedrock)
  "amazon.titan-embed-text-v2:0": 1024,
  "amazon.titan-embed-text-v1": 1536,
  "cohere.embed-english-v3": 1024,
  // Vertex
  "text-embedding-004": 768,
  "text-multilingual-embedding-002": 768,
};

/** Resolve a model's output dimensionality, or `fallback` if unknown. */
export function dimensionsFor(model: string, fallback: number): number {
  return KNOWN_DIMENSIONS[model] ?? fallback;
}
