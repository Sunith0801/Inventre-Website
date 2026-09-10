/**
 * Forgot-password completion: verify OTP sent to the registered mobile,
 * set the new password, and sign the parent straight in.
 *
 *   POST { phone, otp, password }  →  { ok: true }  (+ session cookie)
 *
 * Differs from first-time/complete in that it leaves first_time_login alone
 * (parent has already signed in before) and creates a session here so the
 * UI doesn't have to do a separate login round-trip.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "@node-rs/bcrypt";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { parents } from "@/db/schema";
import { redis } from "@/server/redis";
import { rateLimit } from "@/server/rate-limit";
import { createParentSession } from "@/server/session";

const Body = z.object({
  phone: z.string().regex(/^\d{10}$/, "10-digit mobile number required"),
  otp: z.string().regex(/^\d{6}$/, "6-digit OTP required"),
  password: z.string().min(6, "Password must be at least 6 characters").max(200),
});

const MAX_ATTEMPTS = 5;

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const rl = await rateLimit({
    key: `forgotpwd:${ip}`,
    max: 20,
    windowSeconds: 60,
  });
  if (!rl.ok)
    return NextResponse.json(
      { error: "Too many attempts. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );

  let body;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: "Invalid request", details: e },
      { status: 400 }
    );
  }

  // Verify OTP (same scheme as /api/auth/otp/verify).
  const attempts = await redis.incr(`otp:attempts:${body.phone}`);
  if (attempts === 1) await redis.expire(`otp:attempts:${body.phone}`, 600);
  if (attempts > MAX_ATTEMPTS)
    return NextResponse.json(
      { error: "Too many attempts. Request a new OTP." },
      { status: 429 }
    );

  const stored = await redis.get(`otp:${body.phone}`);
  if (!stored)
    return NextResponse.json(
      { error: "OTP expired. Request a new one." },
      { status: 400 }
    );
  if (!(await bcrypt.compare(body.otp, stored)))
    return NextResponse.json(
      { error: "Incorrect OTP. Try again." },
      { status: 401 }
    );

  const [parent] = await db
    .select({ id: parents.id, status: parents.status })
    .from(parents)
    .where(eq(parents.phone, body.phone))
    .limit(1);
  if (!parent)
    return NextResponse.json(
      { error: "No account is registered with this number." },
      { status: 404 }
    );
  if (parent.status !== "active")
    return NextResponse.json(
      { error: "Account is inactive. Contact support." },
      { status: 403 }
    );

  await redis.del(`otp:${body.phone}`);
  await redis.del(`otp:attempts:${body.phone}`);

  const passwordHash = await bcrypt.hash(body.password, 10);
  await db
    .update(parents)
    .set({ passwordHash })
    .where(eq(parents.id, parent.id));

  // Sign them straight in.
  await createParentSession(parent.id, body.phone);
  return NextResponse.json({ ok: true });
}
