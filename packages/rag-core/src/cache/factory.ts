/** Build the configured response cache. */

import type Redis from "ioredis";

import type { Env } from "../env";
import type { ResponseCache } from "../types";
import { InMemoryResponseCache } from "./memory";
import { RedisResponseCache } from "./redis";
import { NoOpResponseCache } from "./noop";

/**
 * Cache selection: disabled → no-op; otherwise the cache follows the session store
 * (Redis when SESSION_STORE=redis, in-memory otherwise), reusing the shared Redis
 * client when one is provided.
 */
export function createResponseCache(env: Env, redis?: Redis): ResponseCache {
  if (!env.CACHE_ENABLED) return new NoOpResponseCache();

  if (env.SESSION_STORE === "redis" && redis) {
    return new RedisResponseCache(redis, env.CACHE_SIMILARITY_THRESHOLD, env.CACHE_TTL_SECONDS);
  }
  return new InMemoryResponseCache(env.CACHE_SIMILARITY_THRESHOLD, env.CACHE_TTL_SECONDS);
}
