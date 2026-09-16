import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "@node-rs/bcrypt";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { rateLimit } from "@/server/rate-limit";
import { redis } from "@/server/redis";
import { logActivity } from "@/server/activity";
import { resetKey } from "../forgot-password/route";

/**
 * Staff "forgot password" — step 2 of 2.
 *
 *   POST { token, password }  →  { ok: true }
 *
 * The token from the emailed link is consumed atomically (one use, then
 * gone), the new password is stored with the same bcrypt cost the login
 * route verifies against, and the change lands in the activity log against
 * the account itself — there is no signed-in actor at this point.
 */
const Body = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(8, "Use at least 8 characters").max(200),
});

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = await rateLimit({ key: `adminpwreset-confirm:${ip}`, max: 10, windowSeconds: 60 * 10 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );
  }

  let body;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues[0]?.message : undefined;
    return NextResponse.json({ error: msg ?? "Invalid request" }, { status: 400 });
  }

  const key = resetKey(body.token);
  const userId = await redis.get(key);
  // Consume before use so a link can never be replayed.
  if (!userId || (await redis.del(key)) !== 1) {
    return NextResponse.json({ error: "This reset link is invalid or has expired. Request a new one." }, { status: 400 });
  }

  const [user] = await db
    .select({ id: users.id, email: users.email, status: users.status })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user || user.status !== "active") {
    return NextResponse.json({ error: "This account can no longer sign in. Contact an administrator." }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(body.password, 12);
  await db.update(users).set({ passwordHash }).where(eq(users.id, user.id));

  await logActivity({
    actorId: user.id,
    actorEmail: user.email,
    action: "admin.user.password_reset",
    entityType: "user",
    entityId: user.id,
    summary: `Password reset via emailed link for "${user.email}"`,
  });

  return NextResponse.json({ ok: true });
}
