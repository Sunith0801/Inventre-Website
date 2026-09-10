import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { isResponse, requirePermission } from "@/server/admin-guard";
import { logAdminActivity, diffFields } from "@/server/activity";
import { parseJson } from "@/server/api-handler";
import { emitGuardianEvent, emitStudentEvent } from "@/server/erp-bridge";
import { recomputeStudentParent } from "@/server/repos/guardians";

const PatchBody = z.object({
  phoneNo: z.string().nullable().optional(),
  guardianName: z.string().min(1).optional(),
  relation: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
});

/**
 * Edit an existing guardian link. The mobile field on the Relations tab
 * needs to be live-editable so admins can fix bad imports or update a
 * parent's number without deleting + re-adding (which loses row_idx and
 * sibling-fanout history). Mirrors the POST handler's auto-link side
 * effects so a phone change immediately yields a working /login flow:
 *
 *   1. Update the link row in place (phone_no / guardian_name / etc.).
 *   2. If the phone changed, upsert a `parents` row for the new phone
 *      and attach this student if it was unclaimed. Same logic block
 *      as POST lines 36-148, just keyed to a known link row.
 *   3. Re-resolve a canonical `guardians.erp_name` for the new phone
 *      (LOCAL-PH-{phone} if the master row needs minting).
 *   4. Fan the new phone out to siblings whose link previously carried
 *      the OLD phone, so the whole family stays in sync (symmetric with
 *      the POST fan-out + DELETE fan-out at lines 41-48 below).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; rowId: string }> }) {
  const guard = await requirePermission("students.write");
  if (isResponse(guard)) return guard;
  const { id: studentId, rowId } = await params;
  const parsed = await parseJson(req, PatchBody);
  if (parsed instanceof NextResponse) return parsed;
  const body: z.infer<typeof PatchBody> = parsed;

  const [existing] = await db
    .select()
    .from(schema.studentGuardianLinks)
    .where(eq(schema.studentGuardianLinks.id, rowId))
    .limit(1);
  if (!existing || existing.studentId !== studentId) {
    return NextResponse.json({ error: "Guardian link not found" }, { status: 404 });
  }

  const oldPhone = (existing.phoneNo ?? "").replace(/\D/g, "").slice(-10);
  const newPhoneRaw = body.phoneNo === undefined ? existing.phoneNo : body.phoneNo;
  const cleanPhone = (newPhoneRaw ?? "").replace(/\D/g, "").slice(-10);
  const cleanEmail = body.email === undefined ? existing.email : (body.email ?? "")?.toString().trim() || null;
  const newGuardianName = body.guardianName ?? existing.guardianName ?? "";
  const newRelation = body.relation === undefined ? existing.relation : body.relation;
  const phoneChanged = oldPhone !== cleanPhone && (oldPhone.length === 10 || cleanPhone.length === 10);

  // Refuse a phone collision: editing a row so it now matches another
  // link on the same student would create a duplicate phone on this
  // student, which the POST flow explicitly dedupes against. Surface a
  // 409 instead of silently producing two identical rows.
  if (cleanPhone.length === 10 && phoneChanged) {
    const collision = (await db.execute(sql`
      SELECT 1 FROM student_guardian_links
       WHERE student_id = ${studentId}
         AND id <> ${rowId}
         AND right(regexp_replace(coalesce(phone_no, ''), '\D', '', 'g'), 10) = ${cleanPhone}
       LIMIT 1
    `)) as unknown as unknown[];
    if (collision.length > 0) {
      return NextResponse.json(
        { error: "This student already has another guardian with that phone" },
        { status: 409 }
      );
    }
  }

  // ── 1. Upsert a parents row for the new phone (POST handler lines 36-74) ──
  if (phoneChanged && cleanPhone.length === 10) {
    const [existingParent] = await db
      .select({ id: schema.parents.id, name: schema.parents.name, email: schema.parents.email })
      .from(schema.parents)
      .where(eq(schema.parents.phone, cleanPhone))
      .limit(1);
    let parentId: string;
    if (existingParent) {
      parentId = existingParent.id;
      const patch: Record<string, unknown> = {};
      if (!existingParent.name) patch.name = newGuardianName;
      if (!existingParent.email && cleanEmail) patch.email = cleanEmail;
      if (Object.keys(patch).length > 0) {
        await db.update(schema.parents).set(patch).where(eq(schema.parents.id, parentId));
      }
    } else {
      const { generateCustomerCode } = await import("@/server/customer-numbering");
      const customerCode = await generateCustomerCode();
      const [created] = await db
        .insert(schema.parents)
        .values({
          phone: cleanPhone,
          name: newGuardianName,
          email: cleanEmail,
          customerCode,
          status: "active",
        })
        .returning({ id: schema.parents.id });
      parentId = created.id;
    }

    // Attach the student to this parent if it was unclaimed (and inherit
    // is_verified from any already-verified sibling — same rule as POST).
    const [stu] = await db
      .select({ parentId: schema.students.parentId, isVerified: schema.students.isVerified })
      .from(schema.students)
      .where(eq(schema.students.id, studentId))
      .limit(1);
    if (stu && !stu.parentId) {
      const verifiedSibling = (await db.execute(sql`
        SELECT 1 FROM students
         WHERE parent_id = ${parentId} AND is_verified = true AND id <> ${studentId}
         LIMIT 1
      `)) as unknown as unknown[];
      const inheritVerified = verifiedSibling.length > 0;
      await db
        .update(schema.students)
        .set({ parentId, ...(inheritVerified && !stu.isVerified ? { isVerified: true, verifiedAt: new Date() } : {}) })
        .where(eq(schema.students.id, studentId));
    }
  }

  // ── 2. Resolve / mint a canonical guardian master row for the new phone.
  //    Same shape as POST's `ensureGuardianMaster` for the phoned-guardian
  //    branch — dedupes by last-10 of mobile_number into LOCAL-PH-{phone}.
  let resolvedErpName: string | null = existing.guardianErpName ?? null;
  if (cleanPhone.length === 10 && phoneChanged) {
    const matched = (await db.execute(sql`
      SELECT id, erp_name FROM guardians
       WHERE right(regexp_replace(coalesce(mobile_number, ''), '\D', '', 'g'), 10) = ${cleanPhone}
       LIMIT 1
    `)) as unknown as Array<{ id: string; erp_name: string | null }>;
    if (matched.length > 0) {
      if (matched[0].erp_name) {
        resolvedErpName = matched[0].erp_name;
      } else {
        const minted = `LOCAL-PH-${cleanPhone}`;
        await db
          .update(schema.guardians)
          .set({ erpName: minted })
          .where(eq(schema.guardians.id, matched[0].id));
        resolvedErpName = minted;
      }
    } else {
      const minted = `LOCAL-PH-${cleanPhone}`;
      await db.insert(schema.guardians).values({
        erpName: minted,
        guardianName: newGuardianName,
        mobileNumber: cleanPhone,
        emailAddress: cleanEmail ?? null,
        email: cleanEmail ?? null,
      });
      resolvedErpName = minted;
    }
  }

  // ── 3. Update the link row in place
  const phoneNoForLink = cleanPhone.length === 10 ? cleanPhone : newPhoneRaw ?? null;
  await db
    .update(schema.studentGuardianLinks)
    .set({
      phoneNo: phoneNoForLink,
      guardianName: newGuardianName,
      relation: newRelation ?? null,
      email: cleanEmail ?? null,
      guardianErpName: resolvedErpName,
    })
    .where(eq(schema.studentGuardianLinks.id, rowId));

  // ── 4. Fan the new phone out to siblings whose link carried the old
  //    phone (so the whole household stays consistent). Skip when the
  //    phone didn't change.
  if (phoneChanged && oldPhone.length === 10) {
    const [stu] = await db
      .select({ parentId: schema.students.parentId })
      .from(schema.students)
      .where(eq(schema.students.id, studentId))
      .limit(1);
    if (stu?.parentId) {
      await db.execute(sql`
        UPDATE student_guardian_links sgl
           SET phone_no = ${phoneNoForLink},
               guardian_erp_name = ${resolvedErpName},
               guardian_name = ${newGuardianName},
               relation = ${newRelation ?? null},
               email = ${cleanEmail ?? null}
          FROM students s
         WHERE sgl.student_id = s.id
           AND s.parent_id = ${stu.parentId}
           AND s.id <> ${studentId}
           AND right(regexp_replace(coalesce(sgl.phone_no, ''), '\D', '', 'g'), 10) = ${oldPhone}
      `);
    }
  }

  // Phone is canonical: re-resolve parent_id from current links so a
  // phone edit immediately re-parents the student onto the right
  // family (or detaches if no link has a matching parent).
  await recomputeStudentParent(studentId);

  revalidatePath("/admin/students");
  revalidatePath(`/admin/students/${studentId}`);
  revalidatePath("/admin/guardians");
  void emitGuardianEvent(rowId);
  void emitStudentEvent(studentId);

  const changes = diffFields(
    {
      phoneNo: existing.phoneNo,
      guardianName: existing.guardianName,
      relation: existing.relation,
      email: existing.email,
    },
    {
      phoneNo: phoneNoForLink,
      guardianName: newGuardianName,
      relation: newRelation ?? null,
      email: cleanEmail ?? null,
    },
    {
      phoneNo: "Phone",
      guardianName: "Guardian name",
      relation: "Relation",
      email: "Email",
    }
  );
  if (changes.length > 0) {
    void logAdminActivity(guard, {
      action: "student.guardian.update",
      entityType: "student",
      entityId: studentId,
      summary: `Updated guardian ${changes.map((c) => c.label ?? c.field).join(", ")}`,
      changes,
      req,
    });
  }

  return NextResponse.json({ ok: true, phoneChanged });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; rowId: string }> }) {
  const guard = await requirePermission("students.write");
  if (isResponse(guard)) return guard;
  const { id: studentId, rowId } = await params;

  // Snapshot what's being deleted so we can mirror the removal across
  // siblings under the same family (POST fan-outs new guardians; DELETE
  // must fan out removals to stay symmetric — see 36239f2).
  const [target] = await db
    .select({
      phoneNo: schema.studentGuardianLinks.phoneNo,
      guardianName: schema.studentGuardianLinks.guardianName,
    })
    .from(schema.studentGuardianLinks)
    .where(eq(schema.studentGuardianLinks.id, rowId))
    .limit(1);

  await db
    .delete(schema.studentGuardianLinks)
    .where(eq(schema.studentGuardianLinks.id, rowId));

  if (target) {
    const cleanPhone = (target.phoneNo ?? "").replace(/\D/g, "").slice(-10);
    const [stu] = await db
      .select({ parentId: schema.students.parentId })
      .from(schema.students)
      .where(eq(schema.students.id, studentId))
      .limit(1);

    if (stu?.parentId) {
      if (cleanPhone.length === 10) {
        // Phone-matched: delete every sibling's row that carries the same
        // last-10 normalised phone. Catches rows that were originally
        // copied from this one regardless of formatting differences.
        await db.execute(sql`
          DELETE FROM student_guardian_links sgl
           USING students s
           WHERE sgl.student_id = s.id
             AND s.parent_id = ${stu.parentId}
             AND s.id <> ${studentId}
             AND right(regexp_replace(coalesce(sgl.phone_no, ''), '\D', '', 'g'), 10) = ${cleanPhone}
        `);
      } else if (target.guardianName) {
        // Phoneless guardians dedup on (guardian_name + phoneless) in
        // POST, so mirror that exact predicate here.
        await db.execute(sql`
          DELETE FROM student_guardian_links sgl
           USING students s
           WHERE sgl.student_id = s.id
             AND s.parent_id = ${stu.parentId}
             AND s.id <> ${studentId}
             AND COALESCE(sgl.guardian_name, '') = ${target.guardianName}
             AND (sgl.phone_no IS NULL OR sgl.phone_no = '')
        `);
      }
    }
  }

  // Re-resolve parent_id from whatever links remain on this student
  // (and on every sibling whose link we mirror-deleted above). If the
  // deleted link was the student's only 10-digit phone, parent_id goes
  // NULL, dropping it from the parent's storefront picker.
  await recomputeStudentParent(studentId);
  if (target) {
    const cleanPhone = (target.phoneNo ?? "").replace(/\D/g, "").slice(-10);
    if (cleanPhone.length === 10) {
      const [stu] = await db
        .select({ parentId: schema.students.parentId })
        .from(schema.students)
        .where(eq(schema.students.id, studentId))
        .limit(1);
      if (stu?.parentId) {
        const siblings = await db
          .select({ id: schema.students.id })
          .from(schema.students)
          .where(
            and(
              eq(schema.students.parentId, stu.parentId),
              ne(schema.students.id, studentId)
            )
          );
        for (const sib of siblings) await recomputeStudentParent(sib.id);
      }
    }
  }

  // Drop the App Router cache for the current detail page (and the
  // students list, where guardian counts may surface) so router.refresh()
  // from the client picks up fresh data instead of a stale RSC payload.
  // /admin/guardians is revalidated so its linked-students count reflects
  // the removal (the master row itself is intentionally retained — it may
  // still be referenced by sibling links and is cheap to keep around).
  revalidatePath("/admin/students");
  revalidatePath(`/admin/students/${studentId}`);
  revalidatePath("/admin/guardians");

  void logAdminActivity(guard, {
    action: "student.guardian.delete",
    entityType: "student",
    entityId: studentId,
    summary: `Removed guardian ${target?.guardianName ?? target?.phoneNo ?? rowId}`,
    req,
  });

  return NextResponse.json({ ok: true });
}
