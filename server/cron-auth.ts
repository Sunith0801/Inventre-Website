import "server-only";
import crypto from "crypto";
import { NextResponse } from "next/server";
import { redis } from "@/server/redis";

/**
 * The ONE way a scheduled job proves it is the scheduler.
 *
 * Every /api/cron route calls this first. Until 2026-09-23 the twelve routes
 * used five different conventions (three env names, two header styles, one
 * non-constant-time compare), so rotating a token meant reading every file.
 * Now: `Authorization: Bearer <CRON_TOKEN>`, compared in constant time.
 *
 *   503 — CRON_TOKEN is not configured (fail closed, and say why in the log)
 *   401 — header missing or wrong
 *   null — authorised, carry on
 *
 * tests/architecture/invariants.test.ts fails the build if a cron route
 * does not import this.
 */
export function requireCron(req: Request): NextResponse | null {
  const expected = process.env.CRON_TOKEN ?? "";
  if (!expected) {
    return NextResponse.json({ error: "CRON_TOKEN not set" }, { status: 503 });
  }
  const header = req.headers.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (!supplied || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

/**
 * One run of a job at a time, across however many app instances exist.
 *
 * `SET NX PX` on Redis; the value is a random token so only the holder can
 * release it (compare-and-delete in Lua). `ttlSeconds` is a safety net for a
 * crashed run — set it to the cron line's curl timeout. If Redis itself is
 * unreachable the job runs UNLOCKED: with one instance today that is the
 * right trade (a stalled queue is worse than a theoretical double run, and
 * every job is idempotent or uses FOR UPDATE SKIP LOCKED underneath).
 */
export async function acquireCronLock(
  name: string,
  ttlSeconds: number,
): Promise<{ release: () => Promise<void> } | null> {
  const key = `cron:lock:${name}`;
  const token = crypto.randomUUID();
  try {
    const ok = await redis.set(key, token, "PX", ttlSeconds * 1000, "NX");
    if (ok !== "OK") return null;
  } catch {
    return { release: async () => {} };
  }
  return {
    release: async () => {
      try {
        await redis.eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0",
          1,
          key,
          token,
        );
      } catch {
        // the TTL will clear it
      }
    },
  };
}

export function cronLockedResponse(name: string): NextResponse {
  return NextResponse.json({ ok: true, skipped: "locked", job: name });
}
