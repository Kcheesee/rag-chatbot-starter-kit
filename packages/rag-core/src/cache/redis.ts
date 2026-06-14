/**
 * Redis-backed semantic response cache (production / multi-instance).
 *
 * Each entry is a JSON blob (embedding + response) under a per-namespace key with a
 * TTL; the entry ids are tracked in a per-namespace set. A get() loads the
 * namespace's live entries and returns the best cosine match above the threshold.
 *
 * Note: this scans a namespace's entries in-process. For very large caches, swap in
 * RediSearch / a vector index — the `ResponseCache` interface is the seam for that.
 */

import { randomUUID } from "node:crypto";

import type Redis from "ioredis";

import type { CachedResponse, ResponseCache } from "../types";
import { cosineSimilarity } from "../vectors";

interface StoredEntry {
  embedding: number[];
  response: CachedResponse;
}

export class RedisResponseCache implements ResponseCache {
  constructor(
    private readonly redis: Redis,
    private readonly threshold: number,
    private readonly ttlSeconds: number,
  ) {}

  private entryKey(namespace: string, id: string): string {
    return `ragcache:${namespace}:entry:${id}`;
  }
  private idSetKey(namespace: string): string {
    return `ragcache:${namespace}:ids`;
  }

  async get(embedding: number[], namespace: string): Promise<CachedResponse | null> {
    const ids = await this.redis.smembers(this.idSetKey(namespace));
    if (ids.length === 0) return null;

    const values = await this.redis.mget(...ids.map((id) => this.entryKey(namespace, id)));
    let best: { response: CachedResponse; score: number } | null = null;
    const stale: string[] = [];

    values.forEach((value, i) => {
      if (value === null) {
        stale.push(ids[i] as string); // entry expired/evicted — clean its dangling id
        return;
      }
      const entry = JSON.parse(value) as StoredEntry;
      const score = cosineSimilarity(embedding, entry.embedding);
      if (score >= this.threshold && (best === null || score > best.score)) {
        best = { response: entry.response, score };
      }
    });

    if (stale.length > 0) await this.redis.srem(this.idSetKey(namespace), ...stale);
    return best === null ? null : (best as { response: CachedResponse }).response;
  }

  async set(
    embedding: number[],
    namespace: string,
    response: CachedResponse,
    ttl?: number,
  ): Promise<void> {
    const id = randomUUID();
    const entry: StoredEntry = { embedding, response };
    await this.redis.set(
      this.entryKey(namespace, id),
      JSON.stringify(entry),
      "EX",
      ttl ?? this.ttlSeconds,
    );
    await this.redis.sadd(this.idSetKey(namespace), id);
  }

  async delete(key: string): Promise<void> {
    // `key` is a full entry key here (the pipeline invalidates by namespace).
    await this.redis.del(key);
  }

  async invalidate(namespace: string): Promise<void> {
    const ids = await this.redis.smembers(this.idSetKey(namespace));
    if (ids.length > 0) {
      await this.redis.del(...ids.map((id) => this.entryKey(namespace, id)));
    }
    await this.redis.del(this.idSetKey(namespace));
  }
}
