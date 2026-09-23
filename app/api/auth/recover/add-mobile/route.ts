/**
 * Recovery / add-mobile final step: INSERT a brand-new guardian-link row on
 * the student. The new phone is NOT immediately signed in — the parent
 * needs to log in with it via the normal OTP flow afterwards, which lets
 * /api/auth/otp/verify auto-create a parent (or attach to an existing one)
 * and link this student via the new row's phone_no.
 *
 *   POST { studentId, oldPhone?, otp, newPhone, guardianName, relation }
 *     → { ok: true, rowIdx: number }
 *
 * Identity must have been proven via one of:
 *   recover:ok:{studentId}       (Path A — old phone OTP verified)
 *   recover:email-ok:{studentId} (Path B — registered email OTP verified)
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "@node-rs/bcrypt";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { redis } from "@/server/redis";
import { rateLimit } from "@/server/rate-limit";
import { upsertGuardianLink } from "@/server/repos/guardians";
import { TC_VERSION } from "@/lib/legal/terms";

const Relations = [
  "Father",
  "Mother",
  "Brother",
  "Sister",
  "Grandparent",
  "Uncle",
  "Aunt",
  "Guardian",
] as const;

const Body = z.object({
  studentId: z.string().uuid(),
  oldPhone: z.string().regex(/^\d{10}$/).optional(),
  otp: z.string().regex(/^\d{6}$/),
  newPhone: z.string().regex(/^\d{10}$/, "Enter a valid 10-digit number"),
  guardianName: z.string().trim().min(2).max(80),
  relation: z.enum(Relations),
});
const MAX_ATTEMPTS = 5;

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const rl = await rateLimit({
    key: `recover-addmobile:${ip}`,
    max: 15,
    windowSeconds: 10 * 60,
  });
  if (!rl.ok)
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
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

  const attempts = await redis.incr(`otp:attempts:${body.newPhone}`);
  if (attempts === 1) await redis.expire(`otp:attempts:${body.newPhone}`, 600);
  if (attempts > MAX_ATTEMPTS)
    return NextResponse.json(
      { error: "Too many attempts. Request a new OTP." },
      { status: 429 }
    );
  const stored = await redis.get(`otp:${body.newPhone}`);
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

  // Reject if the new number is already linked to THIS student.
  const existing = (await db.execute(sql`
    SELECT 1 FROM student_guardian_links
    WHERE student_id = ${body.studentId}
      AND right(regexp_replace(coalesce(phone_no,''), '\D', '', 'g'), 10) = ${body.newPhone}
    LIMIT 1
  `)) as unknown as Array<unknown>;
  const dup = Array.isArray(existing)
    ? existing.length > 0
    : ((existing as { rows?: unknown[] }).rows ?? []).length > 0;
  if (dup)
    return NextResponse.json(
      { error: "That number is already linked to this student." },
      { status: 409 }
    );

  // Insert the new link via the canonical helper so the new phone:
  //   • dedupes by (student, phone) — no-op if already exists,
  //   • find-or-creates the parents row for the new phone,
  //   • runs recomputeStudentParent so the student's primary parent
  //     reflects the lowest-row_idx phone after the addition.
  await upsertGuardianLink({
    consent: { version: TC_VERSION },
    studentId: body.studentId,
    phone: body.newPhone,
    name: body.guardianName,
    relation: body.relation,
  });
  // row_idx is allocated by the helper; surface it for clients that
  // want to know where it landed.
  const [placed] = (await db.execute(sql`
    SELECT row_idx FROM student_guardian_links
     WHERE student_id = ${body.studentId}
       AND right(regexp_replace(coalesce(phone_no,''), '\D', '', 'g'), 10) = ${body.newPhone}
     LIMIT 1
  `)) as unknown as Array<{ row_idx: number }>;
  const rowIdx = placed?.row_idx ?? 0;

  await redis.del(`otp:${body.newPhone}`);
  await redis.del(`otp:attempts:${body.newPhone}`);
  await redis.del(`recover:ok:${body.studentId}`);
  await redis.del(`recover:email-ok:${body.studentId}`);

  return NextResponse.json({ ok: true, rowIdx });
}
