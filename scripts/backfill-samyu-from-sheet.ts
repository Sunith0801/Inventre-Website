/* eslint-disable no-console */
/**
 * SAMYU (Samyuktha International School) sheet-driven fixes (2026-06-06).
 *
 * Sheet: 915 rows. 903 already correct, 4 grade bumps + 8 inserts.
 *
 *   DATABASE_URL=… DATABASE_DIRECT_URL=… \
 *     npx tsx scripts/backfill-samyu-from-sheet.ts [--apply]
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

const UPDATES: Array<[enrol: string, target: string]> = [
  ["23SIS0339", "Grade 9"],   // UDITYA RAJENDAR (was Grade 8)
  ["23SIS0490", "Grade 5"],   // RANGANI THANVIJA GOUD (was Grade 4)
  ["23SIS0836", "Grade 8"],   // ABDUL RAHMAN BIN UMAR (was Grade 7)
  ["25SIS0221", "UKG"],       // MAMIDI AHANSHI (was LKG)
];

type InsertRow = {
  enrollment: string;
  firstName: string;
  grade: string;
  gender: "Male" | "Female";
  fatherName: string;
  fatherPhone: string;
  fatherEmail: string | null;
};
const INSERTS: InsertRow[] = [
  { enrollment: "23SIS0323", firstName: "RATHOD NAVANEETH",      grade: "Grade 7",  gender: "Male",   fatherName: "R SUBHASH",            fatherPhone: "9912770939", fatherEmail: null },
  { enrollment: "23SIS0325", firstName: "RATHOD THANVIKA",       grade: "Grade 9",  gender: "Female", fatherName: "RATHOD SUBHASH",       fatherPhone: "9963038544", fatherEmail: null },
  { enrollment: "23SIS0583", firstName: "ABDUL MUQSITH",         grade: "Grade 8",  gender: "Male",   fatherName: "ABDUL MAJEED",         fatherPhone: "7396533050", fatherEmail: null },
  { enrollment: "24SIS0183", firstName: "NUHA RAHEEM",           grade: "Grade 10", gender: "Male",   fatherName: "MOHAMMED NAHEEMUDDIN", fatherPhone: "9908743966", fatherEmail: "nayeemunison@gmail.com" },
  { enrollment: "25SIS0257", firstName: "KASHYAP MANVIK",        grade: "UKG",      gender: "Male",   fatherName: "PRACHURJYA BORAH",     fatherPhone: "9717260060", fatherEmail: "PRACHURJYA@ME.COM" },
  { enrollment: "25SIS0258", firstName: "KASHYAP MEDAMSH",       grade: "UKG",      gender: "Male",   fatherName: "PRACHUJYA BORAH",      fatherPhone: "9717260050", fatherEmail: "prachujya@me.com" },
  { enrollment: "25SIS0260", firstName: "ISHITHA TEKALE",        grade: "Grade 7",  gender: "Female", fatherName: "VIJAY KUMAR TEKALA",   fatherPhone: "9901558916", fatherEmail: "vijay.tekala@gmail.com" },
  { enrollment: "25SIS0261", firstName: "LINGALLA RIYAANSH",     grade: "UKG",      gender: "Male",   fatherName: "LINGALLA SUNIL KUMAR", fatherPhone: "9160918901", fatherEmail: "linus.bhavan470@gmail.com" },
];

function last10(p: string | null | undefined): string | null {
  if (!p) return null;
  const d = String(p).replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
}

async function main() {
  console.log(APPLY ? "▶ APPLY mode" : "▶ DRY-RUN mode");

  const sch = (await sql`SELECT id::text FROM schools WHERE school_code = 'SAMYU'`) as unknown as { id: string }[];
  if (!sch.length) throw new Error("SAMYU not found");
  const schoolId = sch[0].id;

  // Updates
  console.log("\n=== 4 grade updates ===");
  let bumps = 0, already = 0;
  for (const [enrol, target] of UPDATES) {
    const cur = (await sql`SELECT grade, class FROM students WHERE enrollment_number = ${enrol} AND school_code = 'SAMYU'`) as unknown as { grade: string | null; class: string | null }[];
    if (!cur.length) { console.log(`  ✗ ${enrol} not in DB`); continue; }
    const c = cur[0];
    if (c.grade === target && c.class === target) { console.log(`  · ${enrol} already ${target}`); already++; continue; }
    console.log(`  ${APPLY ? "✓" : "→"} ${enrol} grade ${JSON.stringify(c.grade)}→${JSON.stringify(target)}, class ${JSON.stringify(c.class)}→${JSON.stringify(target)}`);
    if (APPLY) {
      await sql`UPDATE students SET grade = ${target}, class = ${target} WHERE enrollment_number = ${enrol} AND school_code = 'SAMYU'`;
    }
    bumps++;
  }

  // Inserts (use the same alphanumeric-normalised dedup the import route now uses)
  console.log("\n=== 8 inserts ===");
  let inserted = 0, dup = 0, errs = 0;
  for (const row of INSERTS) {
    const dupe = (await sql`
      SELECT id::text, enrollment_number FROM students
       WHERE school_code = 'SAMYU'
         AND regexp_replace(enrollment_number, '[^A-Za-z0-9]', '', 'g') = ${row.enrollment.replace(/[^A-Za-z0-9]/g, "")}
       LIMIT 1
    `) as unknown as { id: string; enrollment_number: string | null }[];
    if (dupe.length) { console.log(`  · ${row.enrollment} already in DB as ${JSON.stringify(dupe[0].enrollment_number)}`); dup++; continue; }

    const fp = last10(row.fatherPhone);
    if (!fp) { console.error(`  ✗ ${row.enrollment} bad father phone`); errs++; continue; }

    console.log(`  ${APPLY ? "✓" : "→"} ${row.enrollment} ${row.firstName} · ${row.grade} · father ${row.fatherName} ${fp}`);
    if (!APPLY) { inserted++; continue; }

    try {
      await sql.begin(async (tx) => {
        const existing = (await tx`SELECT id::text FROM parents WHERE phone = ${fp}`) as unknown as { id: string }[];
        const parentId = existing.length
          ? existing[0].id
          : ((await tx`
              INSERT INTO parents (phone, name, email, status, first_time_login)
              VALUES (${fp}, ${row.fatherName}, ${row.fatherEmail}, 'active', true)
              RETURNING id::text
            `) as unknown as { id: string }[])[0].id;

        const erpName = `ADMIN-SAMYU-${row.enrollment}-${row.firstName.slice(0, 40)}`;
        const studentRows = (await tx`
          INSERT INTO students (
            erp_name, parent_id, school_id, school_code, enrollment_number,
            first_name, name, class, grade, gender,
            status, enabled, is_verified, verified_at, is_new_student
          ) VALUES (
            ${erpName}, ${parentId}::uuid, ${schoolId}::uuid, 'SAMYU', ${row.enrollment},
            ${row.firstName}, ${row.firstName}, ${row.grade}, ${row.grade}, ${row.gender},
            'active', true, true, now(), true
          )
          RETURNING id::text
        `) as unknown as { id: string }[];
        const studentId = studentRows[0].id;

        await tx`
          INSERT INTO student_guardian_links (student_id, row_idx, guardian_name, relation, phone_no, email, known_erp_names)
          VALUES (${studentId}::uuid, 0, ${row.fatherName}, 'Father', ${fp}, ${row.fatherEmail}, ARRAY[]::text[])
          ON CONFLICT DO NOTHING
        `;
      });
      inserted++;
    } catch (e) {
      console.error(`  ✗ ${row.enrollment} FAILED:`, e instanceof Error ? e.message : e);
      errs++;
    }
  }

  console.log("\n─── Summary ───");
  console.log(`grade bumps ${APPLY ? "applied" : "planned"}: ${bumps}  already-correct: ${already}`);
  console.log(`inserts ${APPLY ? "applied" : "planned"}:     ${inserted}  duplicate-skipped: ${dup}  errors: ${errs}`);
  if (!APPLY) console.log("\n(dry-run — re-run with --apply to commit)");

  await sql.end({ timeout: 5 });
}
main().catch((e) => { console.error(e); process.exit(1); });
