/**
 * Recovery step: the parent picked their student, now confirms the OLD
 * mobile number on file and we send an OTP to it.
 *
 *   POST { studentId, oldPhone }  →  { ok: true }
 *
 * oldPhone must match the number currently registered for that student's
 * parent (last 10 digits), otherwise we don't send anything.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "@node-rs/bcrypt";
import { eq, sql as dsql } from "drizzle-orm";
import { db } from "@/db/client";
import { parents, students, otpLogs } from "@/db/schema";
import { redis } from "@/server/redis";
import { rateLimit } from "@/server/rate-limit";
import { sendOtpSms, generateOtp } from "@/server/notify/sms";
import { getOtpToggles, getBypassOtp } from "@/server/otp-toggles";

const Body = z.object({
  studentId: z.string().uuid(),
  oldPhone: z.string().regex(/^\d{10}$/, "Enter a valid 10-digit number"),
});
const OTP_TTL = 5 * 60;

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const rl = await rateLimit({
    key: `recover-otp:${ip}`,
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

  const [stu] = await db
    .select({ parentId: students.parentId })
    .from(students)
    .where(eq(students.id, body.studentId))
    .limit(1);
  if (!stu?.parentId) {
    return NextResponse.json(
      { error: "No account is linked to this student. Contact your school." },
      { status: 404 }
    );
  }
  // Accept any phone associated with this student: the legacy parents.phone
  // (login number) OR any guardian-link phone (Father/Mother/etc). MCB
  // reconcile keeps the guardian links up to date, so the second parent's
  // number now works here too.
  const [parent] = await db
    .select({ phone: parents.phone })
    .from(parents)
    .where(eq(parents.id, stu.parentId))
    .limit(1);
  const parentLast10 = (parent?.phone ?? "").replace(/\D/g, "").slice(-10);
  let matches = parentLast10 === body.oldPhone;
  if (!matches) {
    const [hit] = await db.execute(dsql`
      SELECT 1 AS ok
      FROM student_guardian_links
      WHERE student_id = ${body.studentId}
        AND right(regexp_replace(COALESCE(phone_no, ''), '\D', '', 'g'), 10) = ${body.oldPhone}
      LIMIT 1
    `) as unknown as { ok: number }[];
    matches = !!hit;
  }
  if (!matches) {
    return NextResponse.json(
      { error: "That number doesn't match our records for this student." },
      { status: 400 }
    );
  }

  const { smsRealSend } = await getOtpToggles();
  const testBypass = process.env.OTP_TEST_BYPASS === "1" || !smsRealSend;
  const code = testBypass ? getBypassOtp() : generateOtp();
  const hash = await bcrypt.hash(code, 8);
  await redis.set(`otp:${body.oldPhone}`, hash, "EX", OTP_TTL);
  await redis.del(`otp:attempts:${body.oldPhone}`);

  if (!testBypass) {
    try {
      const { transactionId } = await sendOtpSms(body.oldPhone, code);
      db.insert(otpLogs)
        .values({ phone: body.oldPhone, purpose: "recover-old", event: "sent", transactionId, otpCode: code, ip })
        .catch(console.error);
    } catch (err) {
      db.insert(otpLogs)
        .values({
          phone: body.oldPhone,
          purpose: "recover-old",
          event: "send_failed",
          otpCode: code,
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
