import { NextResponse } from "next/server";
import { acquireCronLock, cronLockedResponse, requireCron } from "@/server/cron-auth";
import { and, lt, or, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { carts } from "@/db/schema";

/**
 * GET/POST /api/cron/cleanup-carts
 *
 * Deletes Postgres carts (and cascading cart_items) that are either:
 *   - past their expiresAt timestamp, OR
 *   - have no expiresAt and were last updated more than CART_TTL_DAYS ago.
 *
 * Auth: `Authorization: Bearer <CRON_TOKEN>` (server/cron-auth.ts). Run from any cron
 * — we expose this as an HTTP endpoint so it works in Vercel/Railway/Docker
 * without an in-process job runner.
 *
 * Recommended cadence: every 6h.
 */

const CART_TTL_DAYS = 7;

async function run(req: Request) {
  const denied = requireCron(req);
  if (denied) return denied;
  const lock = await acquireCronLock("cleanup-carts", 60);
  if (!lock) return cronLockedResponse("cleanup-carts");
  try {

    const cutoff = new Date(Date.now() - CART_TTL_DAYS * 24 * 60 * 60 * 1000);
    const now = new Date();

    const deleted = await db
      .delete(carts)
      .where(
        // Typed operators, not a raw sql`` fragment: postgres.js cannot bind a
        // JS Date passed through sql`` ("Received an instance of Date"), which
        // made this job 500 on every tick until 2026-09-23.
        or(lt(carts.expiresAt, now), and(isNull(carts.expiresAt), lt(carts.updatedAt, cutoff)))
      )
      .returning({ id: carts.id });

    return NextResponse.json({
      ok: true,
      deletedCount: deleted.length,
      cutoff: cutoff.toISOString(),
    });
  } finally {
    await lock.release();
  }
}

export async function GET(req: Request) {
  return run(req);
}
export async function POST(req: Request) {
  return run(req);
}
