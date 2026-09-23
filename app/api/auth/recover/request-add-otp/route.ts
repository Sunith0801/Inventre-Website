/**
 * Recovery / add-mobile step: send the OTP that proves the parent owns a
 * brand-new number they're trying to ADD as a guardian link on a student.
 *
 * Mirrors request-new-otp.ts but with two relaxations that are specific to
 * add-mobile:
 *
 *   • The new phone is allowed to already be an existing parent — when that
 *     parent later logs in via OTP they'll auto-link this extra student via
 *     /api/auth/otp/verify's existing guardian-phone match.
 *   • The student is allowed to have no parentId yet (guardian-only).
 *
 * Identity gate stays the same:
 *   recover:ok:{studentId}        (Path A — old-phone OTP verified)
 *   recover:email-ok:{studentId}  (Path B — registered-email OTP verified)
 *
 *   POST { studentId, oldPhone?, newPhone }  →  { ok: true, ttl }
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "@node-rs/bcrypt";
import { db } from "@/db/client";
import { otpLogs } from "@/db/schema";
import { sealOtpCode } from "@/server/otp-log-crypto";
import { redis } from "@/server/redis";
import { rateLimit } from "@/server/rate-limit";
import { sendOtpSms, generateOtp } from "@/server/notify/sms";
import { getOtpToggles, getBypassOtp } from "@/server/otp-toggles";

const Body = z.object({
  studentId: z.string().uuid(),
  oldPhone: z.string().regex(/^\d{10}$/).optional(),
  newPhone: z.string().regex(/^\d{10}$/, "Enter a valid 10-digit number"),
});
const OTP_TTL = 5 * 60;

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const rl = await rateLimit({
    key: `recover-addotp:${ip}`,
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
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (body.oldPhone && body.newPhone === body.oldPhone)
    return NextResponse.json(
      { error: "The new number must be different from the old one." },
      { status: 400 }
    );

  const phoneMarker = await redis.get(`recover:ok:${body.studentId}`);
  const emailMarker = await redis.get(`recover:email-ok:${body.studentId}`);
  const phoneOk = !!(body.oldPhone && phoneMarker === body.oldPhone);
  if (!phoneOk && !emailMarker)
    return NextResponse.json(
      { error: "Verify your identity first." },
      { status: 403 }
    );

  const { smsRealSend } = await getOtpToggles();
  const testBypass = process.env.OTP_TEST_BYPASS === "1" || !smsRealSend;
  const code = testBypass ? getBypassOtp() : generateOtp();
  const hash = await bcrypt.hash(code, 8);
  await redis.set(`otp:${body.newPhone}`, hash, "EX", OTP_TTL);
  await redis.del(`otp:attempts:${body.newPhone}`);

  if (!testBypass) {
    try {
      const { transactionId } = await sendOtpSms(body.newPhone, code);
      db.insert(otpLogs)
        .values({
          phone: body.newPhone,
          purpose: "recover-add",
          event: "sent",
          transactionId,
          otpCode: sealOtpCode(code),
          ip,
        })
        .catch(console.error);
    } catch (err) {
      db.insert(otpLogs)
        .values({
          phone: body.newPhone,
          purpose: "recover-add",
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

  return NextResponse.json({ ok: true, ttl: OTP_TTL });
}
