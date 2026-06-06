/* eslint-disable no-console */
/**
 * CAS NIBM CBSE sheet-driven fix (2026-06-06, fourth pass).
 *
 * Sheet had 924 rows, 922 already correct. Outstanding:
 *   - Tisya Maitriye (24CAG20337) sheet=Grade 3 vs DB=Grade 2 — user
 *     decided to LEAVE her (the earlier CAS NIBM CBSE roster said
 *     Grade 2 and we already converged on that). Not touched here.
 *   - Aarav Kumar (25CAG20431) — sheet has him as a Grade 12 boy at
 *     CASNIBMCBSE; not in DB. INSERT.
 *
 *   DATABASE_URL=… DATABASE_DIRECT_URL=… \
 *     npx tsx scripts/backfill-cas-nibm-cbse-from-sheet.ts [--apply]
 */

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.deploy") });
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import postgres from "postgres";

const APPLY = process.argv.includes("--apply");
const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_DIRECT_URL or DATABASE_URL is required");
const sql = postgres(url, { max: 1 });

function last10(p: string | null | undefined): string | null {
  if (!p) return null;
  const d = String(p).replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
}

async function main() {
  console.log(APPLY ? "▶ APPLY mode" : "▶ DRY-RUN mode");

  const sch = (await sql`SELECT id::text FROM schools WHERE school_code = 'CASNIBMCBSE'`) as unknown as { id: string }[];
  if (!sch.length) throw new Error("CASNIBMCBSE not found");
  const schoolId = sch[0].id;

  const enrol = "25CAG20431";
  const firstName = "Aarav Kumar";
  const grade = "Grade 12";
  const gender = "Male";
  const fatherName = "Vikas Kumar";
  const fatherPhone = "9891005455";
  const fatherEmail = "vikas101499@gmail.com";
  const motherPhone = "9540027789";

  const dup = (await sql`SELECT id FROM students WHERE school_code = 'CASNIBMCBSE' AND enrollment_number = ${enrol} LIMIT 1`) as unknown as { id: string }[];
  if (dup.length) {
    console.log(`  · ${enrol} already in DB — skipped`);
    await sql.end({ timeout: 5 });
    return;
  }

  const fp = last10(fatherPhone)!;
  const mp = last10(motherPhone);
  console.log(`  ${APPLY ? "✓" : "→"} INSERT ${enrol} ${firstName} · ${grade} · father ${fatherName} ${fp}${mp ? ` · mother phone ${mp}` : ""}`);

  if (APPLY) {
    await sql.begin(async (tx) => {
      const existing = (await tx`SELECT id::text FROM parents WHERE phone = ${fp}`) as unknown as { id: string }[];
      const parentId = existing.length
        ? existing[0].id
        : ((await tx`
            INSERT INTO parents (phone, name, email, status, first_time_login)
            VALUES (${fp}, ${fatherName}, ${fatherEmail}, 'active', true)
            RETURNING id::text
          `) as unknown as { id: string }[])[0].id;

      const erpName = `ADMIN-CASNIBMCBSE-${enrol}-${firstName.slice(0, 40)}`;
      const studentRows = (await tx`
        INSERT INTO students (
          erp_name, parent_id, school_id, school_code, enrollment_number,
          first_name, name, class, grade, gender,
          status, enabled, is_verified, verified_at, is_new_student
        ) VALUES (
          ${erpName}, ${parentId}::uuid, ${schoolId}::uuid, 'CASNIBMCBSE', ${enrol},
          ${firstName}, ${firstName}, ${grade}, ${grade}, ${gender},
          'active', true, true, now(), true
        )
        RETURNING id::text
      `) as unknown as { id: string }[];
      const studentId = studentRows[0].id;

      await tx`
        INSERT INTO student_guardian_links (student_id, row_idx, guardian_name, relation, phone_no, email, known_erp_names)
        VALUES (${studentId}::uuid, 0, ${fatherName}, 'Father', ${fp}, ${fatherEmail}, ARRAY[]::text[])
        ON CONFLICT DO NOTHING
      `;
      // Mother row: no name in the sheet, but phone is present — store as
      // unnamed Mother guardian so OTP login via that number also resolves.
      if (mp && mp !== fp) {
        await tx`
          INSERT INTO student_guardian_links (student_id, row_idx, guardian_name, relation, phone_no, email, known_erp_names)
          VALUES (${studentId}::uuid, 1, NULL, 'Mother', ${mp}, NULL, ARRAY[]::text[])
          ON CONFLICT DO NOTHING
        `;
      }
    });
    console.log("  inserted");
  }

  await sql.end({ timeout: 5 });
}
main().catch((e) => { console.error(e); process.exit(1); });
