/** A cache that never hits — used when CACHE_ENABLED=false. */

import type { CachedResponse, ResponseCache } from "../types";

export class NoOpResponseCache implements ResponseCache {
  async get(): Promise<CachedResponse | null> {
    return null;
  }
  async set(): Promise<void> {}
  async delete(): Promise<void> {}
  async invalidate(): Promise<void> {}
}
