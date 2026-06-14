/**
 * Typed contracts for the vector store layer.
 *
 * Why `ChunkMetadata` lives here and not in `ingestion`: both ingestion (which
 * produces chunks) and the vector adapters (which store and return them) need this
 * shape. Defining it in the lower-level package keeps the dependency arrow
 * one-directional (`ingestion` → `vector-adapters`) and avoids a type cycle.
 */

/**
 * Metadata carried by every chunk, from ingestion through storage to retrieval.
 *
 * `contentHash` is load-bearing: the response cache's grounding check compares the
 * hash stored with a cached answer against the chunk's current hash to detect that
 * the source changed since the answer was cached. See `validateCacheGrounding`.
 */
export interface ChunkMetadata {
  /** Original file path or URL the chunk came from. */
  sourceFile: string;
  /** One of: pdf | md | docx | txt | url | sitemap | notion | confluence. */
  sourceType: string;
  /** Zero-based position of this chunk within its source. */
  chunkIndex: number;
  /** Page number, for paginated sources (PDFs). */
  pageNumber?: number;
  /** Nearest parent heading, for structured sources (Markdown/DOCX). */
  heading?: string;
  /** sha256 of the chunk text. Drives the cache grounding check. */
  contentHash: string;
  /** ISO 8601 timestamp of when the chunk was ingested. */
  ingestedAt: string;
  /** Namespace this chunk belongs to (multi-tenant / RBAC isolation). */
  namespace: string;
}

/** A chunk ready to be written to the store: text + vector + metadata. */
export interface EmbeddedChunk {
  id: string;
  text: string;
  embedding: number[];
  metadata: ChunkMetadata;
  /** Mirror of `metadata.contentHash`, surfaced for the grounding check. */
  contentHash: string;
}

/** A chunk as read back from the store. */
export interface StoredChunk {
  id: string;
  text: string;
  metadata: ChunkMetadata;
  /** Mirror of `metadata.contentHash`, surfaced for the grounding check. */
  contentHash: string;
}

/** A retrieval hit: a stored chunk plus its similarity score. */
export interface SearchResult extends StoredChunk {
  /** Similarity score in [0, 1]; higher is closer. */
  score: number;
}

/**
 * Metadata filter applied at query time. Adapters translate this to their native
 * filter syntax. Keep it simple and serialisable — equality and membership only.
 */
export interface MetadataFilter {
  [key: string]: string | number | boolean | Array<string | number> | undefined;
}

/**
 * The contract every vector store implements.
 *
 * `getById` is NOT optional — the cache grounding check depends on it. `namespace`
 * returns a scoped view of the same store, used for multi-tenant isolation and, in
 * federal mode, role-based access to partitions of the knowledge base.
 */
export interface VectorAdapter {
  /** Top-K nearest-neighbour search, optionally filtered by metadata. */
  search(embedding: number[], topK: number, filter?: MetadataFilter): Promise<SearchResult[]>;
  /** Insert or update chunks (idempotent on `id`). */
  upsert(chunks: EmbeddedChunk[]): Promise<void>;
  /** Delete chunks by id. */
  delete(ids: string[]): Promise<void>;
  /** Fetch a single chunk by id, or null if absent. Required for cache grounding. */
  getById(id: string): Promise<StoredChunk | null>;
  /** Return a namespace-scoped view of this adapter. */
  namespace(ns: string): VectorAdapter;
}
