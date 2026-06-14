/** In-memory session store (development, no persistence). */

import type { SessionStore, SessionTurn } from "../types";

export class InMemorySessionStore implements SessionStore {
  private readonly bySession = new Map<string, SessionTurn[]>();

  /**
   * @param maxTurns    Max history turns kept per session.
   * @param maxSessions Max distinct sessions held (LRU eviction). Bounds memory so an
   *   unbounded stream of session ids can't leak — use the Redis store for durable,
   *   shared session memory in production.
   */
  constructor(
    private readonly maxTurns: number,
    private readonly maxSessions = 10_000,
  ) {}

  async getHistory(sessionId: string): Promise<SessionTurn[]> {
    return this.bySession.get(sessionId) ?? [];
  }

  async append(sessionId: string, turn: SessionTurn): Promise<void> {
    const turns = this.bySession.get(sessionId) ?? [];
    turns.push(turn);
    // Re-insert (delete+set) so this session moves to the most-recently-used end.
    this.bySession.delete(sessionId);
    this.bySession.set(sessionId, turns.slice(-this.maxTurns));
    // Bound the number of sessions: evict the least-recently-used (oldest) one.
    if (this.bySession.size > this.maxSessions) {
      const lru = this.bySession.keys().next().value;
      if (lru !== undefined) this.bySession.delete(lru);
    }
  }

  async clear(sessionId: string): Promise<void> {
    this.bySession.delete(sessionId);
  }
}
