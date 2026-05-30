import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { requireAdmin, isResponse } from "@/lib/admin-guard";
import { parseJson } from "@/lib/api-handler";
import { emitGuardianEvent, emitStudentEvent } from "@/lib/erp-bridge";
import { upsertGuardianLink } from "@/lib/repos/guardians";
import { last10 } from "@/lib/phone";

const Row = z.object({
  guardianErpName: z.string().nullable().optional(),
  guardianName: z.string().min(1),
  relation: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phoneNo: z.string().nullable().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin("super", "ops");
  if (isResponse(guard)) return guard;
  const { id: studentId } = await params;
  const parsed = await parseJson(req, Row);
  if (parsed instanceof NextResponse) return parsed;
  const body: z.infer<typeof Row> = parsed;

  const cleanPhone = last10(body.phoneNo);
  const cleanEmail = (body.email ?? "").trim() || null;

  // ── 1. Ensure a guardians-master row (separate from
  //      student_guardian_links). /admin/guardians lists from this table,
  //      so without it the new guardian wouldn't surface there. The
  //      resolved erp_name is then stamped on the link row so the join
  //      between the two tables stays consistent.
  async function ensureGuardianMaster(): Promise<string | null> {
    if (body.guardianErpName) {
      const [existing] = await db
        .select({
          id: schema.guardians.id,
          guardianName: schema.guardians.guardianName,
          mobileNumber: schema.guardians.mobileNumber,
          email: schema.guardians.email,
          emailAddress: schema.guardians.emailAddress,
        })
        .from(schema.guardians)
        .where(eq(schema.guardians.erpName, body.guardianErpName))
        .limit(1);
      if (existing) {
        const patch: Record<string, unknown> = {};
        if (!existing.guardianName) patch.guardianName = body.guardianName;
        if (!existing.mobileNumber && cleanPhone) patch.mobileNumber = cleanPhone;
        if (!existing.emailAddress && cleanEmail) patch.emailAddress = cleanEmail;
        if (!existing.email && cleanEmail) patch.email = cleanEmail;
        if (Object.keys(patch).length > 0) {
          await db
            .update(schema.guardians)
            .set(patch)
            .where(eq(schema.guardians.id, existing.id));
        }
        return body.guardianErpName;
      }
      await db.insert(schema.guardians).values({
        erpName: body.guardianErpName,
        guardianName: body.guardianName,
        mobileNumber: cleanPhone ?? body.phoneNo ?? null,
        emailAddress: cleanEmail,
        email: cleanEmail,
      });
      return body.guardianErpName;
    }

    if (cleanPhone) {
      const matched = (await db.execute(sql`
        SELECT id, erp_name, guardian_name, mobile_number, email_address, email
          FROM guardians
         WHERE right(regexp_replace(coalesce(mobile_number, ''), '\D', '', 'g'), 10) = ${cleanPhone}
         LIMIT 1
      `)) as unknown as Array<{
        id: string;
        erp_name: string | null;
        guardian_name: string | null;
        mobile_number: string | null;
        email_address: string | null;
        email: string | null;
      }>;
      if (matched.length > 0) {
        const existing = matched[0];
        const patch: Record<string, unknown> = {};
        if (!existing.guardian_name) patch.guardianName = body.guardianName;
        if (!existing.email_address && cleanEmail) patch.emailAddress = cleanEmail;
        if (!existing.email && cleanEmail) patch.email = cleanEmail;
        if (Object.keys(patch).length > 0) {
          await db
            .update(schema.guardians)
            .set(patch)
            .where(eq(schema.guardians.id, existing.id));
        }
        if (!existing.erp_name) {
          const minted = `LOCAL-PH-${cleanPhone}`;
          await db
            .update(schema.guardians)
            .set({ erpName: minted })
            .where(eq(schema.guardians.id, existing.id));
          return minted;
        }
        return existing.erp_name;
      }
      // Mint a fresh master for this phone. ON CONFLICT DO NOTHING
      // covers the race against the partial unique index
      // `guardians_unique_phone` (last10(mobile_number)) added in
      // migration 0021 — when a concurrent admin add inserts the same
      // phone microseconds earlier, we refetch and reuse that row's
      // erp_name instead of failing or producing a duplicate.
      const minted = `LOCAL-PH-${cleanPhone}`;
      await db.execute(sql`
        INSERT INTO guardians (erp_name, guardian_name, mobile_number, email_address, email)
        VALUES (${minted}, ${body.guardianName}, ${cleanPhone}, ${cleanEmail}, ${cleanEmail})
        ON CONFLICT DO NOTHING
      `);
      const refetch = (await db.execute(sql`
        SELECT erp_name FROM guardians
         WHERE right(regexp_replace(coalesce(mobile_number, ''), '\D', '', 'g'), 10) = ${cleanPhone}
         LIMIT 1
      `)) as unknown as Array<{ erp_name: string | null }>;
      return refetch[0]?.erp_name ?? minted;
    }

    // Phoneless guardian — mint a unique synthetic erp_name. Bypasses
    // the phone-keyed dedup helper entirely (the helper requires a phone).
    const minted = `LOCAL-${crypto.randomUUID().slice(0, 12)}`;
    await db.insert(schema.guardians).values({
      erpName: minted,
      guardianName: body.guardianName,
      mobileNumber: null,
      emailAddress: cleanEmail,
      email: cleanEmail,
    });
    return minted;
  }
  const resolvedGuardianErpName = await ensureGuardianMaster();

  // Snapshot the student's pre-existing parent so we can detect "joined
  // a new family" and replay the inheritance / roster-copy steps.
  const [stuBefore] = await db
    .select({
      parentId: schema.students.parentId,
      isVerified: schema.students.isVerified,
    })
    .from(schema.students)
    .where(eq(schema.students.id, studentId))
    .limit(1);
  const wasUnclaimed = !!stuBefore && !stuBefore.parentId;

  // ── 2. Phoneless guardian: take the legacy direct-insert path —
  //      lib/repos/guardians.upsertGuardianLink requires a 10-digit
  //      phone (phone is the canonical key; phoneless guardians can't
  //      participate in the unique index). This is unchanged from the
  //      previous implementation.
  if (!cleanPhone) {
    const [{ next: nextIdx }] = await db
      .select({ next: sql<number>`COALESCE(MAX(row_idx), 0) + 1` })
      .from(schema.studentGuardianLinks)
      .where(eq(schema.studentGuardianLinks.studentId, studentId));
    const [row] = await db
      .insert(schema.studentGuardianLinks)
      .values({
        studentId,
        rowIdx: Number(nextIdx ?? 1),
        guardianErpName: resolvedGuardianErpName ?? body.guardianErpName ?? null,
        guardianName: body.guardianName,
        relation: body.relation ?? null,
        email: cleanEmail,
        phoneNo: body.phoneNo ?? null,
      })
      .returning({ id: schema.studentGuardianLinks.id });
    revalidatePath("/admin/students");
    revalidatePath(`/admin/students/${studentId}`);
    revalidatePath("/admin/guardians");
    void emitGuardianEvent(row.id);
    void emitStudentEvent(studentId);
    return NextResponse.json({ id: row.id });
  }

  // ── 3. Phoned guardian: phone-canonical upsert via the shared
  //      helper. This (a) dedupes the link row by (student, phone),
  //      (b) upserts the `parents` row, (c) attaches the student to
  //      that parent when unclaimed — i.e. sibling auto-grouping.
  const { id: linkId, parentId } = await upsertGuardianLink({
    studentId,
    phone: cleanPhone,
    name: body.guardianName,
    relation: body.relation,
    email: cleanEmail,
    sourceGuardianErpName: resolvedGuardianErpName ?? body.guardianErpName ?? null,
  });

  // ── 4. If the student just joined an existing family (was unclaimed
  //      and the helper attached it to a parent that already had other
  //      students), inherit is_verified from a verified sibling and copy
  //      the family's other guardian phones onto this student. Same
  //      behaviour the old implementation had — same surface to admin.
  if (wasUnclaimed) {
    const verifiedSibling = await db.execute(sql`
      SELECT 1 FROM students
       WHERE parent_id = ${parentId}
         AND is_verified = true
         AND id <> ${studentId}
       LIMIT 1
    `);
    const inheritVerified =
      (verifiedSibling as unknown as unknown[]).length > 0;
    if (inheritVerified && !stuBefore?.isVerified) {
      await db
        .update(schema.students)
        .set({ isVerified: true, verifiedAt: new Date() })
        .where(eq(schema.students.id, studentId));
    }

    // Copy the family's other guardian phones onto this newly attached
    // student so the admin Relations tab shows the full family roster.
    const siblingLinks = (await db.execute(sql`
      SELECT DISTINCT
             right(regexp_replace(coalesce(gl.phone_no, ''), '\D', '', 'g'), 10) AS n10,
             gl.guardian_name, gl.relation, gl.email, gl.guardian_erp_name
        FROM student_guardian_links gl
        JOIN students sib ON sib.id = gl.student_id
       WHERE sib.parent_id = ${parentId}
         AND sib.id <> ${studentId}
         AND length(right(regexp_replace(coalesce(gl.phone_no, ''), '\D', '', 'g'), 10)) = 10
    `)) as unknown as Array<{
      n10: string;
      guardian_name: string | null;
      relation: string | null;
      email: string | null;
      guardian_erp_name: string | null;
    }>;
    for (const sl of siblingLinks) {
      if (sl.n10 === cleanPhone) continue; // already inserted by step 3
      await upsertGuardianLink({
        studentId,
        phone: sl.n10,
        name: sl.guardian_name,
        relation: sl.relation,
        email: sl.email,
        sourceGuardianErpName: sl.guardian_erp_name,
      });
    }
  }

  // ── 5. Fan-out: this guardian belongs to the whole household. Stamp
  //      the same phoned guardian onto every sibling that doesn't have
  //      it yet. upsertGuardianLink is a no-op when a sibling already
  //      has the phone (idempotent).
  if (parentId) {
    const siblings = await db
      .select({ id: schema.students.id })
      .from(schema.students)
      .where(
        and(
          eq(schema.students.parentId, parentId),
          ne(schema.students.id, studentId)
        )
      );
    for (const sib of siblings) {
      await upsertGuardianLink({
        studentId: sib.id,
        phone: cleanPhone,
        name: body.guardianName,
        relation: body.relation,
        email: cleanEmail,
        sourceGuardianErpName: resolvedGuardianErpName ?? body.guardianErpName ?? null,
      });
    }
  }

  revalidatePath("/admin/students");
  revalidatePath(`/admin/students/${studentId}`);
  revalidatePath("/admin/guardians");
  void emitGuardianEvent(linkId);
  void emitStudentEvent(studentId);

  return NextResponse.json({ id: linkId });
}
