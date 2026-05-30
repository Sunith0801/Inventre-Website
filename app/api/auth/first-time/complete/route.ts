/**
 * First-time setup: the parent (added via admin panel) verifies the OTP
 * sent to their registered number, then sets their own password and ticks
 * through the T&C / Privacy acceptance step. After this, first_time_login
 * flips to false and they can sign in with their password or OTP.
 *
 *   POST { phone, otp, password, tcAcceptedVersion }  →  { ok: true }
 *
 * tcAcceptedVersion must match TC_VERSION shipped to the client — guards
 * against direct hits to the endpoint that try to skip the acceptance UI.
 *
 * A session is created on success so the user lands directly in /shop.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "@node-rs/bcrypt";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { parents, students } from "@/db/schema";
import { redis } from "@/lib/redis";
import { rateLimit } from "@/lib/rate-limit";
import { createParentSession } from "@/lib/session";
import { last10Sql } from "@/lib/phone";
import { upsertGuardianLink } from "@/lib/repos/guardians";
import { resolveFamilyParent } from "@/lib/parent-lookup";
import { TC_VERSION } from "@/lib/legal/terms";

const Body = z.object({
  phone: z.string().regex(/^\d{10}$/, "10-digit mobile number required"),
  otp: z.string().regex(/^\d{6}$/, "6-digit OTP required"),
  password: z.string().min(6, "Password must be at least 6 characters").max(200),
  tcAcceptedVersion: z
    .string()
    .min(1, "Accept the Terms & Conditions to continue."),
});

const MAX_ATTEMPTS = 5;

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const rl = await rateLimit({
    key: `firsttime:${ip}`,
    max: 20,
    windowSeconds: 60,
  });
  if (!rl.ok)
    return NextResponse.json(
      { error: "Too many attempts. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );

  let body;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: "Invalid request", details: e },
      { status: 400 }
    );
  }

  // Reject stale clients that pass an old policy version — forces the
  // user back into the acceptance modal with the current text.
  if (body.tcAcceptedVersion !== TC_VERSION) {
    return NextResponse.json(
      {
        error:
          "Our Terms & Conditions have been updated. Please reload the page and accept the latest version.",
      },
      { status: 409 }
    );
  }

  // ── Verify OTP (same scheme as /api/auth/otp/verify) ──────────
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
  const otpOk = await bcrypt.compare(body.otp, stored);
  if (!otpOk)
    return NextResponse.json(
      { error: "Incorrect OTP. Try again." },
      { status: 401 }
    );

  // ── Resolve the family's parent row, auto-creating if needed ──
  // Family-graph lookup first (so a second guardian's number lands on the
  // existing family parent, not a zombie). Auto-create only when no
  // family parent exists yet and the phone has an ERP-guardian match.
  const resolved = await resolveFamilyParent(body.phone);

  if (resolved?.passwordHash) {
    // Case A: family already has a password set and is verified. First-time
    // setup is the wrong route — direct the user to sign in normally.
    // phone-status returns hasPassword=true for this state so the client
    // shouldn't open FirstTimeModal in the first place; this is a defence
    // against stale clients / direct hits to the endpoint.
    return NextResponse.json(
      {
        error: "Password already set. Sign in with your password.",
        passwordRequired: true,
      },
      { status: 409 }
    );
  }

  let parent: { id: string; status: typeof parents.$inferSelect.status; phone: string };
  if (resolved) {
    parent = { id: resolved.id, status: resolved.status, phone: resolved.phone };
  } else {
    // Auto-create gated on an ERP guardian/link match — same gate as
    // /api/auth/otp/verify. OTP_TEST_BYPASS=1 skips it for staging.
    if (process.env.OTP_TEST_BYPASS !== "1") {
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
      if ((guardianMatch as unknown as unknown[]).length === 0) {
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
    // ON CONFLICT (phone) DO NOTHING + refetch: another tab / parallel
    // request can OTP-complete on the same phone microseconds earlier,
    // so the insert must be idempotent against the unique phone index.
    await db
      .insert(parents)
      .values({
        phone: body.phone,
        status: "active",
        customerCode,
        firstTimeLogin: false,
      })
      .onConflictDoNothing({ target: parents.phone });
    const [created] = await db
      .select({ id: parents.id, status: parents.status, phone: parents.phone })
      .from(parents)
      .where(eq(parents.phone, body.phone))
      .limit(1);
    if (!created) {
      return NextResponse.json(
        { error: "Failed to create account. Please try again." },
        { status: 500 }
      );
    }
    parent = created;

    // Attach unclaimed students whose existing guardian-link or
    // guardians-master phone matches this number. Iterate per student
    // and call upsertGuardianLink so each attachment goes through the
    // canonical path (dedup-upsert link + parent attach +
    // recomputeStudentParent in one transaction).
    const candidates = (await db.execute(sql`
      SELECT DISTINCT s.id::text AS id
        FROM students s
        LEFT JOIN student_guardian_links gl ON gl.student_id = s.id
        LEFT JOIN guardians g ON g.erp_name = gl.guardian_erp_name
       WHERE s.parent_id IS NULL
         AND (
           ${last10Sql(sql`gl.phone_no`)} = ${body.phone}
           OR ${last10Sql(sql`g.mobile_number`)} = ${body.phone}
           OR ${last10Sql(sql`g.alternate_number`)} = ${body.phone}
         )
    `)) as unknown as Array<{ id: string }>;
    for (const c of candidates) {
      await upsertGuardianLink({
        studentId: c.id,
        phone: body.phone,
        name: null,
        relation: "Self",
      });
    }
  }
  if (parent.status !== "active")
    return NextResponse.json(
      { error: "Account is inactive. Contact support." },
      { status: 403 }
    );

  await redis.del(`otp:${body.phone}`);
  await redis.del(`otp:attempts:${body.phone}`);

  const passwordHash = await bcrypt.hash(body.password, 10);
  await db
    .update(parents)
    .set({
      passwordHash,
      firstTimeLogin: false,
      tcAcceptedAt: new Date(),
      tcAcceptedVersion: body.tcAcceptedVersion,
    })
    .where(eq(parents.id, parent.id));

  // Mark every student attached to this parent as verified. Match must mirror
  // the phone-status detection: parent_id, link-level phone_no, or the
  // guardian master record's mobile_number — all three count as "this phone".
  await db
    .update(students)
    .set({ isVerified: true, verifiedAt: new Date() })
    .where(
      sql`${students.parentId} = ${parent.id} OR ${students.id} IN (
        SELECT gl.student_id
          FROM student_guardian_links gl
          LEFT JOIN guardians g ON g.erp_name = gl.guardian_erp_name
         WHERE right(regexp_replace(coalesce(gl.phone_no, ''), '\D', '', 'g'), 10) = ${parent.phone}
            OR right(regexp_replace(coalesce(g.mobile_number, ''), '\D', '', 'g'), 10) = ${parent.phone}
      )`
    );

  await db.update(parents).set({ lastLoginAt: new Date() }).where(eq(parents.id, parent.id));

  // Issue a session so the user lands directly in /shop after setup.
  await createParentSession(parent.id, body.phone);
  return NextResponse.json({ ok: true });
}
