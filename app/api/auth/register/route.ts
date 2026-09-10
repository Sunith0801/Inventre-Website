/**
 * New-user self-registration. Used by the "New user" tab on /login.
 *
 *   POST { phone, name }  →  { ok: true, ttl: number }
 *
 * Creates an `active` parent with `first_time_login = true` and dispatches
 * an OTP. The client then opens FirstTimeModal which captures the OTP plus
 * a new password — that path is the same one existing-but-uninitialised
 * accounts already use, so registration converges with the rest of the
 * login flow on the second step.
 *
 * Reject codes:
 *   400 invalid payload
 *   409 phone already registered (UI should switch tabs to "existing")
 *   429 rate-limited
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { parents } from "@/db/schema";
import { rateLimit } from "@/server/rate-limit";
import { sendSms, generateOtp } from "@/server/notify/sms";
import { redis } from "@/server/redis";
import bcrypt from "@node-rs/bcrypt";

const Body = z.object({
  phone: z.string().regex(/^\d{10}$/, "Enter a valid 10-digit number"),
  name: z.string().trim().min(2, "Enter your full name"),
});
const OTP_TTL = 5 * 60;

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const rl = await rateLimit({
    key: `register:${ip}`,
    max: 10,
    windowSeconds: 10 * 60,
  });
  if (!rl.ok)
    return NextResponse.json(
      { error: "Too many requests. Try again later." },
      { status: 429 }
    );

  let body;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    const msg =
      e instanceof z.ZodError
        ? e.issues[0]?.message ?? "Invalid request"
        : "Invalid request";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // Phone must be free.
  const [existing] = await db
    .select({ id: parents.id })
    .from(parents)
    .where(eq(parents.phone, body.phone))
    .limit(1);
  if (existing)
    return NextResponse.json(
      {
        error: "An account already exists for this number. Please sign in.",
        existing: true,
      },
      { status: 409 }
    );

  const { generateCustomerCode } = await import("@/server/customer-numbering");
  const customerCode = await generateCustomerCode();
  // ON CONFLICT (phone) DO NOTHING: the SELECT above is a TOCTOU
  // window — a parallel registration on the same phone microseconds
  // earlier would otherwise produce a duplicate parents row before the
  // unique index rejects it as 500. Match the race-recovery pattern
  // used by lib/repos/guardians.upsertGuardianLink.
  await db
    .insert(parents)
    .values({
      phone: body.phone,
      name: body.name,
      customerCode,
      status: "active",
      firstTimeLogin: true,
    })
    .onConflictDoNothing({ target: parents.phone });

  // Issue OTP — same scheme as /api/auth/otp/request.
  const code = generateOtp();
  const hash = await bcrypt.hash(code, 8);
  await redis.set(`otp:${body.phone}`, hash, "EX", OTP_TTL);
  await redis.del(`otp:attempts:${body.phone}`);
  await sendSms({
    phone: body.phone,
    body: `Your Inventre verification code is ${code}. Valid 5 minutes.`,
    variables: { otp: code, mobile: body.phone },
  });

  return NextResponse.json({ ok: true, ttl: OTP_TTL });
}
