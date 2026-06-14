/** Shared Redis client construction (used by the session store and response cache). */

import Redis from "ioredis";

import type { Env } from "./env";

/**
 * Construct an ioredis client from env. Supports a plain `REDIS_URL`, an Upstash URL
 * (`rediss://...`), or the local default. The same instance is shared between the
 * session store and the response cache so we hold one connection, not two.
 */
export function createRedisClient(env: Env): Redis {
  const url = env.REDIS_URL ?? env.UPSTASH_REDIS_URL ?? "redis://localhost:6379";
  return new Redis(url, { maxRetriesPerRequest: 3 });
}
