/** Redis-backed session store (production; Upstash / ElastiCache GovCloud). */

import type Redis from "ioredis";

import type { SessionStore, SessionTurn } from "../types";

export class RedisSessionStore implements SessionStore {
  constructor(
    private readonly redis: Redis,
    private readonly maxTurns: number,
  ) {}

  private key(sessionId: string): string {
    return `ragsession:${sessionId}`;
  }

  async getHistory(sessionId: string): Promise<SessionTurn[]> {
    const raw = await this.redis.lrange(this.key(sessionId), 0, -1);
    return raw.map((entry) => JSON.parse(entry) as SessionTurn);
  }

  async append(sessionId: string, turn: SessionTurn): Promise<void> {
    const key = this.key(sessionId);
    await this.redis.rpush(key, JSON.stringify(turn));
    // Trim to the most recent `maxTurns` entries.
    await this.redis.ltrim(key, -this.maxTurns, -1);
  }

  async clear(sessionId: string): Promise<void> {
    await this.redis.del(this.key(sessionId));
  }
}
