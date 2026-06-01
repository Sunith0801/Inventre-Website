/* eslint-disable no-console */
/**
 * One-shot backfill: rewrite students.grade / students.class and
 * orders.grade_snapshot for CAS-* / TTT-* / TSU-* schools to the
 * "school-given" grade name listed in school_grade_mappings.
 *
 * Why: parents at these schools see the wrong grade on the storefront
 * because upsertStudentsMirror (lib/erp-poll.ts:712) writes ERP's raw
 * value directly. The school-given label is what the family expects
 * and what their product catalog is tagged with. (CASLRCBSE
 * 26CAG10682 — grade today = "Grade 8" because that's the ERP value;
 * after this script: "Grade 5" because the school maps real Grade 5 →
 * school-given "Grade 5", and Grade 8 ERP +3-offset = real Grade 5.)
 *
 * Resolution per student:
 *   1. real_grade = +3 offset of erp_raw->>'grade' (fallback:
 *      students.grade) — same CASE as lib/repos/grades.ts
 *      studentDisplayGradeSql.
 *   2. school_given = school_grade_mappings.school_given_grade_name
 *      WHERE lower(grade) = lower(real_grade).
 *   3. If school_given differs from current students.grade → UPDATE.
 *      Also UPDATE students.class so admin tooling and storefront
 *      filter both see the same value (mirrors the dual-write done by
 *      app/api/admin/data/students/[id]/route.ts).
 *
 * Also touches orders.grade_snapshot for past orders belonging to
 * those students, using the same per-student resolution.
 *
 * Modes:
 *   default        — dry-run, prints per-school counts + 20 samples
 *   --apply        — perform the writes
 *
 *   DATABASE_URL="postgres://inventre:inventre_prod@localhost:6433/inventre" \
 *   DATABASE_DIRECT_URL="postgres://inventre:inventre_prod@localhost:55433/inventre" \
 *     npx tsx scripts/remap-students-school-given-grade.ts [--apply]
 */

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.deploy") });
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";

const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_DIRECT_URL or DATABASE_URL is required");
const client = postgres(url, { max: 1 });
const db = drizzle(client);

const APPLY = process.argv.includes("--apply");
const SCHOOL_PATTERN = "^(CAS|TTT|TSU)";

// Mirror of lib/grade-translate.ts ERP_TO_REAL (also used inline in
// lib/repos/grades.ts studentDisplayGradeSql). Kept inline so this
// script doesn't drag the server-only db client import chain.
const ERP_TO_REAL: Record<string, string> = {
  "Grade 1": "Nursery",
  "Grade 2": "LKG",
  "Grade 3": "UKG",
  "Grade 4": "Grade 1",
  "Grade 5": "Grade 2",
  "Grade 6": "Grade 3",
  "Grade 7": "Grade 4",
  "Grade 8": "Grade 5",
  "Grade 9": "Grade 6",
  "Grade 10": "Grade 7",
  "Grade 11": "Grade 8",
  "Grade 12": "Grade 9",
  "Grade 13": "Grade 10",
  "Grade 14": "Grade 11",
  "Grade 15": "Grade 12",
  Nursery: "Nursery",
  LKG: "LKG",
  UKG: "UKG",
};

function realFor(erpRaw: string | null | undefined): string | null {
  if (!erpRaw) return null;
  const v = erpRaw.trim();
  return ERP_TO_REAL[v] ?? null;
}

type StudentRow = {
  id: string;
  name: string;
  enrollment_number: string | null;
  grade: string | null;
  class: string | null;
  erp_grade: string | null;
};

async function main() {
  const schools = (await db.execute(sql`
    SELECT id, school_code, name
      FROM schools
     WHERE school_code ~ ${SCHOOL_PATTERN}
       AND status = 'active'
     ORDER BY school_code
  `)) as unknown as { id: string; school_code: string; name: string | null }[];

  console.log(
    `\nMode: ${APPLY ? "APPLY (writing)" : "DRY-RUN (no writes)"}`
  );
  console.log(`Schools in scope: ${schools.length}\n`);

  const overall = {
    studentsChecked: 0,
    studentsUpdated: 0,
    studentsAlready: 0,
    studentsUnresolved: 0,
    ordersChecked: 0,
    ordersUpdated: 0,
    ordersAlready: 0,
    ordersUnresolved: 0,
  };
  const sampleDiffs: string[] = [];

  for (const s of schools) {
    const mapRows = (await db.execute(sql`
      SELECT grade, school_given_grade_name
        FROM school_grade_mappings
       WHERE school_id = ${s.id}
    `)) as unknown as {
      grade: string | null;
      school_given_grade_name: string | null;
    }[];
    const realToGiven = new Map<string, string>();
    for (const m of mapRows) {
      if (!m.grade || !m.school_given_grade_name) continue;
      realToGiven.set(m.grade.trim().toLowerCase(), m.school_given_grade_name);
    }

    const studentRows = (await db.execute(sql`
      SELECT id::text AS id, name, enrollment_number,
             grade, class,
             erp_raw->>'grade' AS erp_grade
        FROM students
       WHERE school_id = ${s.id}
    `)) as unknown as StudentRow[];

    let touched = 0;
    let already = 0;
    let unresolved = 0;
    const perSchoolSamples: string[] = [];

    for (const st of studentRows) {
      overall.studentsChecked++;
      // Prefer the ERP raw value because students.grade may have been
      // (incorrectly) overwritten by past polls; the raw is the source.
      const real =
        realFor(st.erp_grade) ?? realFor(st.grade) ?? realFor(st.class);
      if (!real) {
        unresolved++;
        overall.studentsUnresolved++;
        continue;
      }
      const given = realToGiven.get(real.toLowerCase());
      if (!given) {
        unresolved++;
        overall.studentsUnresolved++;
        continue;
      }
      if (st.grade === given && st.class === given) {
        already++;
        overall.studentsAlready++;
        continue;
      }
      if (perSchoolSamples.length < 4) {
        perSchoolSamples.push(
          `    ${st.enrollment_number ?? "?"} ${st.name}: ` +
            `erp=${st.erp_grade ?? "?"} grade=${st.grade ?? "?"} ` +
            `class=${st.class ?? "?"} → ${given}`
        );
      }
      touched++;
      overall.studentsUpdated++;
      if (APPLY) {
        await db.execute(sql`
          UPDATE students
             SET grade = ${given}, class = ${given}
           WHERE id = ${st.id}::uuid
        `);
      }
    }

    // ── orders.grade_snapshot for past orders ─────────────────────
    const orderRows = (await db.execute(sql`
      SELECT o.id::text AS id, o.order_number, o.grade_snapshot,
             stu.erp_raw->>'grade' AS erp_grade,
             stu.grade AS stu_grade, stu.class AS stu_class
        FROM orders o
        JOIN students stu ON stu.id = o.student_id
       WHERE stu.school_id = ${s.id}
         AND o.grade_snapshot IS NOT NULL
    `)) as unknown as {
      id: string;
      order_number: string;
      grade_snapshot: string;
      erp_grade: string | null;
      stu_grade: string | null;
      stu_class: string | null;
    }[];

    let oTouched = 0;
    let oAlready = 0;
    let oUnresolved = 0;
    for (const o of orderRows) {
      overall.ordersChecked++;
      const real =
        realFor(o.erp_grade) ??
        realFor(o.stu_grade) ??
        realFor(o.stu_class) ??
        realFor(o.grade_snapshot);
      if (!real) {
        oUnresolved++;
        overall.ordersUnresolved++;
        continue;
      }
      const given = realToGiven.get(real.toLowerCase());
      if (!given) {
        oUnresolved++;
        overall.ordersUnresolved++;
        continue;
      }
      if (o.grade_snapshot === given) {
        oAlready++;
        overall.ordersAlready++;
        continue;
      }
      oTouched++;
      overall.ordersUpdated++;
      if (APPLY) {
        await db.execute(sql`
          UPDATE orders
             SET grade_snapshot = ${given}
           WHERE id = ${o.id}::uuid
        `);
      }
    }

    console.log(
      `${s.school_code} · ${s.name ?? "?"}\n` +
        `  students: total=${studentRows.length} update=${touched} already=${already} unresolved=${unresolved}\n` +
        `  orders:   total=${orderRows.length} update=${oTouched} already=${oAlready} unresolved=${oUnresolved}`
    );
    for (const line of perSchoolSamples) console.log(line);
    sampleDiffs.push(...perSchoolSamples);
    console.log();
  }

  console.log("=== SUMMARY ===");
  console.log(
    `students checked=${overall.studentsChecked} ` +
      `updated=${overall.studentsUpdated} already=${overall.studentsAlready} ` +
      `unresolved=${overall.studentsUnresolved}`
  );
  console.log(
    `orders   checked=${overall.ordersChecked} ` +
      `updated=${overall.ordersUpdated} already=${overall.ordersAlready} ` +
      `unresolved=${overall.ordersUnresolved}`
  );
  if (!APPLY) {
    console.log("\nDry-run — re-run with --apply to commit.");
  } else {
    console.log("\nApplied.");
  }
}

main()
  .then(() => client.end())
  .catch((e) => {
    console.error(e);
    return client.end().then(() => process.exit(1));
  });
