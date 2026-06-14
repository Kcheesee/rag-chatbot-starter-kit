/**
 * Minimal in-memory fixed-window rate limiter.
 *
 * Per-process only — fine for a single instance or dev. For multi-instance
 * production, back this with Redis (INCR + EXPIRE) so the limit is shared; the
 * call site (`rateLimit(key, perMinute)`) stays the same.
 */

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

/** Returns true if the call is allowed; false if the per-minute limit is exceeded. */
export function rateLimit(key: string, perMinute: number): boolean {
  const now = Date.now();
  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) {
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
