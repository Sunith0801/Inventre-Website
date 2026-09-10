/**
 * "Try another way": before showing the email-OTP step, the client needs to
 * know whether this student has an email on file, and a masked preview.
 *
 * Email precedence (current → fallback):
 *   1. student_guardian_links.email of the first guardian (row_idx ASC)
 *   2. parents.email of the linked parent
 *
 * The link row is authoritative because admins edit guardians directly;
 * parents is the login-account record and may lag behind.
 *
 *   POST { studentId }  →  { hasEmail: boolean, emailMasked?: string }
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { rateLimit } from "@/server/rate-limit";
import { maskEmail } from "@/server/notify/email";

const Body = z.object({ studentId: z.string().uuid() });

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const rl = await rateLimit({
    key: `recover-email-opt:${ip}`,
    max: 30,
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
    SELECT s.is_verified,
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
  `)) as unknown as Array<{ is_verified: boolean | null; email: string | null }>;

  const row = rows[0];
  // Same gate as request-otp: recovery is only for activated accounts.
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
  const email = row?.email ?? null;
  if (!email) return NextResponse.json({ hasEmail: false });
  return NextResponse.json({
    hasEmail: true,
    emailMasked: maskEmail(email),
  });
}
