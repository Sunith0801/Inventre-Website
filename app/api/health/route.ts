import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { redis } from "@/lib/redis";

export async function GET() {
  const checks = {
    db: false,
    redis: false,
    timestamp: new Date().toISOString(),
  };

  try {
    await db.execute(sql`SELECT 1`);
    checks.db = true;
  } catch {}
  try {
    await redis.ping();
    checks.redis = true;
  } catch {}

  const allOk = checks.db && checks.redis;
  return NextResponse.json(checks, { status: allOk ? 200 : 503 });
}
