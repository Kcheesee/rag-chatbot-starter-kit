/** Build the configured session store. */

import type Redis from "ioredis";

import type { Env } from "../env";
import type { SessionStore } from "../types";
import { InMemorySessionStore } from "./memory";
import { RedisSessionStore } from "./redis";

export function createSessionStore(env: Env, redis?: Redis): SessionStore {
  if (env.SESSION_STORE === "redis" && redis) {
    return new RedisSessionStore(redis, env.SESSION_MAX_TURNS);
  }
  return new InMemorySessionStore(env.SESSION_MAX_TURNS);
}
