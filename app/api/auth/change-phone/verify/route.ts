import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "@node-rs/bcrypt";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { parents, students } from "@/db/schema";
import { recomputeStudentParent } from "@/lib/repos/guardians";
import { redis } from "@/lib/redis";
import { getCurrentParent } from "@/lib/session";
import { parseJson } from "@/lib/api-handler";

const Body = z.object({
  newPhone: z.string().regex(/^\d{10}$/),
  otp: z.string().regex(/^\d{6}$/),
});

const MAX_ATTEMPTS = 5;

export async function POST(req: Request) {
  // Parent-preferred resolver — see request/route.ts for the rationale.
  // (getCurrentUser shadows the parent cookie with an admin cookie when
  // both are present, which would 401 this route for admin-also-parent
  // users.)
  const me = await getCurrentParent();
  if (!me) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await parseJson(req, Body);
  if (body instanceof NextResponse) return body;

  const attemptsKey = `chg-phone:attempts:${me.id}:${body.newPhone}`;
  const attempts = await redis.incr(attemptsKey);
  if (attempts === 1) await redis.expire(attemptsKey, 600);
  if (attempts > MAX_ATTEMPTS) {
    return NextResponse.json(
      { error: "Too many attempts. Request a new code." },
      { status: 429 }
    );
  }

  const otpKey = `chg-phone:otp:${me.id}:${body.newPhone}`;
  const stored = await redis.get(otpKey);
  if (!stored) {
    return NextResponse.json(
      { error: "Code expired. Request a new one." },
      { status: 400 }
    );
  }
  const ok = await bcrypt.compare(body.otp, stored);
  if (!ok) {
    return NextResponse.json(
      { error: "Incorrect code." },
      { status: 401 }
    );
  }

  await redis.del(otpKey);
  await redis.del(attemptsKey);

  // Capture the current phone before overwriting so we can fix up guardian rows.
  const [current] = await db
    .select({ phone: parents.phone })
    .from(parents)
    .where(eq(parents.id, me.id))
    .limit(1);
  const oldPhone10 = (current?.phone ?? "").replace(/\D/g, "").slice(-10);

  await db
    .update(parents)
    .set({ phone: body.newPhone })
    .where(eq(parents.id, me.id));

  // Keep every record that still points at the old number in sync. Without
  // patching the guardians master and link rows, the multi-guardian OTP
  // login (see app/api/auth/otp/verify/route.ts) will keep recognising the
  // old number, lazy-create a zombie parent for it, and block any swap
  // back. recover/confirm runs the same three updates.
  if (oldPhone10.length === 10) {
    // 1. Guardian-link rows. Conflict-safe pattern needed because the
    //    student_guardian_links_unique_phone partial index (migration
    //    0020) rejects (student_id, last10(newPhone)) duplicates. If a
    //    student already has the newPhone as a link, the bulk UPDATE
    //    would 500. Pre-DELETE the oldPhone rows on those students,
    //    then UPDATE the remaining oldPhone rows to newPhone.
    await db.execute(sql`
      DELETE FROM student_guardian_links a
       WHERE a.student_id IN (SELECT id FROM students WHERE parent_id = ${me.id})
         AND right(regexp_replace(coalesce(a.phone_no,''), '\D', '', 'g'), 10) = ${oldPhone10}
         AND EXISTS (
           SELECT 1 FROM student_guardian_links b
            WHERE b.student_id = a.student_id
              AND b.id <> a.id
              AND right(regexp_replace(coalesce(b.phone_no,''), '\D', '', 'g'), 10) = ${body.newPhone}
         )
    `);
    await db.execute(sql`
      UPDATE student_guardian_links
         SET phone_no = ${body.newPhone}
       WHERE student_id IN (SELECT id FROM students WHERE parent_id = ${me.id})
         AND right(regexp_replace(coalesce(phone_no,''), '\D', '', 'g'), 10) = ${oldPhone10}
    `);

    // 2. guardians.mobile_number — conflict-safe against the
    //    guardians_unique_phone partial index (migration 0021). If
    //    another guardians row already carries newPhone, prefer that
    //    canonical row: rewrite link references from the would-be-
    //    renamed row to the canonical, then delete the would-be-renamed
    //    row. Otherwise the simple UPDATE applies.
    await db.execute(sql`
      WITH affected AS (
        SELECT g.id, g.erp_name
          FROM guardians g
         WHERE g.erp_name IN (
                 SELECT DISTINCT gl.guardian_erp_name
                   FROM student_guardian_links gl
                   JOIN students s ON s.id = gl.student_id
                  WHERE s.parent_id = ${me.id}
                    AND gl.guardian_erp_name IS NOT NULL
               )
           AND right(regexp_replace(coalesce(g.mobile_number,''), '\D', '', 'g'), 10) = ${oldPhone10}
      ),
      canonical AS (
        SELECT erp_name FROM guardians
         WHERE right(regexp_replace(coalesce(mobile_number,''), '\D', '', 'g'), 10) = ${body.newPhone}
         LIMIT 1
      ),
      rewrites AS (
        UPDATE student_guardian_links sgl
           SET guardian_erp_name = (SELECT erp_name FROM canonical)
          FROM affected a
         WHERE sgl.guardian_erp_name = a.erp_name
           AND EXISTS (SELECT 1 FROM canonical)
         RETURNING 1
      )
      DELETE FROM guardians g
       USING affected a
       WHERE g.id = a.id AND EXISTS (SELECT 1 FROM canonical)
    `);
    // Plain rename for any affected row that has no canonical conflict.
    await db.execute(sql`
      UPDATE guardians
         SET mobile_number = ${body.newPhone}
       WHERE erp_name IN (
               SELECT DISTINCT gl.guardian_erp_name
                 FROM student_guardian_links gl
                 JOIN students s ON s.id = gl.student_id
                WHERE s.parent_id = ${me.id}
                  AND gl.guardian_erp_name IS NOT NULL
             )
         AND right(regexp_replace(coalesce(mobile_number,''), '\D', '', 'g'), 10) = ${oldPhone10}
    `);

    // 3. guardians.alternate_number — no unique index on this column,
    //    so a plain UPDATE is safe.
    await db.execute(sql`
      UPDATE guardians
         SET alternate_number = ${body.newPhone}
       WHERE erp_name IN (
               SELECT DISTINCT gl.guardian_erp_name
                 FROM student_guardian_links gl
                 JOIN students s ON s.id = gl.student_id
                WHERE s.parent_id = ${me.id}
                  AND gl.guardian_erp_name IS NOT NULL
             )
         AND right(regexp_replace(coalesce(alternate_number,''), '\D', '', 'g'), 10) = ${oldPhone10}
    `);

    // Recompute parent_id for every affected student so the change-phone
    // swap propagates to the parent_id graph (the AFTER UPDATE trigger
    // from migration 0023 also handles this, but this is explicit so we
    // don't depend on trigger ordering).
    const claimed = await db
      .select({ id: students.id })
      .from(students)
      .where(eq(students.parentId, me.id));
    for (const stu of claimed) {
      await recomputeStudentParent(stu.id);
    }
  }

  return NextResponse.json({ ok: true, phone: body.newPhone });
}
