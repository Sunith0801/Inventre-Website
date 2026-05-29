/**
 * "Try another way" step 1: send an OTP to the student's registered email.
 *
 * Email precedence is the same as /recover/email-options:
 *   1. student_guardian_links.email (first guardian by row_idx)
 *   2. parents.email of the linked parent
 *
 * If neither has an email we return 404 + noEmail:true so the UI shows the
 * "We can't find any email registered with your account. Please contact
 * customer service" copy.
 *
 *   POST { studentId }  →  { ok: true, ttl: number, emailMasked }
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "@node-rs/bcrypt";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { redis } from "@/lib/redis";
import { rateLimit } from "@/lib/rate-limit";
import { generateOtp } from "@/lib/sms";
import { sendEmail, maskEmail } from "@/lib/email";
import { getOtpToggles, getBypassOtp } from "@/lib/otp-toggles";

const Body = z.object({ studentId: z.string().uuid() });
const OTP_TTL = 5 * 60;

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const rl = await rateLimit({
    key: `recover-email-otp:${ip}`,
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

  const rows = (await db.execute(sql`
    SELECT s.parent_id,
           s.is_verified,
           p.status AS parent_status,
           COALESCE(NULLIF(gl.email,''), p.email) AS email
    FROM students s
    LEFT JOIN parents p ON p.id = s.parent_id
    LEFT JOIN LATERAL (
      SELECT email FROM student_guardian_links x
      WHERE x.student_id = s.id AND x.email IS NOT NULL AND x.email <> ''
      ORDER BY x.row_idx LIMIT 1
    ) gl ON true
    WHERE s.id = ${body.studentId}
    LIMIT 1
  `)) as unknown as Array<{
    parent_id: string | null;
    is_verified: boolean | null;
    parent_status: string | null;
    email: string | null;
  }>;
  const row = rows[0];
  if (row && row.is_verified === false) {
    return NextResponse.json(
      {
        error:
          "This account hasn't been activated yet. Go back to sign-in and use 'Existing user' with your registered mobile to set up your password first.",
        notVerified: true,
      },
      { status: 403 }
    );
  }
  if (!row || !row.email)
    return NextResponse.json(
      {
        error:
          "We couldn't find any email registered with your account. Please contact customer service.",
        noEmail: true,
      },
      { status: 404 }
    );
  if (row.parent_id && row.parent_status && row.parent_status !== "active")
    return NextResponse.json(
      { error: "Account is inactive. Contact support." },
      { status: 403 }
    );

  // Admin toggle at /admin/settings/otp (system_settings.otp.email_real_send=false)
  // skips real SMTP delivery and pins the code to OTP_BYPASS_CODE.
  const { emailRealSend } = await getOtpToggles();
  const code = emailRealSend ? generateOtp() : getBypassOtp();
  const hash = await bcrypt.hash(code, 8);
  // Tie the OTP to the studentId so a different recovery attempt can't
  // accidentally reuse a stored hash. Stash the parentId (may be null when
  // we only know the guardian) and target email so confirm can complete.
  await redis.set(
    `otp:email:${body.studentId}`,
    JSON.stringify({ hash, parentId: row.parent_id, email: row.email }),
    "EX",
    OTP_TTL
  );
  await redis.del(`otp:email:attempts:${body.studentId}`);

  if (emailRealSend) {
    const send = await sendEmail({
      to: row.email,
      subject: `Inventre verification code: ${code}`,
      text: `Your Inventre verification code is ${code}. It is valid for 5 minutes.\n\nIf you didn't request this, you can ignore this email.`,
      html: `<p>Your Inventre verification code is <b>${code}</b>.</p><p>It is valid for 5 minutes. If you didn't request this, you can ignore this email.</p>`,
    });
    if (!send.ok) {
      // eslint-disable-next-line no-console
      console.error("[recover/email-otp] send failed:", send.error);
      return NextResponse.json(
        { error: "Could not send email right now. Try again in a minute." },
        { status: 502 }
      );
    }
  }

  return NextResponse.json({
    ok: true,
    ttl: OTP_TTL,
    emailMasked: maskEmail(row.email),
  });
}
