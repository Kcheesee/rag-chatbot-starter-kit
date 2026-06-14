/**
 * The cache grounding check.
 *
 * A cache hit is not automatically served. We first re-verify that every source
 * chunk the cached answer was built from still exists AND still matches its stored
 * content hash. If the knowledge base changed under it (re-ingest, deletion), the
 * entry is treated as invalid and the full pipeline re-runs — so we never serve a
 * confidently-wrong answer from outdated source content.
 */

import type { VectorAdapter } from "@rag-chat-agent/vector-adapters";

import type { CachedResponse } from "../types";

/** True iff every source chunk still exists and still matches its stored hash. */
export async function validateCacheGrounding(
  hit: CachedResponse,
  vectorAdapter: VectorAdapter,
): Promise<boolean> {
  for (const source of hit.sourceChunks) {
    const current = await vectorAdapter.getById(source.chunkId);
    if (!current) return false; // chunk was deleted
    if (current.contentHash !== source.contentHash) return false; // chunk changed
  }
  return true;
}
