import Redis from "ioredis";

declare global {
  // eslint-disable-next-line no-var
  var __redis__: Redis | undefined;
}

function getRedis(): Redis {
  if (globalThis.__redis__) return globalThis.__redis__;
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error(
      "REDIS_URL is not set. Copy .env.example to .env.local and run `npm run db:up`."
    );
  }
  const client = new Redis(url, {
    // Cap each command at 3 retries; beyond that fail the request so the
    // caller can short-circuit (most of our Redis usage is cache/rate-
    // limit — fail-soft, not fail-hard).
    maxRetriesPerRequest: 3,
    lazyConnect: false,
    enableReadyCheck: true,
    // Bound connect attempts so the socket layer doesn't sit on a half-
    // dead connection for 60-120s (the kernel TCP timeout). 10s is well
    // above normal LAN connect latency.
    connectTimeout: 10_000,
    // Reconnect on transient failures. ioredis calls retryStrategy with the
    // attempt number; returning a delay schedules a reconnect, returning
    // null gives up. We back off quickly (500ms → 1s → 2s → 5s → 10s
    // → … → 30s cap) and never give up, so a Redis bounce or network
    // hiccup self-heals without a container restart.
    retryStrategy: (attempts) =>
      Math.min(500 * 2 ** Math.max(0, attempts - 1), 30_000),
    // Force-reconnect when the error matches "READONLY" (failover) or
    // ETIMEDOUT/ECONNRESET (the exact stuck-pool symptom we hit on 2026-05-26).
    // Returning 2 here tells ioredis to drop the connection AND replay
    // queued commands on the new one.
    reconnectOnError: (err) => {
      const msg = err.message || "";
      if (/READONLY|ETIMEDOUT|ECONNRESET|EPIPE/i.test(msg)) return 2;
      return false;
    },
    // Keep TCP connections fresh — Docker/host NAT tables can silently
    // drop idle connections after a few minutes, which presents to the
    // client as ETIMEDOUT on next use. 30s keep-alive heads that off.
    keepAlive: 30_000,
  });
  // Surface persistent connect errors in container logs (default ioredis
  // logs every retry which is noisy). One log line per state change.
  client.on("error", (e) => {
    // eslint-disable-next-line no-console
    console.error("[redis] error:", e.message);
  });
  client.on("reconnecting", (delay: unknown) => {
    // eslint-disable-next-line no-console
    console.warn(`[redis] reconnecting in ${delay}ms`);
  });
  // Cache the singleton on globalThis ALWAYS — was previously gated on
  // `NODE_ENV !== "production"` (to avoid HMR-zombie clients in dev),
  // but that left production calling `new Redis(...)` on every single
  // proxy access — opening a fresh TCP connection per request. The
  // 2026-05-26 incident saw Redis hit its 10000-client cap and start
  // refusing connections; site went down with `write EPIPE` floods.
  // Caching here is safe in both modes: dev HMR replaces the module
  // but globalThis survives, and the same ioredis instance handles
  // reconnects via the retryStrategy/reconnectOnError config above.
  globalThis.__redis__ = client;
  return client;
}

// Lazy proxy — module load is side-effect free.
export const redis: Redis = new Proxy({} as Redis, {
  get(_, prop) {
    const real = getRedis() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(real) : value;
  },
});
