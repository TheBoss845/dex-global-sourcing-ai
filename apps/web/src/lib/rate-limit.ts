/** Simple in-memory sliding-window rate limiter (per process). */
const hits = new Map<string, number[]>();

export function rateLimit(
  key: string,
  options: { limit: number; windowMs: number },
): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const windowStart = now - options.windowMs;
  const recent = (hits.get(key) ?? []).filter((ts) => ts > windowStart);
  if (recent.length >= options.limit) {
    hits.set(key, recent);
    const retryAfterSec = Math.max(1, Math.ceil((recent[0]! + options.windowMs - now) / 1000));
    return { allowed: false, retryAfterSec };
  }
  recent.push(now);
  hits.set(key, recent);
  return { allowed: true, retryAfterSec: 0 };
}
