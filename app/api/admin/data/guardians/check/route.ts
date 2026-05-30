/**
 * GET /api/admin/data/guardians/check?phone=<10-digit>
 *
 * Preflight check used by /admin/students/new — before creating the
 * student we want to know whether the supplied guardian mobile is
 * already linked to one or more existing students (the "this number is
 * already registered, link anyway?" confirm popup).
 *
 *   matched=true  → phone appears on at least one student_guardian_links
 *                   row. `students` lists who (name, enrollment, the
 *                   guardian-name on the matching link row).
 *   matched=false → the phone is fresh; no warning needed.
 *
 * Returns a small sample (up to 5 students) — enough for the dialog
 * copy without dragging a giant family through the wire.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { isResponse, requirePermission } from "@/lib/admin-guard";
import { last10Sql } from "@/lib/phone";

const Query = z.object({
  phone: z.string().regex(/^\d{10}$/, "10-digit mobile number required"),
  excludeStudentId: z.string().uuid().optional(),
});

export async function GET(req: Request) {
  const guard = await requirePermission("guardians.read");
  if (isResponse(guard)) return guard;

  const url = new URL(req.url);
  const parsed = Query.safeParse({
    phone: url.searchParams.get("phone") ?? "",
    excludeStudentId: url.searchParams.get("excludeStudentId") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "phone must be 10 digits" },
      { status: 400 }
    );
  }
  const phone = parsed.data.phone;
  const excludeStudentId = parsed.data.excludeStudentId ?? null;

  // Walk every student_guardian_links row whose phone matches (via the
  // last-10 normalisation), plus the guardians master record's mobile
  // and alternate numbers. This mirrors the resolver used by the login
  // flow so the popup never disagrees with what login will do.
  const rows = (await db.execute(sql`
    SELECT
      s.id              AS student_id,
      s.name            AS student_name,
      s.enrollment_number AS enrollment_number,
      gl.guardian_name  AS guardian_name,
      gl.relation       AS relation,
      gl.phone_no       AS phone_no
    FROM student_guardian_links gl
    JOIN students s ON s.id = gl.student_id
    LEFT JOIN guardians g ON g.erp_name = gl.guardian_erp_name
    WHERE
      (
        ${last10Sql(sql`gl.phone_no`)} = ${phone}
        OR ${last10Sql(sql`g.mobile_number`)} = ${phone}
        OR ${last10Sql(sql`g.alternate_number`)} = ${phone}
      )
      AND (${excludeStudentId}::uuid IS NULL OR s.id <> ${excludeStudentId}::uuid)
    ORDER BY s.created_at ASC
    LIMIT 5
  `)) as unknown as Array<{
    student_id: string;
    student_name: string;
    enrollment_number: string | null;
    guardian_name: string | null;
    relation: string | null;
    phone_no: string | null;
  }>;

  // Also surface the canonical guardians-master row (one per phone
  // post-dedup, migration 0021). The add-guardian form uses this to
  // prefill name/relation/email and to stamp the resolved erp_name on
  // the new link row so a typed phone never mints a duplicate master.
  const masterRows = (await db.execute(sql`
    SELECT erp_name, guardian_name, email_address, email, mobile_number
      FROM guardians
     WHERE ${last10Sql(sql`mobile_number`)} = ${phone}
        OR ${last10Sql(sql`alternate_number`)} = ${phone}
     ORDER BY (CASE WHEN erp_name LIKE 'LOCAL-%' THEN 1 ELSE 0 END), erp_name
     LIMIT 1
  `)) as unknown as Array<{
    erp_name: string | null;
    guardian_name: string | null;
    email_address: string | null;
    email: string | null;
    mobile_number: string | null;
  }>;
  const master = masterRows[0]
    ? {
        erpName: masterRows[0].erp_name,
        guardianName: masterRows[0].guardian_name,
        email: masterRows[0].email_address ?? masterRows[0].email,
      }
    : null;

  return NextResponse.json({
    matched: rows.length > 0,
    students: rows.map((r) => ({
      id: r.student_id,
      name: r.student_name,
      enrollmentNumber: r.enrollment_number,
      guardianName: r.guardian_name,
      relation: r.relation,
    })),
    master,
  });
}
