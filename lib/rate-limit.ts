import { redis } from "./redis";

/**
 * Sliding-window rate limiter backed by Redis INCR + EXPIRE.
 * Returns { ok, remaining, retryAfter } so callers can return 429 helpfully.
 */
export async function rateLimit(opts: {
  key: string;
  max: number;
  windowSeconds: number;
}): Promise<{ ok: boolean; remaining: number; retryAfter: number }> {
  const { key, max, windowSeconds } = opts;
  const tx = redis.multi();
  tx.incr(key);
  tx.ttl(key);
  const [[, count], [, ttl]] = (await tx.exec()) as [
    [Error | null, number],
    [Error | null, number]
  ];

  if (count === 1 || ttl < 0) {
    await redis.expire(key, windowSeconds);
  }
  const remaining = Math.max(0, max - count);
  const retryAfter = ttl > 0 ? ttl : windowSeconds;
  return { ok: count <= max, remaining, retryAfter };
}
