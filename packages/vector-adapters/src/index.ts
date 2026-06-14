/**
 * @rag-chat-agent/vector-adapters — public surface.
 *
 * `createVectorAdapter(env)` is the consumer API. Every store lives behind the
 * `VectorAdapter` interface, so switching stores is an env change only. Adapters
 * lazily import their client SDK, so a deployment loads only the one it uses.
 */
export type {
  ChunkMetadata,
  EmbeddedChunk,
  StoredChunk,
  SearchResult,
  MetadataFilter,
  VectorAdapter,
} from "./types";

export type { VectorStore, VectorStoreConfig, PgSslMode } from "./config";
export { DEFAULT_NAMESPACE, DEFAULT_PREFIX, sanitizeNamespace } from "./config";

export {
  type FlatMetadata,
  toFlatMetadata,
  fromFlatMetadata,
  toStoredChunk,
  toSearchResult,
} from "./metadata";

export { createVectorAdapter } from "./factory";

// Concrete adapters, for advanced consumers wiring one up directly.
export { ChromaAdapter } from "./chroma";
export { PineconeAdapter } from "./pinecone";
export { PgVectorAdapter } from "./pgvector";
export { WeaviateAdapter } from "./weaviate";
