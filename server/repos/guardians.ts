import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { parents, students, studentGuardianLinks } from "@/db/schema";
import { last10 } from "@/lib/phone";

/**
 * Phone-as-canonical-guardian-identifier upsert.
 *
 * Every write path into `student_guardian_links` (ERPNext bulk sync, ERP
 * order import, admin manual add, bulk CSV upload) funnels through this
 * one helper. Side effects, all in one transaction:
 *
 *   1. Normalise the phone to last-10 digits (matches the SQL unique
 *      index in migration 0020). Throws if fewer than 10 digits remain.
 *   2. Find-or-create the `parents` row keyed on that phone.
 *   3. If the student's `parent_id` is null, set it to the resolved
 *      parent — the "sibling auto-grouping" step. Every student that
 *      shares any guardian phone with an existing parent immediately
 *      joins that family on the next read.
 *   4. Find any existing link row for (student_id, last10(phone)).
 *        - If found: merge name/relation/email when ours is blank;
 *          append `sourceGuardianErpName` to `known_erp_names` (dedup);
 *          if our row's `guardian_erp_name` is null, adopt the new one.
 *        - If not found: insert a new link row carrying the normalised
 *          10-digit phone + known_erp_names = [sourceGuardianErpName].
 *
 * The unique partial index `student_guardian_links_unique_phone` is the
 * structural guarantee that even if a future caller forgets this helper,
 * the DB will reject a second row for the same student + same phone.
 */
export async function upsertGuardianLink(args: {
  studentId: string;
  phone: string;
  /** Guardian display name. Used to populate the link's guardian_name
   *  if currently null/empty. Doesn't overwrite an existing non-empty
   *  value (admin edits win). Also used when creating a new `parents`
   *  row for an unseen phone. */
  name?: string | null;
  /** Father / Mother / Guardian / etc. — copied to the link row if our
   *  row's relation is currently null/empty. */
  relation?: string | null;
  /** Optional email; same merge rule as name. */
  email?: string | null;
  /** ERPNext Guardian DocType ID (or any other source-side identifier).
   *  Folded into known_erp_names rather than treated as a separate
   *  guardian — so two ERP Guardian docs sharing one phone collapse
   *  cleanly. Pass null/undefined when there is no source ID (e.g.
   *  admin manual add). */
  sourceGuardianErpName?: string | null;
}): Promise<{ id: string; parentId: string }> {
  const n10 = last10(args.phone);
  if (!n10) {
    throw new Error(
      `upsertGuardianLink: phone "${args.phone}" did not normalise to 10 digits`
    );
  }
  const cleanName = args.name?.trim() || null;
  const cleanRelation = args.relation?.trim() || null;
  const cleanEmail = args.email?.trim() || null;
  const sourceErp = args.sourceGuardianErpName?.trim() || null;

  return db.transaction(async (tx) => {
    // 1. Resolve parent by phone (find-or-create with race recovery).
    let parentRow = await tx
      .select({ id: parents.id, name: parents.name })
      .from(parents)
      .where(eq(parents.phone, n10))
      .limit(1);
    let parentId: string;
    if (parentRow[0]) {
      parentId = parentRow[0].id;
      // Fill in the parent's name if we just learned it.
      if (!parentRow[0].name && cleanName) {
        await tx
          .update(parents)
          .set({ name: cleanName })
          .where(eq(parents.id, parentId));
      }
    } else {
      const [inserted] = await tx
        .insert(parents)
        .values({
          phone: n10,
          name: cleanName,
          email: cleanEmail,
          status: "active",
          firstTimeLogin: true,
        })
        .onConflictDoNothing({ target: parents.phone })
        .returning({ id: parents.id });
      if (inserted) {
        parentId = inserted.id;
      } else {
        // Race: another tx inserted the same phone between SELECT and
        // INSERT. Refetch.
        const [refetch] = await tx
          .select({ id: parents.id })
          .from(parents)
          .where(eq(parents.phone, n10))
          .limit(1);
        if (!refetch) {
          throw new Error(
            `upsertGuardianLink: parent insert race on phone ${n10} and refetch miss`
          );
        }
        parentId = refetch.id;
      }
    }

    // 2. Sibling auto-grouping: pin the student to this parent if
    //    unclaimed. We never re-assign an already-claimed student;
    //    that's an admin merge operation (out of scope here).
    await tx
      .update(students)
      .set({ parentId })
      .where(and(eq(students.id, args.studentId), sql`${students.parentId} IS NULL`));

    // 3. Find the existing link by (student_id, last10(phone_no)). The
    //    expression mirrors the SQL unique index in migration 0020.
    const existing = await tx
      .select({
        id: studentGuardianLinks.id,
        rowIdx: studentGuardianLinks.rowIdx,
        guardianErpName: studentGuardianLinks.guardianErpName,
        guardianName: studentGuardianLinks.guardianName,
        relation: studentGuardianLinks.relation,
        email: studentGuardianLinks.email,
        knownErpNames: studentGuardianLinks.knownErpNames,
      })
      .from(studentGuardianLinks)
      .where(
        and(
          eq(studentGuardianLinks.studentId, args.studentId),
          sql`right(regexp_replace(coalesce(${studentGuardianLinks.phoneNo}, ''), '\D', '', 'g'), 10) = ${n10}`
        )
      )
      .limit(1);

    if (existing[0]) {
      const row = existing[0];
      // Merge known_erp_names: union with the new sourceErp if not
      // already present, and also fold the row's prior guardian_erp_name
      // in (so subsequent renames don't lose history).
      const merged = new Set(row.knownErpNames ?? []);
      if (row.guardianErpName) merged.add(row.guardianErpName);
      if (sourceErp) merged.add(sourceErp);
      // Only update fields we actually have a better value for; never
      // clobber a non-empty admin-edited field with null.
      const patch: Record<string, unknown> = {
        knownErpNames: Array.from(merged),
        // Always store the normalised 10-digit phone so the unique index
        // sees a stable canonical value.
        phoneNo: n10,
      };
      if (!row.guardianErpName && sourceErp) patch.guardianErpName = sourceErp;
      if (!row.guardianName && cleanName) patch.guardianName = cleanName;
      if (!row.relation && cleanRelation) patch.relation = cleanRelation;
      if (!row.email && cleanEmail) patch.email = cleanEmail;
      await tx
        .update(studentGuardianLinks)
        .set(patch)
        .where(eq(studentGuardianLinks.id, row.id));
      await recomputeStudentParentTx(tx, args.studentId);
      return { id: row.id, parentId };
    }

    // 4. No row for this phone yet — insert.
    const [{ nextIdx }] = await tx
      .select({
        nextIdx: sql<number>`COALESCE(MAX(${studentGuardianLinks.rowIdx}), 0) + 1`,
      })
      .from(studentGuardianLinks)
      .where(eq(studentGuardianLinks.studentId, args.studentId));

    const [inserted] = await tx
      .insert(studentGuardianLinks)
      .values({
        studentId: args.studentId,
        rowIdx: Number(nextIdx) || 1,
        phoneNo: n10,
        guardianErpName: sourceErp,
        guardianName: cleanName,
        relation: cleanRelation,
        email: cleanEmail,
        knownErpNames: sourceErp ? [sourceErp] : [],
      })
      .returning({ id: studentGuardianLinks.id });

    await recomputeStudentParentTx(tx, args.studentId);
    return { id: inserted.id, parentId };
  });
}

/**
 * Companion: prune the link rows on a student whose normalised phone is
 * NOT in the supplied keep-set. Used by the ERPNext bulk sync after it
 * calls upsertGuardianLink() for every guardian in the latest ERP
 * payload — anything in the DB that the ERP no longer ships is removed.
 *
 * Pass an empty `keepPhones` to delete every link on the student.
 */
export async function pruneGuardianLinksNotIn(
  studentId: string,
  keepPhones: string[]
): Promise<number> {
  const cleaned = Array.from(
    new Set(keepPhones.map((p) => last10(p)).filter((p): p is string => !!p))
  );
  // Drizzle drops `NOT IN ()` correctly only when the array is non-empty;
  // when empty, we want to delete everything for this student.
  if (cleaned.length === 0) {
    const res = await db
      .delete(studentGuardianLinks)
      .where(eq(studentGuardianLinks.studentId, studentId));
    await recomputeStudentParent(studentId);
    return res.count ?? 0;
  }
  const res = await db
    .delete(studentGuardianLinks)
    .where(
      and(
        eq(studentGuardianLinks.studentId, studentId),
        sql`right(regexp_replace(coalesce(${studentGuardianLinks.phoneNo}, ''), '\D', '', 'g'), 10) NOT IN ${sql`(${sql.join(
          cleaned.map((p) => sql`${p}`),
          sql`, `
        )})`}`
      )
    );
  await recomputeStudentParent(studentId);
  return res.count ?? 0;
}

/**
 * Bring `students.parent_id` back in sync with the student's current
 * guardian-link rows. Phone is canonical: the parent matching the
 * lowest-row_idx 10-digit guardian phone owns the student. If there's
 * no 10-digit phone on any link, the student is detached (parent_id
 * goes NULL).
 *
 * Called automatically at the end of every helper in this module + by
 * the admin guardian PATCH/DELETE routes. Idempotent — safe to call
 * twice in a row.
 *
 * Implementation is split in two so it can run inside an outer
 * transaction (Tx variant) or stand alone (the public variant).
 */
export async function recomputeStudentParent(studentId: string): Promise<{
  changed: boolean;
  newParentId: string | null;
}> {
  return db.transaction((tx) => recomputeStudentParentTx(tx, studentId));
}

async function recomputeStudentParentTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  studentId: string
): Promise<{ changed: boolean; newParentId: string | null }> {
  const [{ currentParentId }] = await tx
    .select({ currentParentId: students.parentId })
    .from(students)
    .where(eq(students.id, studentId));

  // Lowest-row_idx link with a 10-digit phone.
  const primary = (await tx.execute(sql`
    SELECT right(regexp_replace(coalesce(phone_no, ''), '\D', '', 'g'), 10) AS n10
      FROM student_guardian_links
     WHERE student_id = ${studentId}
       AND length(right(regexp_replace(coalesce(phone_no, ''), '\D', '', 'g'), 10)) = 10
     ORDER BY row_idx ASC, id ASC
     LIMIT 1
  `)) as unknown as Array<{ n10: string }>;

  let targetParentId: string | null = null;
  if (primary.length > 0) {
    const n10 = primary[0].n10;
    const [matched] = await tx
      .select({ id: parents.id })
      .from(parents)
      .where(eq(parents.phone, n10))
      .limit(1);
    targetParentId = matched?.id ?? null;
  }

  if (targetParentId === currentParentId) {
    return { changed: false, newParentId: currentParentId };
  }
  await tx
    .update(students)
    .set({ parentId: targetParentId })
    .where(eq(students.id, studentId));
  return { changed: true, newParentId: targetParentId };
}
