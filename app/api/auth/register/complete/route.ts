/**
 * New-user registration step 2.
 *
 *   POST { phone, otp, studentId, email }  →  { ok: true } (+ session cookie)
 *
 * Verifies the OTP issued by /api/auth/register, attaches the chosen student
 * to the freshly-created parent account, captures the email on the customer
 * record, marks the student `is_verified` (so admin sees the confirmation),
 * links the phone in student_guardian_links, and signs the parent in.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "@node-rs/bcrypt";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { parents, students } from "@/db/schema";
import { redis } from "@/server/redis";
import { rateLimit } from "@/server/rate-limit";
import { createParentSession } from "@/server/session";
import { upsertGuardianLink } from "@/server/repos/guardians";

const Body = z.object({
  phone: z.string().regex(/^\d{10}$/),
  otp: z.string().regex(/^\d{6}$/),
  studentId: z.string().uuid(),
  email: z.string().email(),
});
const MAX_ATTEMPTS = 5;

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const rl = await rateLimit({
    key: `register-complete:${ip}`,
    max: 20,
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

  // ── Verify the OTP ────────────────────────────────────────────────
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
      { error: "Incorrect code. Try again." },
      { status: 401 }
    );

  // ── Resolve the parent created by /api/auth/register ──────────────
  const [parent] = await db
    .select()
    .from(parents)
    .where(eq(parents.phone, body.phone))
    .limit(1);
  if (!parent)
    return NextResponse.json(
      { error: "Start registration again." },
      { status: 409 }
    );
  if (parent.status !== "active")
    return NextResponse.json(
      { error: "Account is inactive. Contact support." },
      { status: 403 }
    );

  // ── Resolve the chosen student ────────────────────────────────────
  const [student] = await db
    .select({ id: students.id, parentId: students.parentId })
    .from(students)
    .where(eq(students.id, body.studentId))
    .limit(1);
  if (!student)
    return NextResponse.json(
      { error: "Student not found. Pick again." },
      { status: 404 }
    );

  // ── Apply the registration ────────────────────────────────────────
  await db
    .update(parents)
    .set({ email: body.email, firstTimeLogin: false })
    .where(eq(parents.id, parent.id));

  // Mark verified separately — upsertGuardianLink handles parent_id +
  // link insert + sibling auto-grouping in a single transaction.
  await db
    .update(students)
    .set({ isVerified: true, verifiedAt: new Date() })
    .where(eq(students.id, student.id));

  // Single canonical write: dedupes by (student, phone), find-or-creates
  // the parents row (idempotent with the parent we just OTP'd), attaches
  // the student if unclaimed (no-op if already attached), and runs
  // recomputeStudentParent at the end.
  await upsertGuardianLink({
    studentId: student.id,
    phone: body.phone,
    name: parent.name,
    relation: "Self",
    email: body.email,
  });

  await redis.del(`otp:${body.phone}`);
  await redis.del(`otp:attempts:${body.phone}`);

  await db.update(parents).set({ lastLoginAt: new Date() }).where(eq(parents.id, parent.id));
  await createParentSession(parent.id, body.phone);
  return NextResponse.json({ ok: true });
}
