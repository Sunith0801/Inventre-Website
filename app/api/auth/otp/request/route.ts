import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "@node-rs/bcrypt";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { otpLogs } from "@/db/schema";
import { sealOtpCode } from "@/server/otp-log-crypto";
import { redis } from "@/server/redis";
import { rateLimit } from "@/server/rate-limit";
import { sendOtpSms, generateOtp } from "@/server/notify/sms";
import { getOtpToggles, getBypassOtp } from "@/server/otp-toggles";
import { last10Sql } from "@/lib/phone";

const Body = z.object({
  phone: z.string().regex(/^\d{10}$/),
  resend: z.boolean().optional(),
});

const OTP_TTL = 5 * 60; // 5 minutes

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";

  let body;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json(
      { error: "Enter a valid 10-digit mobile number" },
      { status: 400 }
    );
  }

  // Rate limits — protect SMS spend
  const ipRl = await rateLimit({
    key: `otp:req:ip:${ip}`,
    max: 30,
    windowSeconds: 60 * 60,
  });
  if (!ipRl.ok) {
    return NextResponse.json(
      { error: "Too many requests. Try again later." },
      { status: 429, headers: { "Retry-After": String(ipRl.retryAfter) } }
    );
  }

  // Two ways to skip real SMS delivery and pin the code to OTP_BYPASS_CODE:
  //   1. legacy OTP_TEST_BYPASS=1 env (kept for staging/demo)
  //   2. admin toggle at /admin/settings/otp (system_settings.otp.sms_real_send=false)
  const { smsRealSend } = await getOtpToggles();
  const testBypass = process.env.OTP_TEST_BYPASS === "1" || !smsRealSend;
  const code = testBypass ? getBypassOtp() : generateOtp();
  const hash = await bcrypt.hash(code, 8);
  await redis.set(`otp:${body.phone}`, hash, "EX", OTP_TTL);
  await redis.del(`otp:attempts:${body.phone}`);

  // Pre-warm "known number" flag (not exposed to client). Mirrors the
  // union the verify step uses, so a first-time guardian whose phone lives
  // only in student_guardian_links / guardians is still recognized.
  const known = await db.execute(sql`
    SELECT 1 FROM parents WHERE phone = ${body.phone}
    UNION ALL
    SELECT 1 FROM guardians
     WHERE ${last10Sql(sql`mobile_number`)} = ${body.phone}
        OR ${last10Sql(sql`alternate_number`)} = ${body.phone}
    UNION ALL
    SELECT 1 FROM student_guardian_links
     WHERE ${last10Sql(sql`phone_no`)} = ${body.phone}
    LIMIT 1
  `);
  if ((known as unknown as unknown[]).length > 0) {
    await redis.set(`otp:exists:${body.phone}`, "1", "EX", OTP_TTL);
  } else {
    await redis.del(`otp:exists:${body.phone}`);
  }

  if (!testBypass) {
    // Hybrid: first sends block (user sees a clean error if the SMS gateway
    // fails); resends are fire-and-forget so a flaky gateway doesn't break
    // the resend button UX.
    if (body.resend) {
      sendOtpSms(body.phone, code)
        .then(({ transactionId }) =>
          db
            .insert(otpLogs)
            .values({ phone: body.phone, purpose: "login", event: "sent", transactionId, otpCode: sealOtpCode(code), ip })
        )
        .catch((err) => {
          db.insert(otpLogs)
            .values({
              phone: body.phone,
              purpose: "login",
              event: "send_failed",
              otpCode: sealOtpCode(code),
              error: err instanceof Error ? err.message : String(err),
              ip,
            })
            .catch(console.error);
          console.error("[otp/request resend] send failed:", err);
        });
    } else {
      try {
        const { transactionId } = await sendOtpSms(body.phone, code);
        db.insert(otpLogs)
          .values({ phone: body.phone, purpose: "login", event: "sent", transactionId, otpCode: sealOtpCode(code), ip })
          .catch(console.error);
      } catch (err) {
        db.insert(otpLogs)
          .values({
            phone: body.phone,
            purpose: "login",
            event: "send_failed",
            otpCode: sealOtpCode(code),
            error: err instanceof Error ? err.message : String(err),
            ip,
          })
          .catch(console.error);
        return NextResponse.json(
          { error: "OTP service temporarily unavailable. Please try again." },
          { status: 503 }
        );
      }
    }
  }

  return NextResponse.json({ ok: true, ttl: OTP_TTL });
}
