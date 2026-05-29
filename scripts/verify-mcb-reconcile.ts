/**
 * Pick 5 random students that had a missing-parent link before today's
 * reconcile and now have both phones populated. One per school where possible.
 */
import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env.deploy") });
config({ path: path.resolve(process.cwd(), ".env") });

import postgres from "postgres";

async function main() {
  const dsn = process.env.DATABASE_URL || process.env.DATABASE_DIRECT_URL;
  const sql = postgres(dsn!, { prepare: false });
  try {
    const rows = await sql`
      WITH mp AS (
        SELECT s.id AS student_id,
               s.enrollment_number,
               m.school_name,
               m.student_name,
               m.grade, m.section,
               right(regexp_replace(coalesce(m.raw->>'FatherPhone',''),'\D','','g'),10) AS father,
               right(regexp_replace(coalesce(m.raw->>'MotherPhone',''),'\D','','g'),10) AS mother
        FROM mcb_students m
        JOIN students s ON s.enrollment_number = m.enrolment_number
        WHERE m.raw->>'FatherPhone' IS NOT NULL AND m.raw->>'MotherPhone' IS NOT NULL
      ),
      lp AS (
        SELECT student_id,
               array_agg(right(regexp_replace(coalesce(phone_no,''),'\D','','g'),10)) AS phones,
               array_agg(DISTINCT guardian_erp_name) AS erp_names
        FROM student_guardian_links
        GROUP BY student_id
      ),
      eligible AS (
        SELECT mp.*, lp.phones, lp.erp_names,
               array['MCB-G-'||mp.father, 'MCB-G-'||mp.mother] <@ lp.erp_names AS has_both_mcb_links
        FROM mp
        JOIN lp USING (student_id)
        WHERE length(mp.father)=10 AND length(mp.mother)=10
          AND mp.father = ANY(lp.phones)
          AND mp.mother = ANY(lp.phones)
      ),
      ranked AS (
        SELECT *,
               ROW_NUMBER() OVER (PARTITION BY school_name ORDER BY random()) AS rn
        FROM eligible
        WHERE has_both_mcb_links
      )
      SELECT student_id, enrollment_number, school_name, student_name, grade, section, father, mother
      FROM ranked
      WHERE rn = 1
      ORDER BY school_name
      LIMIT 5
    `;

    console.log(`\nPicked ${rows.length} students (1 per school, randomised among those reconciled today):\n`);
    for (const r of rows) {
      console.log(`  /admin/students/${r.student_id}`);
      console.log(`    ${r.enrollment_number}  ${r.student_name}`);
      console.log(`    ${r.school_name}  ${r.grade ?? ""}-${r.section ?? ""}`);
      console.log(`    expected on Relations tab: Father ${r.father}  +  Mother ${r.mother}\n`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
