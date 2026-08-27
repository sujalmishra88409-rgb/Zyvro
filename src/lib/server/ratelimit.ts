// ZYVRO — tiny in-memory sliding-window rate limiter for location writes.
// Per-instance (fine for the MVP deployment scale).

const lastAccepted = new Map<string, number>();

export function rateLimitOk(key: string, minIntervalMs: number): { ok: boolean; retryAfterMs: number } {
  const now = Date.now();
  const last = lastAccepted.get(key);
  if (last !== undefined && now - last < minIntervalMs) {
    return { ok: false, retryAfterMs: minIntervalMs - (now - last) };
  }
  lastAccepted.set(key, now);
  // Opportunistic cleanup to keep the map bounded.
  if (lastAccepted.size > 5000) {
    const cutoff = now - 60_000;
    for (const [k, v] of lastAccepted) {
      if (v < cutoff) lastAccepted.delete(k);
    }
  }
  return { ok: true, retryAfterMs: 0 };
}
