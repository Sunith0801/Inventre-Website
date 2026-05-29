import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

declare global {
  // eslint-disable-next-line no-var
  var __pg__: ReturnType<typeof postgres> | undefined;
  // eslint-disable-next-line no-var
  var __db__: ReturnType<typeof drizzle<typeof schema>> | undefined;
  // Separate pool for cron / background work — see getCronDb() below.
  // eslint-disable-next-line no-var
  var __pg_cron__: ReturnType<typeof postgres> | undefined;
  // eslint-disable-next-line no-var
  var __db_cron__: ReturnType<typeof drizzle<typeof schema>> | undefined;
}

/**
 * Lazy-initialised drizzle client. We do NOT throw at import time so the
 * Next.js build can collect route handler metadata without DATABASE_URL set.
 * The first actual query call resolves the env and creates the connection.
 */
function getDb() {
  if (globalThis.__db__) return globalThis.__db__;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and run `npm run db:up`."
    );
  }
  const client =
    globalThis.__pg__ ??
    postgres(url, {
      // 30 client connections. Was 10 — but ERP webhooks (via
      // /api/erp/webhooks → upsertShipmentMirror + deriveStatusForErpOrderName)
      // can fire bursts of 10+ near-simultaneous INSERTs, saturating a
      // 10-slot pool and queuing every customer request behind them. The
      // 2026-05-26 incident was 30+ second page loads while ERP was
      // replaying a shipment backlog. PgBouncer (transaction mode, pool
      // size 25) downstream multiplexes onto a smaller set of server
      // connections, so 30 client slots are safe.
      max: 30,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false, // PgBouncer transaction-pool mode requirement
    });
  // Cache the singleton on globalThis ALWAYS. The previous
  // `NODE_ENV !== "production"` gate was meant to avoid Next.js HMR
  // zombies in dev, but the side effect was catastrophic in prod:
  // every db.something() access via the Proxy below re-entered
  // getDb(), saw an empty cache, and called `postgres(url, {...})`
  // again — creating a brand-new pg connection pool per request.
  // PgBouncer hid the symptom for a while but pile-on under load
  // turned into the same wedge we saw on Redis (2026-05-26).
  // Caching is also fine in dev: HMR replaces the module but
  // globalThis persists across reloads.
  globalThis.__pg__ = client;
  const d = drizzle(client, { schema });
  globalThis.__db__ = d;
  return d;
}

// Proxy that lazily forwards to the real client so module load is side-effect free.
export const db: ReturnType<typeof drizzle<typeof schema>> = new Proxy(
  {} as ReturnType<typeof drizzle<typeof schema>>,
  {
    get(_, prop) {
      const real = getDb() as unknown as Record<string | symbol, unknown>;
      const value = real[prop];
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(real) : value;
    },
  }
);

/**
 * Separate Drizzle pool for cron / background work (ERP drain, poll,
 * reconciler, webhook drain). Bounded smaller than the request pool so a
 * runaway cron can never fully starve customer requests for DB
 * connections. With request pool = 30 and cron pool = 8, the worst case
 * is 30 connections still available for the request handler even if
 * every cron slot is in use.
 *
 * Use `dbCron` (or its proxy) in routes under /api/cron/*. Use the
 * default `db` for everything else.
 */
function getCronDb() {
  if (globalThis.__db_cron__) return globalThis.__db_cron__;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and run `npm run db:up`."
    );
  }
  const client =
    globalThis.__pg_cron__ ??
    postgres(url, {
      max: 8,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    });
  globalThis.__pg_cron__ = client;
  const d = drizzle(client, { schema });
  globalThis.__db_cron__ = d;
  return d;
}

export const dbCron: ReturnType<typeof drizzle<typeof schema>> = new Proxy(
  {} as ReturnType<typeof drizzle<typeof schema>>,
  {
    get(_, prop) {
      const real = getCronDb() as unknown as Record<string | symbol, unknown>;
      const value = real[prop];
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(real) : value;
    },
  }
);

export { schema };
