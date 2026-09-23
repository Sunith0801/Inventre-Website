import "server-only";
import crypto from "crypto";
import { NextResponse } from "next/server";

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
