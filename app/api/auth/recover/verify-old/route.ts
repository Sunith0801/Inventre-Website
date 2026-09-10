/**
 * Recovery step 2a: verify the OTP sent to the OLD number. If the OTP is
 * correct, we sign the parent straight in — proving ownership of the old
 * number is enough. The optional new-number flow (used only via the
 * "Try another way" / email path) does NOT use this route.
 *
 *   POST { studentId, oldPhone, otp }  →  { ok: true }  (+ session cookie)
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "@node-rs/bcrypt";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { parents, students } from "@/db/schema";
import { redis } from "@/server/redis";
import { rateLimit } from "@/server/rate-limit";
import { createParentSession } from "@/server/session";

const Body = z.object({
  studentId: z.string().uuid(),
  oldPhone: z.string().regex(/^\d{10}$/),
  otp: z.string().regex(/^\d{6}$/),
  // "change" (default) — old behaviour, sign the parent in directly.
  // "add"             — only set the recovery marker; the add-mobile flow
  //                     still has to collect guardian name/relation/new
  //                     phone before any session is created.
  intent: z.enum(["change", "add"]).optional(),
});
const MAX_ATTEMPTS = 5;
const MARKER_TTL = 15 * 60;

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const rl = await rateLimit({
    key: `recover-verifyold:${ip}`,
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

  const attempts = await redis.incr(`otp:attempts:${body.oldPhone}`);
  if (attempts === 1) await redis.expire(`otp:attempts:${body.oldPhone}`, 600);
  if (attempts > MAX_ATTEMPTS)
    return NextResponse.json(
      { error: "Too many attempts. Request a new OTP." },
      { status: 429 }
    );

  const stored = await redis.get(`otp:${body.oldPhone}`);
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

  // Re-check the old number really belongs to this student's parent.
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
  const [parent] = await db
    .select({ id: parents.id, phone: parents.phone, status: parents.status })
    .from(parents)
    .where(eq(parents.id, stu.parentId))
    .limit(1);
  if (
    !parent ||
    parent.phone.replace(/\D/g, "").slice(-10) !== body.oldPhone
  ) {
    return NextResponse.json(
      { error: "That number doesn't match our records for this student." },
      { status: 400 }
    );
  }
  if (parent.status !== "active")
    return NextResponse.json(
      { error: "Account is inactive. Contact support." },
      { status: 403 }
    );

  await redis.del(`otp:${body.oldPhone}`);
  await redis.del(`otp:attempts:${body.oldPhone}`);
  // Keep the marker around in case the client (legacy flow) still wants to
  // change the number afterwards — it's harmless to leave for 15 minutes.
  await redis.set(
    `recover:ok:${body.studentId}`,
    body.oldPhone,
    "EX",
    MARKER_TTL
  );

  // Old number verified. Default behaviour is to sign them straight in.
  // For the add-another-mobile flow we hold off — the client still needs
  // to capture guardian name + relation + new phone before any session is
  // issued (that session is created later when the new phone logs in via
  // the normal OTP flow).
  if (body.intent !== "add") {
    await createParentSession(parent.id, body.oldPhone);
  }
  return NextResponse.json({ ok: true });
}
