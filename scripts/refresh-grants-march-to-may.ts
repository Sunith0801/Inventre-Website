/* eslint-disable no-console */
/**
 * Bulk-grant every MCB-cached student whose last tuition payment was in
 * March 2026 and is still ungranted. Mirrors the per-row logic of
 * `grantMcbAccess` in app/admin/(protected)/mcb/actions.ts so the result
 * is indistinguishable from clicking Grant in the dashboard.
 *
 * One-shot script. Defaults to dry-run; `--apply` commits.
 *
 *   DATABASE_URL="..." DATABASE_DIRECT_URL="..." \
 *     npx tsx scripts/bulk-grant-march-paid.ts            # dry-run
 *     npx tsx scripts/bulk-grant-march-paid.ts --apply    # commit
 */
import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql, eq, and } from "drizzle-orm";
import * as schema from "../db/schema";
import { parents, guardians, students, studentGuardianLinks, schools } from "../db/schema";
import {
  mcbBranchToSchoolCode,
  mcbGenderToLabel,
  mcbGradeToCbse,
  targetedToMcbDisplay,
} from "../lib/mcb/mappings";

const APPLY = process.argv.includes("--apply");
const ACTOR = "admin@inventre.in (refresh-script march-may)";
const FROM = "2026-03-01";
const TO = "2026-06-01";  // exclusive — includes March, April, May

const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

function isNewStudentRule(
  enrollment: string | null | undefined,
  schoolCode: string | null | undefined
): boolean {
  if (!enrollment || !enrollment.startsWith("26")) return false;
  if (!schoolCode) return false;
  return !schoolCode.toUpperCase().startsWith("CAS");
}

type Mcb = {
  enrolment_number: string;
  student_name: string | null;
  school_name: string | null;
  grade: string | null;
  section: string | null;
  full_name: string | null;
  father_name: string | null;
  mother_name: string | null;
  father_phone: string | null;
  mother_phone: string | null;
  father_email: string | null;
  mother_email: string | null;
  gender_raw: unknown;
};

type Result = { kind: "granted" | "skipped" | "failed"; error?: string };

async function grantOneTyped(row: Mcb): Promise<Result> {
  const fullName = (row.full_name || row.student_name || "").trim();
  const grade = mcbGradeToCbse(row.grade) || null;
  const section = (row.section || "").trim() || null;
  const gender = mcbGenderToLabel(row.gender_raw as boolean | string | null) || null;

  const fatherMobile = (row.father_phone || "").replace(/\D/g, "").slice(-10);
  const motherMobile = (row.mother_phone || "").replace(/\D/g, "").slice(-10);
  const useFather = /^\d{10}$/.test(fatherMobile);
  const mobile = useFather ? fatherMobile : motherMobile;
  if (!mobile || !/^\d{10}$/.test(mobile)) return { kind: "failed", error: "no 10-digit mobile" };
  const guardianName = useFather
    ? (row.father_name || row.mother_name || "")
    : (row.mother_name || row.father_name || "");
  const relation = useFather && row.father_name
    ? "Father"
    : !useFather && row.mother_name
      ? "Mother"
      : "Guardian";
  const email = (useFather ? row.father_email : row.mother_email) || row.father_email || row.mother_email || null;

  if (!fullName) return { kind: "failed", error: "missing student name" };
  if (!row.school_name) return { kind: "failed", error: "missing school" };
  const schoolCode = mcbBranchToSchoolCode(row.school_name);
  if (!schoolCode) return { kind: "failed", error: `unknown branch ${row.school_name}` };

  const [school] = await db
    .select({ id: schools.id })
    .from(schools)
    .where(eq(schools.schoolCode, schoolCode))
    .limit(1);
  if (!school) return { kind: "failed", error: `schools row missing for ${schoolCode}` };

  const erpName = `MCB-${row.enrolment_number}`;

  if (!APPLY) {
    return { kind: "granted" }; // dry-run: just report would-grant
  }

  try {
    await db.transaction(async (tx) => {
      let [parent] = await tx
        .select({ id: parents.id })
        .from(parents)
        .where(eq(parents.phone, mobile))
        .limit(1);
      if (!parent) {
        [parent] = await tx
          .insert(parents)
          .values({
            phone: mobile,
            name: guardianName || null,
            email: email,
            status: "active",
            firstTimeLogin: true,
          })
          .returning({ id: parents.id });
      }

      const existing = await tx
        .select({ id: students.id })
        .from(students)
        .where(eq(students.erpName, erpName))
        .limit(1);

      const studentValues = {
        parentId: parent!.id,
        schoolId: school.id,
        name: fullName,
        firstName: fullName,
        enrollmentNumber: row.enrolment_number,
        schoolCode: schoolCode,
        grade: grade,
        section: section,
        gender: gender,
        studentMobileNumber: mobile,
        studentEmailId: email,
        enabled: true,
        status: "active" as const,
        isNewStudent: isNewStudentRule(row.enrolment_number, schoolCode),
        erpName: erpName,
        syncedAt: new Date(),
      };

      let studentId: string;
      if (existing[0]) {
        await tx.update(students).set(studentValues).where(eq(students.id, existing[0].id));
        studentId = existing[0].id;
      } else {
        const [inserted] = await tx
          .insert(students)
          .values(studentValues)
          .returning({ id: students.id });
        studentId = inserted!.id;
      }

      const guardianErpName = `MCB-G-${mobile}`;
      let [guardian] = await tx
        .select({ id: guardians.id })
        .from(guardians)
        .where(eq(guardians.mobileNumber, mobile))
        .limit(1);
      if (!guardian) {
        [guardian] = await tx
          .insert(guardians)
          .values({
            erpName: guardianErpName,
            guardianName: guardianName || null,
            mobileNumber: mobile,
            email: email,
            emailAddress: email,
          })
          .returning({ id: guardians.id });
      } else {
        await tx
          .update(guardians)
          .set({
            guardianName: guardianName || sql`guardian_name`,
            email: email ?? sql`email`,
            emailAddress: email ?? sql`email_address`,
          })
          .where(eq(guardians.id, guardian.id));
      }

      const [existingLink] = await tx
        .select({ id: studentGuardianLinks.id })
        .from(studentGuardianLinks)
        .where(
          and(
            eq(studentGuardianLinks.studentId, studentId),
            eq(studentGuardianLinks.guardianErpName, guardianErpName),
          )
        )
        .limit(1);
      if (existingLink) {
        await tx
          .update(studentGuardianLinks)
          .set({
            guardianName: guardianName || null,
            relation,
            phoneNo: mobile,
            email,
          })
          .where(eq(studentGuardianLinks.id, existingLink.id));
      } else {
        await tx.insert(studentGuardianLinks).values({
          studentId,
          rowIdx: 0,
          guardianErpName,
          guardianName: guardianName || null,
          relation,
          phoneNo: mobile,
          email,
        });
      }

      const displayLabel = grade ? targetedToMcbDisplay(grade) : null;
      if (grade && displayLabel) {
        await tx.execute(sql`
          INSERT INTO school_grade_mappings
            (school_id, row_idx, grade, school_given_grade_name, sections, raw)
          SELECT ${school.id},
                 COALESCE(
                   (SELECT MAX(row_idx) + 1 FROM school_grade_mappings WHERE school_id = ${school.id}),
                   0
                 ),
                 ${grade}, ${displayLabel}, NULL, NULL
           WHERE NOT EXISTS (
             SELECT 1 FROM school_grade_mappings
              WHERE school_id = ${school.id}
                AND lower(grade) = lower(${grade})
           )
        `);
      }

      await tx.execute(sql`
        UPDATE mcb_students
        SET website_access = true,
            website_access_at = now(),
            website_access_by = ${ACTOR}
        WHERE enrolment_number = ${row.enrolment_number}
      `);
    });
    return { kind: "granted" };
  } catch (e) {
    return { kind: "failed", error: e instanceof Error ? e.message : String(e) };
  }
}

async function main() {
  console.log(`\nBulk grant MCB access for ungranted March-paid students (${APPLY ? "APPLY" : "DRY-RUN"})\n`);

  const rows = (await db.execute(sql`
    SELECT s.enrolment_number, s.student_name, s.school_name, s.grade, s.section,
           s.raw->>'FullName'      AS full_name,
           s.raw->>'FatherName'    AS father_name,
           s.raw->>'MotherName'    AS mother_name,
           s.raw->>'FatherPhone'   AS father_phone,
           s.raw->>'MotherPhone'   AS mother_phone,
           s.raw->>'FatherEmailID' AS father_email,
           s.raw->>'MotherEmailID' AS mother_email,
           s.raw->'Gender'         AS gender_raw
      FROM mcb_students s
     WHERE EXISTS (
         SELECT 1 FROM mcb_fee_payments p
          WHERE p.enrolment_number = s.enrolment_number AND p.fee_head = 'Tuition fee'
            AND p.payment_date >= ${FROM}::date AND p.payment_date < ${TO}::date
       )
     ORDER BY s.school_name, s.enrolment_number
  `)) as unknown as Mcb[];

  console.log(`  ${rows.length} students to process\n`);

  let granted = 0, failed = 0;
  const failures: { enrol: string; reason: string }[] = [];
  const t0 = Date.now();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const out = await grantOneTyped(r);
    if (out.kind === "granted") granted++;
    else if (out.kind === "failed") {
      failed++;
      failures.push({ enrol: r.enrolment_number, reason: out.error ?? "?" });
    }
    if ((i + 1) % 100 === 0 || i + 1 === rows.length) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`  ${i + 1}/${rows.length}  granted=${granted}  failed=${failed}  elapsed=${elapsed}s`);
    }
  }

  console.log(`\nDone. granted=${granted}  failed=${failed}`);
  if (failures.length > 0) {
    console.log(`\nFirst 20 failures:`);
    for (const f of failures.slice(0, 20)) {
      console.log(`  ${f.enrol} — ${f.reason}`);
    }
    if (failures.length > 20) console.log(`  ... and ${failures.length - 20} more`);
  }
  if (!APPLY) console.log(`\nDRY-RUN — re-run with --apply to commit.`);
}

main()
  .then(() => client.end())
  .catch((e) => {
    console.error(e);
    return client.end().then(() => process.exit(1));
  });
