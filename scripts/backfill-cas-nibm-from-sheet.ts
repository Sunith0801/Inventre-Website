/* eslint-disable no-console */
/**
 * Sheet-driven backfill for CAS NIBM (2026-06-06).
 *
 * Source of truth: the school's authoritative roster sheet you pasted on
 * 2026-06-06. Comparing 473 sheet rows against our DB found:
 *   - 413 already match (no work)
 *   - 38 grade mismatches that look like real promotions / corrections
 *     → UPDATE students.grade + students.class
 *   - 12 students in the sheet but missing from our DB
 *     → INSERT student + parent + guardian links
 *   - 7 "AS LEVEL" mismatches — skipped (cosmetic, "Grade 11" is canonical)
 *   - 3 blank-enrollment rows in the sheet — skipped
 *
 * The 50 actionable rows are HARDCODED below; no broad scan. Other CAS NIBM
 * students (and every other school) are not touched.
 *
 * Mode:
 *   default        — dry-run (no writes)
 *   --apply        — commit each row in its own transaction
 *
 * Idempotent:
 *   - UPDATEs converge.
 *   - INSERTs skip when (school_code, enrollment_number) already exists.
 *
 *   DATABASE_URL="postgres://inventre:inventre_prod@localhost:6433/inventre" \
 *   DATABASE_DIRECT_URL="postgres://inventre:inventre_prod@localhost:55433/inventre" \
 *     npx tsx scripts/backfill-cas-nibm-from-sheet.ts [--apply]
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

// ── 38 grade updates ────────────────────────────────────────────────────
const UPDATES: Array<[enrol: string, grade: string]> = [
  ["24CAG20016", "Grade 8"],
  ["23CAG20638", "Grade 1"],
  ["24CAG20156", "Grade 1"],
  ["26CAG20260", "Grade 1"],
  ["25CAG20605", "Nursery"],
  ["25CAG20604", "Nursery"],
  ["24CAG20337", "Grade 2"],
  ["23CAG20007", "Grade 11"],
  ["26CAG20179", "Grade 1"],
  ["26CAG20345", "Nursery"],
  ["26CAG20337", "Grade 1"],
  ["26CAG20356", "Grade 11"],
  ["26CAG20357", "Grade 11"],
  ["22CAG20258", "Grade 11"],
  ["24CAG20142", "Grade 11"],
  ["23CAG20179", "Grade 11"],
  ["26CAG20358", "Grade 7"],
  ["26CAG20359", "Grade 5"],
  ["26CAG20361", "Grade 1"],
  ["26CAG20364", "Grade 5"],
  ["26CAG20366", "Grade 11"],
  ["24CAG20621", "Grade 11"],
  ["26CAG20369", "Grade 11"],
  ["26CAG20368", "Grade 1"],
  ["26CAG20372", "Grade 6"],
  ["26CAG20370", "Grade 5"],
  ["26CAG20371", "Grade 4"],
  ["26CAG20373", "Grade 9"],
  ["26CAG20374", "Grade 4"],
  ["26CAG20375", "Grade 8"],
  ["26CAG20376", "Grade 3"],
  ["26CAG20377", "Grade 1"],
  ["23CAG20279", "Grade 11"],
  ["26CAG20378", "Grade 11"],
  ["26CAG20379", "Grade 9"],
  ["26CAG20381", "Grade 1"],
  ["23CAG20628", "Grade 11"],
  ["26CAG20380", "Grade 1"],
];

// ── 12 inserts ──────────────────────────────────────────────────────────
// Sheet "Board" column → school_code:
//   CBSE → CASNIBMCBSE   CIE → CASNIBMCIE   LKG/TTT → TTTNIBM
type InsertRow = {
  enrollment: string;
  schoolCode: "CASNIBMCBSE" | "CASNIBMCIE" | "TTTNIBM";
  firstName: string;
  grade: string;
  gender: string | null;
  fatherName: string;
  fatherPhone: string;
  motherName: string | null;
  motherPhone: string | null;
  email: string | null;
};
const INSERTS: InsertRow[] = [
  {
    enrollment: "26CAG20012",
    schoolCode: "CASNIBMCBSE",
    firstName: "Arham Azharuddin Yaligar",
    grade: "Grade 4",
    gender: "Male",
    fatherName: "Azharuddin Yaligar",
    fatherPhone: "9604303056",
    motherName: "Nahida A Yaligar",
    motherPhone: "9881833023",
    email: "azharuddin.y@gmail.com",
  },
  {
    enrollment: "26CAG20176",
    schoolCode: "TTTNIBM",
    firstName: "Indrajeet Ganesh Surve",
    grade: "Grade 4",
    gender: "Male",
    fatherName: "Ganesh",
    fatherPhone: "9834452350",
    motherName: "Megha",
    motherPhone: "9322252962",
    email: "ganeshsurve76@gmail.com",
  },
  {
    enrollment: "26CAG20298",
    schoolCode: "CASNIBMCBSE",
    firstName: "Vikrant Santosh Singh Ghusar",
    grade: "Grade 6",
    gender: "Male",
    fatherName: "Santosh",
    fatherPhone: "9833972748",
    motherName: "Purnima",
    motherPhone: "9167421132",
    email: "santosharsr32@gmail.com",
  },
  {
    enrollment: "26CAG20306",
    schoolCode: "CASNIBMCBSE",
    firstName: "Shriyan Sagar Kumavat",
    grade: "Grade 1",
    gender: "Male",
    fatherName: "Sagar",
    fatherPhone: "7798959326",
    motherName: "Priyanka",
    motherPhone: "8530898417",
    email: "sagarkumavat31@gmail.com",
  },
  {
    enrollment: "26CAG20334",
    schoolCode: "CASNIBMCBSE",
    firstName: "GATHA RUSHIKESH SHEWALE",
    grade: "Grade 1",
    gender: "Female",
    fatherName: "RUSHIKESH",
    fatherPhone: "9859299191",
    motherName: "AMRUTA",
    motherPhone: "9552999842",
    email: "rushikeshshewale6599@gmail.com",
  },
  {
    enrollment: "26CAG20335",
    schoolCode: "CASNIBMCBSE",
    firstName: "Athashree Chetan Ghule",
    grade: "Grade 1",
    gender: "Female",
    fatherName: "Chetan",
    fatherPhone: "9011080707",
    motherName: "Sapana",
    motherPhone: "7721080707",
    email: "chetanghule07@gmail.com",
  },
  {
    enrollment: "26CAG20336",
    schoolCode: "CASNIBMCBSE",
    firstName: "Rajlakshmi Rakesh Jadhav",
    grade: "Grade 1",
    gender: "Female",
    fatherName: "Rakesh",
    fatherPhone: "9130026057",
    motherName: "Akshata",
    motherPhone: "7276343327",
    email: "rakesh_jadhav17@yahoo.com",
  },
  {
    enrollment: "26CAG20338",
    schoolCode: "CASNIBMCBSE",
    firstName: "Viraj Nitin Khare",
    grade: "Grade 1",
    gender: "Male",
    fatherName: "Nitin",
    fatherPhone: "8308662428",
    motherName: "Savita",
    motherPhone: "8080678565",
    email: "nitinkhare908@gmail.com",
  },
  {
    enrollment: "26CAG20340",
    schoolCode: "CASNIBMCBSE",
    firstName: "Shivraj Ankush Patil",
    grade: "Grade 1",
    gender: "Male",
    fatherName: "Ankush",
    fatherPhone: "9850412003",
    motherName: "Vaishali",
    motherPhone: "8888745567",
    email: "patilankush5567@gmail.com",
  },
  {
    enrollment: "26CAG20344",
    schoolCode: "CASNIBMCBSE",
    firstName: "HAFSA ABDULAZIZ PANHALKAR",
    grade: "Grade 1",
    gender: "Female",
    fatherName: "AbdulAziz",
    fatherPhone: "8888776679",
    motherName: "Misba",
    motherPhone: "8010587552",
    email: "aziz2panhalkar@gmail.com",
  },
  {
    enrollment: "26CAG20346",
    schoolCode: "CASNIBMCBSE",
    firstName: "Dnyanvi Sagar Inamdar",
    grade: "Grade 1",
    gender: "Female",
    fatherName: "Sagar",
    fatherPhone: "7709026877",
    motherName: "Kirti",
    motherPhone: "7709026877",
    email: "Kirtiinamdar669@gmail.com",
  },
  {
    enrollment: "26CAG20332",
    schoolCode: "CASNIBMCIE",
    firstName: "Jia Sanjay Keswani",
    grade: "Grade 7",
    gender: "Female",
    fatherName: "Sanjay",
    fatherPhone: "9059772782",
    motherName: "aanchal",
    motherPhone: "9160917308",
    email: "jaysun.mlk@gmail.com",
  },
];

function last10(p: string | null | undefined): string | null {
  if (!p) return null;
  const digits = String(p).replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

type SchoolRow = { id: string; school_code: string };

async function main() {
  console.log(APPLY ? "▶ APPLY mode (writes will commit)" : "▶ DRY-RUN mode (no writes)");

  // Resolve school_ids once.
  const schools = (await sql`
    SELECT id::text, school_code FROM schools WHERE school_code IN ('CASNIBMCBSE','CASNIBMCIE','TTTNIBM')
  `) as unknown as SchoolRow[];
  const schoolIdByCode = new Map(schools.map((s) => [s.school_code, s.id]));

  // ── Updates pass ──────────────────────────────────────────────────────
  let updated = 0;
  let alreadyCorrect = 0;
  let missingForUpdate = 0;

  console.log("\n=== Updates (38 planned) ===");
  for (const [enrol, targetGrade] of UPDATES) {
    const cur = (await sql`
      SELECT grade, class, school_code FROM students WHERE enrollment_number = ${enrol}
    `) as unknown as { grade: string | null; class: string | null; school_code: string | null }[];
    if (cur.length === 0) {
      console.log(`  ✗ ${enrol} — not in DB (skipped)`);
      missingForUpdate++;
      continue;
    }
    const c = cur[0];
    if (c.grade === targetGrade && c.class === targetGrade) {
      alreadyCorrect++;
      continue;
    }
    console.log(
      `  ${APPLY ? "✓" : "→"} ${enrol} [${c.school_code}] grade: ${JSON.stringify(c.grade)} → ${JSON.stringify(targetGrade)}, class: ${JSON.stringify(c.class)} → ${JSON.stringify(targetGrade)}`,
    );
    if (APPLY) {
      await sql`
        UPDATE students
           SET grade = ${targetGrade},
               class = ${targetGrade}
         WHERE enrollment_number = ${enrol}
      `;
      updated++;
    } else {
      updated++; // counted as "planned"
    }
  }

  // ── Inserts pass ──────────────────────────────────────────────────────
  let inserted = 0;
  let dupSkipped = 0;
  let insertErrors = 0;

  console.log("\n=== Inserts (12 planned) ===");
  for (const row of INSERTS) {
    const schoolId = schoolIdByCode.get(row.schoolCode);
    if (!schoolId) {
      console.error(`  ✗ ${row.enrollment} — unknown school_code ${row.schoolCode}`);
      insertErrors++;
      continue;
    }
    const fatherPhone10 = last10(row.fatherPhone);
    if (!fatherPhone10) {
      console.error(`  ✗ ${row.enrollment} — father phone invalid: ${row.fatherPhone}`);
      insertErrors++;
      continue;
    }
    const motherPhone10 = last10(row.motherPhone);

    // Skip if duplicate (school_code, enrollment_number) already exists.
    const dupe = (await sql`
      SELECT id FROM students WHERE school_code = ${row.schoolCode} AND enrollment_number = ${row.enrollment} LIMIT 1
    `) as unknown as { id: string }[];
    if (dupe.length) {
      console.log(`  · ${row.enrollment} — already in DB (skipped)`);
      dupSkipped++;
      continue;
    }

    console.log(
      `  ${APPLY ? "✓" : "→"} ${row.enrollment} [${row.schoolCode}] ${row.firstName} · ${row.grade} · father ${row.fatherName} ${fatherPhone10}${motherPhone10 ? ` · mother ${row.motherName} ${motherPhone10}` : ""}`,
    );

    if (!APPLY) {
      inserted++;
      continue;
    }

    try {
      await sql.begin(async (tx) => {
        // Upsert parents row by phone.
        const existing = (await tx`SELECT id::text FROM parents WHERE phone = ${fatherPhone10}`) as unknown as { id: string }[];
        let parentId: string;
        if (existing.length) {
          parentId = existing[0].id;
        } else {
          const ins = (await tx`
            INSERT INTO parents (phone, name, email, status, first_time_login)
            VALUES (${fatherPhone10}, ${row.fatherName}, ${row.email}, 'active', true)
            RETURNING id::text
          `) as unknown as { id: string }[];
          parentId = ins[0].id;
        }

        // Insert student.
        const erpName = `ADMIN-${row.schoolCode}-${row.enrollment}-${row.firstName.slice(0, 40)}`;
        const studentRows = (await tx`
          INSERT INTO students (
            erp_name, parent_id, school_id, school_code, enrollment_number,
            first_name, name, class, grade, gender,
            status, enabled, is_verified, verified_at, is_new_student
          ) VALUES (
            ${erpName}, ${parentId}::uuid, ${schoolId}::uuid, ${row.schoolCode}, ${row.enrollment},
            ${row.firstName}, ${row.firstName}, ${row.grade}, ${row.grade}, ${row.gender},
            'active', true, true, now(), true
          )
          RETURNING id::text
        `) as unknown as { id: string }[];
        const studentId = studentRows[0].id;

        // Guardian links (father at row_idx 0, mother at row_idx 1 if present).
        // The migration-0023 trigger keeps students.parent_id in sync; we
        // also set it explicitly above.
        await tx`
          INSERT INTO student_guardian_links (student_id, row_idx, guardian_name, relation, phone_no, email, known_erp_names)
          VALUES (${studentId}::uuid, 0, ${row.fatherName}, 'Father', ${fatherPhone10}, ${row.email}, ARRAY[]::text[])
          ON CONFLICT DO NOTHING
        `;
        if (motherPhone10 && row.motherName) {
          await tx`
            INSERT INTO student_guardian_links (student_id, row_idx, guardian_name, relation, phone_no, email, known_erp_names)
            VALUES (${studentId}::uuid, 1, ${row.motherName}, 'Mother', ${motherPhone10}, ${row.email}, ARRAY[]::text[])
            ON CONFLICT DO NOTHING
          `;
        }
      });
      inserted++;
    } catch (e) {
      console.error(`  ✗ ${row.enrollment} — FAILED:`, e instanceof Error ? e.message : e);
      insertErrors++;
    }
  }

  console.log("\n─── Summary ───");
  console.log(`updates ${APPLY ? "applied" : "planned"}:  ${updated}`);
  console.log(`updates already correct:  ${alreadyCorrect}`);
  console.log(`updates missing from DB:  ${missingForUpdate}`);
  console.log(`inserts ${APPLY ? "applied" : "planned"}:  ${inserted}`);
  console.log(`inserts duplicate-skipped: ${dupSkipped}`);
  console.log(`insert errors:            ${insertErrors}`);
  if (!APPLY) console.log("\n(dry-run — no writes. Re-run with --apply to commit.)");

  await sql.end({ timeout: 5 });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
