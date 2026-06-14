/**
 * Minimal in-memory fixed-window rate limiter with BOUNDED memory.
 *
 * Per-process only — fine for a single instance or dev. For multi-instance
 * production, back this with Redis (INCR + EXPIRE) so the limit is shared; the
 * call site (`rateLimit(key, perMinute)`) stays the same.
 *
 * Memory safety: a naive `Map` here is an unbounded growth vector — every distinct
 * key (IP / user id, which an attacker can vary freely) adds a permanent entry. We
 * cap the map at MAX_KEYS and opportunistically sweep expired windows so the
 * footprint stays bounded regardless of how many distinct keys are seen.
 */

interface Window {
  count: number;
  resetAt: number;
}

const MAX_KEYS = 50_000;
const windows = new Map<string, Window>();

/** Drop windows whose fixed period has elapsed; they carry no live state. */
function sweepExpired(now: number): void {
  for (const [key, w] of windows) {
    if (w.resetAt <= now) windows.delete(key);
  }
}

/** Returns true if the call is allowed; false if the per-minute limit is exceeded. */
export function rateLimit(key: string, perMinute: number): boolean {
  const now = Date.now();
  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) {
    // Keep memory bounded before inserting a new key.
    if (windows.size >= MAX_KEYS) {
      sweepExpired(now);
      // If sweeping freed nothing (all windows still live), evict the oldest entry —
      // Map iteration is insertion-ordered, so the first key is the oldest.
      if (windows.size >= MAX_KEYS) {
        const oldest = windows.keys().next().value;
        if (oldest !== undefined) windows.delete(oldest);
      }
    }
    windows.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (existing.count >= perMinute) return false;
  existing.count += 1;
  return true;
}

/** Clear all windows. Test-only. */
export function resetRateLimits(): void {
  windows.clear();
}
