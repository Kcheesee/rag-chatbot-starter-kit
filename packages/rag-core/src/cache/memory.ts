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

  constructor(
    private readonly threshold: number,
    private readonly ttlSeconds: number,
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
