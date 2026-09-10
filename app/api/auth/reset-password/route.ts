import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "@node-rs/bcrypt";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { parents } from "@/db/schema";
import { rateLimit } from "@/server/rate-limit";
import { redis } from "@/server/redis";

const Body = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(6).max(200),
});

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";

  const rl = await rateLimit({
    key: `pwreset-confirm:${ip}`,
    max: 10,
    windowSeconds: 60 * 10,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );
  }

  let body;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const tokenHash = crypto
    .createHash("sha256")
    .update(body.token)
    .digest("hex");

  const key = `pwreset:${tokenHash}`;
  const parentId = await redis.get(key);
  if (!parentId) {
    return NextResponse.json(
      { error: "Reset link is invalid or has expired." },
      { status: 400 }
    );
  }

  // Atomically consume the token to prevent reuse / double-spend.
  const deleted = await redis.del(key);
  if (deleted !== 1) {
    return NextResponse.json(
      { error: "Reset link is invalid or has expired." },
      { status: 400 }
    );
  }

  const passwordHash = await bcrypt.hash(body.password, 10);
  const result = await db
    .update(parents)
    .set({ passwordHash })
    .where(eq(parents.id, parentId))
    .returning({ id: parents.id });

  if (!result.length) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
