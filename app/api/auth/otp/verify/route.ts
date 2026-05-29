import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "@node-rs/bcrypt";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { parents, otpLogs } from "@/db/schema";
import { redis } from "@/lib/redis";
import { createParentSession } from "@/lib/session";
import { last10Sql } from "@/lib/phone";
import { resolveFamilyParent } from "@/lib/parent-lookup";
import { scheduleParentBackfill } from "@/lib/erp-backfill";

const Body = z.object({
  phone: z.string().regex(/^\d{10}$/),
  otp: z.string().regex(/^\d{6}$/),
});

const MAX_ATTEMPTS = 5;

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";

  let body;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // attempts counter (anti brute-force)
  const attempts = await redis.incr(`otp:attempts:${body.phone}`);
  if (attempts === 1) await redis.expire(`otp:attempts:${body.phone}`, 600);
  if (attempts > MAX_ATTEMPTS) {
    db.insert(otpLogs)
      .values({ phone: body.phone, purpose: "login", event: "verify_failed", error: "max attempts exceeded", ip })
      .catch(console.error);
    return NextResponse.json(
      { error: "Too many attempts. Request a new OTP." },
      { status: 429 }
    );
  }

  const stored = await redis.get(`otp:${body.phone}`);
  if (!stored) {
    return NextResponse.json(
      { error: "OTP expired. Request a new one." },
      { status: 400 }
    );
  }

  const ok = await bcrypt.compare(body.otp, stored);
  if (!ok) {
    db.insert(otpLogs)
      .values({ phone: body.phone, purpose: "login", event: "verify_failed", error: "incorrect code", ip })
      .catch(console.error);
    return NextResponse.json(
      { error: "Incorrect code. Try again." },
      { status: 401 }
    );
  }

  // success — clean up
  await redis.del(`otp:${body.phone}`);
  await redis.del(`otp:attempts:${body.phone}`);

  // ── Resolve the family's parents row (one row per family) ────────
  // Walks the student-guardian graph first so a second guardian's number
  // routes to the same parents row, and a zero-student "zombie" row
  // never shadows the real family parent.
  let parent = await resolveFamilyParent(body.phone);
  const isFirstLogin = !parent;
  if (!parent) {
    // Gate on ERP guardian match to prevent arbitrary signups.
    // OTP_TEST_BYPASS=1 skips this for staging/demo environments.
    if (process.env.OTP_TEST_BYPASS !== "1") {
      // Only count phone matches whose student has NO parent yet — those
      // are the un-claimed link rows we're allowed to auto-attach to a
      // fresh parents row. A phone that still appears on a guardian
      // record but whose student is already claimed by another parent
      // (stale data after a phone change, sibling under a different
      // parent, etc.) must NOT cause us to create a zombie parent row
      // with no students attached; that's exactly the "no student
      // attached" dead-end the recovery flow exists to handle.
      const guardianMatch = await db.execute(sql`
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
      `);
      const matched = (guardianMatch as unknown as unknown[]).length > 0;
      if (!matched) {
        return NextResponse.json(
          {
            error:
              "This number isn't registered with any school. Please contact your school coordinator.",
          },
          { status: 403 }
        );
      }
    }
    const { generateCustomerCode } = await import("@/lib/customer-numbering");
    const customerCode = await generateCustomerCode();
    [parent] = await db
      .insert(parents)
      .values({
        phone: body.phone,
        status: "active",
        customerCode,
        // Parents auto-created from a successful OTP verify don't need to
        // pass through the first-time-setup wall — the OTP itself is proof
        // of ownership of the number, and there's no password to set yet
        // (they can set one later from /account if they want).
        firstTimeLogin: false,
      })
      .returning();
  }
  if (parent.status !== "active") {
    return NextResponse.json(
      { error: "Account is inactive. Contact support." },
      { status: 403 }
    );
  }

  // ── Auto-link ERP students by phone match ─────────────────────
  // Guardians ARE the parents in the ERP data. When a parent verifies
  // their phone we claim every ERP-sourced student whose guardian-link
  // or guardian master-record phone matches (last 10 digits). Idempotent
  // — only touches students where parent_id IS NULL.
  const linkResult = await db.execute(sql`
    UPDATE students s
       SET parent_id = ${parent.id}
      FROM student_guardian_links gl
      LEFT JOIN guardians g ON g.erp_name = gl.guardian_erp_name
     WHERE gl.student_id = s.id
       AND s.parent_id IS NULL
       AND (
         ${last10Sql(sql`gl.phone_no`)} = ${body.phone}
         OR ${last10Sql(sql`g.mobile_number`)} = ${body.phone}
         OR ${last10Sql(sql`g.alternate_number`)} = ${body.phone}
       )
  `);
  const linkedStudents = Number((linkResult as unknown as { count?: number }).count ?? 0);

  // OTP is always a valid sign-in path, even for families that have set a
  // password. The previous "password required when is_verified" gate has
  // been retired so any guardian can fall back to OTP if they don't have
  // the password handy.

  // On first login, pull a friendly name from the matched guardian record.
  if (isFirstLogin && !parent.name) {
    const nameRows = await db.execute(sql`
      SELECT guardian_name AS name FROM guardians
       WHERE ${last10Sql(sql`mobile_number`)} = ${body.phone}
          OR ${last10Sql(sql`alternate_number`)} = ${body.phone}
       LIMIT 1
    `);
    const found = (nameRows as unknown as { name: string | null }[])[0]?.name;
    if (found) {
      await db.update(parents).set({ name: found }).where(eq(parents.id, parent.id));
    }
  }

  // OTP-only flow: a verified code always issues a session. `is_verified`
  // is set by /api/auth/first-time/complete (the canonical first-login
  // path) and inherited at student-creation time, not here — OTP-only
  // sign-ins don't promote verification on their own.
  await createParentSession(parent.id, body.phone);
  db.insert(otpLogs)
    .values({ phone: body.phone, purpose: "login", event: "verified", ip })
    .catch(console.error);
  // Fire-and-forget: mirror this parent's historical ERP orders so they
  // show up under /shop/orders without waiting for the delta-poll to
  // happen to touch them. Cooldown-throttled per-phone.
  scheduleParentBackfill(body.phone);
  return NextResponse.json({ ok: true, isNew: isFirstLogin, linkedStudents });
}
