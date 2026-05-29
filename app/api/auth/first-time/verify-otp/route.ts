/**
 * First-time setup, step 1: verify the OTP sent to the registered number
 * WITHOUT consuming it. This lets the UI confirm the code is correct and
 * then reveal the create-password / confirm-password fields. The OTP is
 * only deleted later by /api/auth/first-time/complete (step 2).
 *
 *   POST { phone, otp }  →  { ok: true }
 *
 * No session is created and no password is set here.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "@node-rs/bcrypt";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { otpLogs } from "@/db/schema";
import { redis } from "@/lib/redis";
import { rateLimit } from "@/lib/rate-limit";
import { resolveFamilyParent } from "@/lib/parent-lookup";
import { last10Sql } from "@/lib/phone";

const Body = z.object({
  phone: z.string().regex(/^\d{10}$/, "10-digit mobile number required"),
  otp: z.string().regex(/^\d{6}$/, "6-digit OTP required"),
});

const MAX_ATTEMPTS = 5;

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const rl = await rateLimit({
    key: `firsttime:${ip}`,
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

  // ── Verify OTP (same scheme as /api/auth/otp/verify) but DO NOT delete
  //    it — step 2 (/api/auth/first-time/complete) consumes it. ─────────
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
  const otpOk = await bcrypt.compare(body.otp, stored);
  if (!otpOk) {
    db.insert(otpLogs)
      .values({ phone: body.phone, purpose: "first-time", event: "verify_failed", error: "incorrect code", ip })
      .catch(console.error);
    return NextResponse.json(
      { error: "Incorrect OTP. Try again." },
      { status: 401 }
    );
  }

  // ── Registration check ──────────────────────────────────────────
  // Mirror /api/auth/phone-status: accept either an existing family
  // parent (admin-added or already self-signed-up) OR an unclaimed
  // student-guardian link carrying this phone (Case D — fresh family).
  // The strict exact-phone-on-parents check we used to do rejected
  // legitimate Case D users that phone-status had routed here.
  const familyParent = await resolveFamilyParent(body.phone);
  if (familyParent) {
    if (familyParent.status !== "active") {
      return NextResponse.json(
        { error: "Account is inactive. Contact support." },
        { status: 403 }
      );
    }
  } else {
    // No family parent yet — must be on an unclaimed student's links.
    // OTP_TEST_BYPASS=1 skips the guardian-graph check for staging.
    if (process.env.OTP_TEST_BYPASS !== "1") {
      const unclaimed = (await db.execute(sql`
        SELECT 1
          FROM students s
          LEFT JOIN student_guardian_links sgl ON sgl.student_id = s.id
          LEFT JOIN guardians g ON g.erp_name = sgl.guardian_erp_name
         WHERE s.parent_id IS NULL
           AND (
             ${last10Sql(sql`sgl.phone_no`)} = ${body.phone}
             OR ${last10Sql(sql`g.mobile_number`)} = ${body.phone}
             OR ${last10Sql(sql`g.alternate_number`)} = ${body.phone}
           )
         LIMIT 1
      `)) as unknown as unknown[];
      if (unclaimed.length === 0) {
        return NextResponse.json(
          {
            error:
              "This number isn't registered. Ask your school to add you first.",
          },
          { status: 404 }
        );
      }
    }
  }

  db.insert(otpLogs)
    .values({ phone: body.phone, purpose: "first-time", event: "verified", ip })
    .catch(console.error);
  return NextResponse.json({ ok: true });
}
