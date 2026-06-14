/**
 * @rag-chat-agent/vector-adapters — public surface.
 *
 * Phase 2 exports the typed contracts. The Chroma/Pinecone/pgvector/Weaviate
 * implementations and the `createVectorAdapter(env)` factory land in Phase 5.
 */
export type {
  ChunkMetadata,
  EmbeddedChunk,
  StoredChunk,
  SearchResult,
  MetadataFilter,
  VectorAdapter,
} from "./types";
