/**
 * Recovery step "send OTP to new mobile" — used by the email-recovery path.
 * Requires one of the two recovery markers:
 *
 *   recover:ok:{studentId}      = oldPhone  (Path A: old-number was verified)
 *   recover:email-ok:{studentId} = parentId (Path B: email was verified)
 *
 *   POST { studentId, oldPhone?, newPhone }  →  { ok: true, ttl }
 *
 * Note: Path A no longer needs this step (verify-old now logs the user in
 * directly), but we keep oldPhone support so any in-flight client can still
 * use it without breaking.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "@node-rs/bcrypt";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { students, otpLogs } from "@/db/schema";
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
    key: `recover-newotp:${ip}`,
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

  // Accept either recovery marker.
  const phoneMarker = await redis.get(`recover:ok:${body.studentId}`);
  const emailMarker = await redis.get(`recover:email-ok:${body.studentId}`);
  const phoneOk = !!(body.oldPhone && phoneMarker === body.oldPhone);
  if (!phoneOk && !emailMarker)
    return NextResponse.json(
      { error: "Verify your identity first." },
      { status: 403 }
    );

  const [stu] = await db
    .select({ parentId: students.parentId })
    .from(students)
    .where(eq(students.id, body.studentId))
    .limit(1);
  if (!stu?.parentId)
    return NextResponse.json(
      { error: "No account is linked to this student." },
      { status: 404 }
    );
  if (!phoneOk && emailMarker && emailMarker !== stu.parentId)
    return NextResponse.json(
      { error: "Verify your identity first." },
      { status: 403 }
    );

  // If another parent already holds the new phone, only block when that
  // account is "real" (owns at least one student). Empty zombie parent
  // rows — left behind by earlier login attempts on a now-stale guardian
  // master — are reclaimed silently here so the parent can complete the
  // change. Confirm runs the same cleanup just before the UPDATE.
  const taken = (await db.execute(sql`
    SELECT p.id,
           EXISTS (SELECT 1 FROM students WHERE parent_id = p.id) AS has_student
      FROM parents p
     WHERE p.phone = ${body.newPhone}
       AND p.id <> ${stu.parentId}
     LIMIT 1
  `)) as unknown as { id: string; has_student: boolean }[];
  const occ = Array.isArray(taken) ? taken[0] : undefined;
  if (occ?.has_student)
    return NextResponse.json(
      { error: "That number is already registered to another account." },
      { status: 409 }
    );
  if (occ && !occ.has_student) {
    await db.execute(sql`DELETE FROM parents WHERE id = ${occ.id}`);
  }

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
        .values({ phone: body.newPhone, purpose: "recover-new", event: "sent", transactionId, otpCode: sealOtpCode(code), ip })
        .catch(console.error);
    } catch (err) {
      db.insert(otpLogs)
        .values({
          phone: body.newPhone,
          purpose: "recover-new",
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
