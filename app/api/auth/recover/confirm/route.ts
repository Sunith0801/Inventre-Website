/**
 * Recovery final step — switches the parent's phone to the new number and
 * signs them in. Accepts either of two identity proofs (set by an earlier
 * step):
 *
 *   recover:ok:{studentId}       (Path A — old phone OTP verified)
 *   recover:email-ok:{studentId} (Path B — registered email OTP verified)
 *
 *   POST { studentId, oldPhone?, otp, newPhone }  →  { ok: true } (+ cookie)
 *
 * oldPhone is required only for Path A. For Path B we trust the email
 * marker, which is scoped to a specific parentId.
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
  studentId: z.string().uuid(),
  oldPhone: z.string().regex(/^\d{10}$/).optional(),
  otp: z.string().regex(/^\d{6}$/),
  newPhone: z.string().regex(/^\d{10}$/, "Enter a valid 10-digit number"),
});
const MAX_ATTEMPTS = 5;

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const rl = await rateLimit({
    key: `recover-confirm:${ip}`,
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

  // ── Identity must have been proven via Path A or Path B ──────
  const phoneMarker = await redis.get(`recover:ok:${body.studentId}`);
  const emailMarker = await redis.get(`recover:email-ok:${body.studentId}`);
  const phoneOk = !!(body.oldPhone && phoneMarker === body.oldPhone);
  if (!phoneOk && !emailMarker)
    return NextResponse.json(
      { error: "Verify your identity first." },
      { status: 403 }
    );

  // ── Verify OTP on the NEW number ──────────────────────────────
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

  // ── Resolve parent (or lazy-create it for Path B with no linked parent) ──
  const [stu] = await db
    .select({ parentId: students.parentId })
    .from(students)
    .where(eq(students.id, body.studentId))
    .limit(1);
  if (!stu)
    return NextResponse.json({ error: "Student not found." }, { status: 404 });

  // Path A always requires an existing parent (the verified old phone must
  // belong to one). Path B can promote a guardian-only student into a parent
  // record using the new phone the user just verified.
  let parentId: string | null = stu.parentId ?? null;
  let parentPhone = "";

  if (parentId) {
    const [parent] = await db
      .select({ id: parents.id, phone: parents.phone, status: parents.status })
      .from(parents)
      .where(eq(parents.id, parentId))
      .limit(1);
    if (!parent)
      return NextResponse.json(
        { error: "Records changed. Start the recovery again." },
        { status: 409 }
      );
    if (phoneOk) {
      if (parent.phone.replace(/\D/g, "").slice(-10) !== body.oldPhone!)
        return NextResponse.json(
          { error: "Records changed. Start the recovery again." },
          { status: 409 }
        );
    } else if (emailMarker !== parent.id && emailMarker !== "pending") {
      return NextResponse.json(
        { error: "Verify your identity first." },
        { status: 403 }
      );
    }
    if (parent.status !== "active")
      return NextResponse.json(
        { error: "Account is inactive. Contact support." },
        { status: 403 }
      );
    parentPhone = parent.phone;
  } else {
    // No parent linked. This can only happen on the email path — the marker
    // must be present (already checked above). Create a parent from the
    // first guardian-link row + the freshly verified new phone.
    if (!emailMarker)
      return NextResponse.json(
        { error: "Verify your identity first." },
        { status: 403 }
      );
    const guardian = (await db.execute(sql`
      SELECT guardian_name, email FROM student_guardian_links
      WHERE student_id = ${body.studentId}
      ORDER BY row_idx ASC
      LIMIT 1
    `)) as unknown as Array<{ guardian_name: string | null; email: string | null }>;
    const g = guardian[0] ?? { guardian_name: null, email: null };
    // newPhone must be free at this point (checked below regardless).
    const { generateCustomerCode } = await import("@/server/customer-numbering");
    const customerCode = await generateCustomerCode();
    // ON CONFLICT race-recovery against the parents_phone_idx unique
    // index. If a parallel OTP-verify on the same number microseconds
    // earlier already minted the parent, reuse that row instead of
    // failing with a 500.
    await db
      .insert(parents)
      .values({
        phone: body.newPhone,
        name: g.guardian_name ?? null,
        email: g.email ?? null,
        customerCode,
        status: "active",
      })
      .onConflictDoNothing({ target: parents.phone });
    const [created] = await db
      .select({ id: parents.id, phone: parents.phone })
      .from(parents)
      .where(eq(parents.phone, body.newPhone))
      .limit(1);
    if (!created) {
      return NextResponse.json(
        { error: "Failed to register account. Please try again." },
        { status: 500 }
      );
    }
    parentId = created.id;
    parentPhone = created.phone;
    await db
      .update(students)
      .set({ parentId: parentId })
      .where(eq(students.id, body.studentId));
  }

  // ── New number must be free (excluding our own parent record) ────────
  // Treat an empty-student "zombie" parent occupying this slot as
  // reclaimable: delete it so the UPDATE further down can adopt the
  // phone. Only block when the existing row owns real students.
  const taken = (await db.execute(sql`
    SELECT p.id,
           EXISTS (SELECT 1 FROM students WHERE parent_id = p.id) AS has_student
      FROM parents p
     WHERE p.phone = ${body.newPhone}
       AND p.id <> ${parentId!}
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

  // ── Replace the old number with the new one ──────────────────────────
  // "Change mobile" must actually invalidate the old number EVERYWHERE the
  // login graph might still see it — otherwise the old phone keeps logging
  // in (registered via a stale guardian master or sibling link row) and
  // produces a zombie parent with zero students. Three updates:
  //   1. parents.phone
  //   2. every student_guardian_links row whose phone matches the old
  //      number for ANY student under this parent (covers siblings).
  //   3. guardians.mobile_number / alternate_number on the master ERP
  //      records referenced by this parent's link rows where they still
  //      carry the old phone.
  // For Path A oldPhone is supplied; for Path B we use the parent's
  // current phone (which is the old one being replaced).
  const oldPhone10 = (body.oldPhone ?? parentPhone).replace(/\D/g, "").slice(-10);

  // 1. Update the parent record.
  await db
    .update(parents)
    .set({ phone: body.newPhone })
    .where(eq(parents.id, parentId!));

  // 2. Update guardian-link rows across every student of this parent
  //    whose phone matches the old number. If the specific student we
  //    came in with has zero matches (e.g. Path B with a blank phone_no),
  //    fall back to inserting one so the contact is still recorded.
  await db.execute(sql`
    UPDATE student_guardian_links
       SET phone_no = ${body.newPhone}
     WHERE student_id IN (
             SELECT id FROM students WHERE parent_id = ${parentId!}
           )
       AND right(regexp_replace(coalesce(phone_no,''), '\D', '', 'g'), 10) = ${oldPhone10}
  `);
  const matchedHere = (await db.execute(sql`
    SELECT 1 FROM student_guardian_links
     WHERE student_id = ${body.studentId}
       AND right(regexp_replace(coalesce(phone_no,''), '\D', '', 'g'), 10) = ${body.newPhone}
     LIMIT 1
  `)) as unknown as unknown[];
  const hasNewOnThisStudent = Array.isArray(matchedHere)
    ? matchedHere.length > 0
    : (((matchedHere as { rows?: unknown[] }).rows ?? []).length > 0);
  if (!hasNewOnThisStudent) {
    // Use the canonical helper so the new link is dedup-upserted, the
    // parent_id is recomputed, and any other family ties via this
    // phone get picked up automatically.
    const [primaryName] = (await db.execute(sql`
      SELECT guardian_name FROM student_guardian_links
       WHERE student_id = ${body.studentId} ORDER BY row_idx LIMIT 1
    `)) as unknown as Array<{ guardian_name: string | null }>;
    await upsertGuardianLink({
      studentId: body.studentId,
      phone: body.newPhone,
      name: primaryName?.guardian_name ?? null,
      relation: "Self",
    });
  }

  // 3. Patch the master ERP guardian records referenced by this parent's
  //    link rows. Without this, phone-status / otp-verify still treat the
  //    old number as "known" via the guardian master and let it log in to
  //    a freshly auto-created (empty) parent row.
  await db.execute(sql`
    UPDATE guardians
       SET mobile_number = ${body.newPhone}
     WHERE erp_name IN (
             SELECT DISTINCT gl.guardian_erp_name
               FROM student_guardian_links gl
               JOIN students s ON s.id = gl.student_id
              WHERE s.parent_id = ${parentId!}
                AND gl.guardian_erp_name IS NOT NULL
           )
       AND right(regexp_replace(coalesce(mobile_number,''), '\D', '', 'g'), 10) = ${oldPhone10}
  `);
  await db.execute(sql`
    UPDATE guardians
       SET alternate_number = ${body.newPhone}
     WHERE erp_name IN (
             SELECT DISTINCT gl.guardian_erp_name
               FROM student_guardian_links gl
               JOIN students s ON s.id = gl.student_id
              WHERE s.parent_id = ${parentId!}
                AND gl.guardian_erp_name IS NOT NULL
           )
       AND right(regexp_replace(coalesce(alternate_number,''), '\D', '', 'g'), 10) = ${oldPhone10}
  `);

  await redis.del(`otp:${body.newPhone}`);
  await redis.del(`otp:attempts:${body.newPhone}`);
  await redis.del(`recover:ok:${body.studentId}`);
  await redis.del(`recover:email-ok:${body.studentId}`);

  // ── Sign them in directly — no password ───────────────────────
  await createParentSession(parentId!, body.newPhone);

  return NextResponse.json({ ok: true });
}
