/** In-memory session store (development, no persistence). */

import type { SessionStore, SessionTurn } from "../types";

export class InMemorySessionStore implements SessionStore {
  private readonly bySession = new Map<string, SessionTurn[]>();

  constructor(private readonly maxTurns: number) {}

  async getHistory(sessionId: string): Promise<SessionTurn[]> {
    return this.bySession.get(sessionId) ?? [];
  }

  async append(sessionId: string, turn: SessionTurn): Promise<void> {
    const turns = this.bySession.get(sessionId) ?? [];
    turns.push(turn);
    // Bound history to the most recent `maxTurns` turns.
    this.bySession.set(sessionId, turns.slice(-this.maxTurns));
  }

  async clear(sessionId: string): Promise<void> {
    this.bySession.delete(sessionId);
  }
}
