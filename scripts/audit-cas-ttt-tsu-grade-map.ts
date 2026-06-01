/* eslint-disable no-console */
/**
 * Read-only audit for CAS-* / TTT-* / TSU-* schools.
 *
 * Parents at these schools complained (2026-06-01) that the grade
 * shown on the storefront is wrong — students are tagged with the
 * ERP-given grade, not the school-given grade. Before we backfill,
 * we need to confirm the local school_grade_mappings table actually
 * has the rows we need (the legacy ERPNext puller that populated
 * this table is retired upstream).
 *
 * For every school whose school_code matches ^(CAS|TTT|TSU) and is
 * active, this prints:
 *   - # students, # mapping rows
 *   - the distinct (ERP grade) values found on students that have
 *     NO row in school_grade_mappings — those are the gaps ops needs
 *     to fill in via the admin /admin/schools/[id] → Grades tab
 *     before we run the remap script.
 *
 * Also runs a catalog cross-check: any product targeted to one of
 * these schools whose product_grades.grade isn't in the school's
 * school_given_grade_name set (the storefront does exact-string
 * filter, so a mismatch hides products).
 *
 * READ-ONLY: no writes. Safe to run anytime.
 *
 *   DATABASE_URL="postgres://inventre:inventre_prod@localhost:6433/inventre" \
 *   DATABASE_DIRECT_URL="postgres://inventre:inventre_prod@localhost:55433/inventre" \
 *     npx tsx scripts/audit-cas-ttt-tsu-grade-map.ts
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

const PATTERN = "^(CAS|TTT|TSU)";

async function main() {
  const schools = (await db.execute(sql`
    SELECT id, school_code, name, status
      FROM schools
     WHERE school_code ~ ${PATTERN}
     ORDER BY school_code
  `)) as unknown as {
    id: string;
    school_code: string;
    name: string | null;
    status: string | null;
  }[];

  console.log(
    `\nIn-scope schools (school_code ~ ${PATTERN}): ${schools.length}\n`
  );

  let totalGaps = 0;
  let totalProductGaps = 0;
  for (const s of schools) {
    const [studentCount] = (await db.execute(sql`
      SELECT count(*)::int AS n FROM students WHERE school_id = ${s.id}
    `)) as unknown as { n: number }[];

    const mappingRows = (await db.execute(sql`
      SELECT grade, school_given_grade_name, sections
        FROM school_grade_mappings
       WHERE school_id = ${s.id}
       ORDER BY grade
    `)) as unknown as {
      grade: string | null;
      school_given_grade_name: string | null;
      sections: string | null;
    }[];

    // ERP grades present on students for this school. We use erp_raw
    // because students.grade itself may already have been (incorrectly)
    // overwritten in past sync rounds — erp_raw is the unmodified source.
    const distinctErpGrades = (await db.execute(sql`
      SELECT DISTINCT erp_raw->>'grade' AS erp_grade
        FROM students
       WHERE school_id = ${s.id}
         AND erp_raw IS NOT NULL
         AND erp_raw->>'grade' IS NOT NULL
       ORDER BY erp_raw->>'grade'
    `)) as unknown as { erp_grade: string }[];

    const erpGradesOnStudents = distinctErpGrades.map((r) => r.erp_grade);
    const mappingRealGrades = new Set(
      mappingRows
        .map((m) => (m.grade ?? "").trim().toLowerCase())
        .filter(Boolean)
    );

    // school_grade_mappings.grade holds the +3-offset "real" grade
    // (see lib/repos/grades.ts:studentDisplayGradeSql for the mapping
    // table). Translate each ERP grade through the +3 offset before
    // checking presence.
    const erpToReal: Record<string, string> = {
      "grade 1": "nursery",
      "grade 2": "lkg",
      "grade 3": "ukg",
      "grade 4": "grade 1",
      "grade 5": "grade 2",
      "grade 6": "grade 3",
      "grade 7": "grade 4",
      "grade 8": "grade 5",
      "grade 9": "grade 6",
      "grade 10": "grade 7",
      "grade 11": "grade 8",
      "grade 12": "grade 9",
      "grade 13": "grade 10",
      "grade 14": "grade 11",
      "grade 15": "grade 12",
      nursery: "nursery",
      lkg: "lkg",
      ukg: "ukg",
    };

    const missing: string[] = [];
    for (const eg of erpGradesOnStudents) {
      const real = erpToReal[eg.trim().toLowerCase()];
      if (!real) {
        missing.push(`${eg} (no +3 translation)`);
        continue;
      }
      if (!mappingRealGrades.has(real)) {
        missing.push(`${eg} → ${real}`);
      }
    }

    // Catalog cross-check: products tagged for this school whose grade
    // value isn't in the school_given_grade_name set. DSE-stream tags
    // (e.g. "Grade 10 DSE") are intentionally a parallel stream — they
    // only surface to students whose grade is the DSE variant — so
    // they don't live in school_grade_mappings and aren't real orphans.
    // See components/admin/ProductEditTabs.tsx (DSE_GRADES) for the
    // canonical DSE vocabulary.
    const givenSet = new Set(
      mappingRows
        .map((m) => (m.school_given_grade_name ?? "").trim().toLowerCase())
        .filter(Boolean)
    );
    const productGradeRows = (await db.execute(sql`
      SELECT DISTINCT pg.grade
        FROM product_grades pg
        JOIN product_school ps ON ps.product_id = pg.product_id
       WHERE ps.school_id = ${s.id}
         AND pg.grade IS NOT NULL
         AND pg.grade !~* 'DSE'
       ORDER BY pg.grade
    `)) as unknown as { grade: string }[];
    const productOrphans = productGradeRows
      .map((r) => r.grade)
      .filter((g) => g && !givenSet.has(g.trim().toLowerCase()));

    console.log(
      `${s.school_code} · ${s.name ?? "?"} · status=${s.status ?? "?"}`
    );
    console.log(
      `  students=${studentCount?.n ?? 0}  mappings=${mappingRows.length}` +
        `  ERP grades on students=${erpGradesOnStudents.length}`
    );
    if (missing.length > 0) {
      totalGaps += missing.length;
      console.log(`  GAPS (no mapping row): ${missing.join(", ")}`);
    } else {
      console.log(`  GAPS: none`);
    }
    if (productOrphans.length > 0) {
      totalProductGaps += productOrphans.length;
      console.log(
        `  PRODUCT GRADE ORPHANS (not in school_given_grade_name set): ` +
          productOrphans.join(", ")
      );
    }
    if (mappingRows.length > 0) {
      console.log(
        `  map:`,
        mappingRows
          .map((m) => `${m.grade}→${m.school_given_grade_name}`)
          .join(", ")
      );
    }
    console.log();
  }

  console.log(
    `Summary: ${schools.length} schools · ${totalGaps} student-grade gaps · ${totalProductGaps} product-grade orphans`
  );
  console.log(
    totalGaps === 0
      ? "  OK — safe to run the remap script."
      : "  FIX FIRST — fill missing rows via /admin/schools/[id] → Grades, then re-run this audit."
  );
}

main()
  .then(() => client.end())
  .catch((e) => {
    console.error(e);
    return client.end().then(() => process.exit(1));
  });
