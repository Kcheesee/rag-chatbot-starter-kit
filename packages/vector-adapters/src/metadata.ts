/**
 * Shared metadata mapping used by every adapter.
 *
 * Stores accept flat scalar metadata (Chroma metadata values, Pinecone metadata,
 * a Postgres JSONB column, Weaviate properties). These helpers flatten our
 * `ChunkMetadata` to scalars on write and reconstruct it on read, so all four
 * adapters round-trip metadata identically and produce uniform `SearchResult`s.
 */

import type { ChunkMetadata, SearchResult, StoredChunk } from "./types";

/** A flat, store-friendly metadata record (scalars only, no undefined). */
export type FlatMetadata = Record<string, string | number | boolean>;

/** Flatten `ChunkMetadata` to scalars, dropping undefined optionals. */
export function toFlatMetadata(meta: ChunkMetadata): FlatMetadata {
  const out: FlatMetadata = {
    sourceFile: meta.sourceFile,
    sourceType: meta.sourceType,
    chunkIndex: meta.chunkIndex,
    contentHash: meta.contentHash,
    ingestedAt: meta.ingestedAt,
    namespace: meta.namespace,
  };
  if (meta.pageNumber !== undefined) out.pageNumber = meta.pageNumber;
  if (meta.heading !== undefined) out.heading = meta.heading;
  return out;
}

/** Reconstruct `ChunkMetadata` from a stored record (defensive about types). */
export function fromFlatMetadata(record: Record<string, unknown>): ChunkMetadata {
  const meta: ChunkMetadata = {
    sourceFile: String(record["sourceFile"] ?? ""),
    sourceType: String(record["sourceType"] ?? ""),
    chunkIndex: Number(record["chunkIndex"] ?? 0),
    contentHash: String(record["contentHash"] ?? ""),
    ingestedAt: String(record["ingestedAt"] ?? ""),
    namespace: String(record["namespace"] ?? "default"),
  };
  if (record["pageNumber"] !== undefined && record["pageNumber"] !== null) {
    meta.pageNumber = Number(record["pageNumber"]);
  }
  if (record["heading"] !== undefined && record["heading"] !== null) {
    meta.heading = String(record["heading"]);
  }
  return meta;
}

/** Build a `StoredChunk` from an id, text, and a stored metadata record. */
export function toStoredChunk(id: string, text: string, record: Record<string, unknown>): StoredChunk {
  const metadata = fromFlatMetadata(record);
  return { id, text, metadata, contentHash: metadata.contentHash };
}

/** Build a `SearchResult` from an id, text, stored metadata record, and score. */
export function toSearchResult(
  id: string,
  text: string,
  record: Record<string, unknown>,
  score: number,
): SearchResult {
  return { ...toStoredChunk(id, text, record), score };
}
