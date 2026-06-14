/**
 * In-memory semantic response cache (development / single-process).
 *
 * A get() is a cosine-similarity search over the namespace's cached query
 * embeddings; an entry is returned only when its similarity clears the configured
 * threshold. Entries carry a TTL and are skipped (and lazily pruned) once expired.
 */

import type { CachedResponse, ResponseCache } from "../types";
import { cosineSimilarity } from "../vectors";

interface CacheEntry {
  key: string;
  embedding: number[];
  response: CachedResponse;
  expiresAt: number;
}

export class InMemoryResponseCache implements ResponseCache {
  private readonly byNamespace = new Map<string, CacheEntry[]>();
  private counter = 0;

  /**
   * @param threshold        Minimum cosine similarity for a hit.
   * @param ttlSeconds       Entry lifetime.
   * @param maxPerNamespace  Hard cap on live entries per namespace (oldest evicted
   *   first). Bounds memory so a high-cardinality query stream can't grow the cache
   *   without limit — the Redis cache is the answer for real multi-instance scale.
   */
  constructor(
    private readonly threshold: number,
    private readonly ttlSeconds: number,
    private readonly maxPerNamespace = 1_000,
  ) {}

  async get(embedding: number[], namespace: string): Promise<CachedResponse | null> {
    const entries = this.byNamespace.get(namespace);
    if (!entries) return null;
    const now = Date.now();

    let best: { response: CachedResponse; score: number } | null = null;
    const live: CacheEntry[] = [];
    for (const entry of entries) {
      if (entry.expiresAt <= now) continue; // expired — drop on prune below
      live.push(entry);
      const score = cosineSimilarity(embedding, entry.embedding);
      if (score >= this.threshold && (best === null || score > best.score)) {
        best = { response: entry.response, score };
      }
    }
    if (live.length !== entries.length) this.byNamespace.set(namespace, live);
    return best?.response ?? null;
  }

  async set(
    embedding: number[],
    namespace: string,
    response: CachedResponse,
    ttl?: number,
  ): Promise<void> {
    const entries = this.byNamespace.get(namespace) ?? [];
    this.counter += 1;
    entries.push({
      key: `${namespace}:${this.counter}`,
      embedding,
      response,
      expiresAt: Date.now() + (ttl ?? this.ttlSeconds) * 1000,
    });
    // Bound memory: keep only the newest `maxPerNamespace` entries (FIFO eviction).
    if (entries.length > this.maxPerNamespace) {
      entries.splice(0, entries.length - this.maxPerNamespace);
    }
    this.byNamespace.set(namespace, entries);
  }

  async delete(key: string): Promise<void> {
    for (const [namespace, entries] of this.byNamespace) {
      const filtered = entries.filter((entry) => entry.key !== key);
      if (filtered.length !== entries.length) this.byNamespace.set(namespace, filtered);
    }
  }

  async invalidate(namespace: string): Promise<void> {
    this.byNamespace.delete(namespace);
  }
}
