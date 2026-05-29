/**
 * Stale-phone cleanup: identify and (optionally) delete student_guardian_links
 * rows where:
 *   - the phone is NOT one of MCB's father/mother phone for that student, AND
 *   - the link's guardian_name matches MCB FatherName or MotherName (case-insensitive)
 *
 * Default: dry-run (lists matches). Pass --apply to actually delete.
 */
import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env.deploy") });
config({ path: path.resolve(process.cwd(), ".env") });

import postgres from "postgres";

const APPLY = process.argv.includes("--apply");

async function main() {
  const dsn = process.env.DATABASE_URL || process.env.DATABASE_DIRECT_URL;
  const sql = postgres(dsn!, { prepare: false });
  try {
    const matches = await sql`
      WITH mcb AS (
        SELECT s.id AS student_id, s.enrollment_number,
               m.school_name, m.student_name,
               right(regexp_replace(coalesce(m.raw->>'FatherPhone',''),'\D','','g'),10) AS father_phone,
               right(regexp_replace(coalesce(m.raw->>'MotherPhone',''),'\D','','g'),10) AS mother_phone,
               lower(NULLIF(m.raw->>'FatherName','')) AS father_name,
               lower(NULLIF(m.raw->>'MotherName','')) AS mother_name
        FROM mcb_students m JOIN students s ON s.enrollment_number = m.enrolment_number
      )
      SELECT l.id AS link_id, l.student_id, l.row_idx, l.relation,
             l.guardian_name AS link_name, l.phone_no AS link_phone,
             mcb.enrollment_number, mcb.school_name, mcb.student_name,
             mcb.father_phone, mcb.mother_phone
      FROM student_guardian_links l
      JOIN mcb USING (student_id)
      WHERE right(regexp_replace(coalesce(l.phone_no,''),'\D','','g'),10)
              NOT IN (mcb.father_phone, mcb.mother_phone)
        AND length(right(regexp_replace(coalesce(l.phone_no,''),'\D','','g'),10)) = 10
        AND lower(l.guardian_name) IS NOT NULL
        AND (lower(l.guardian_name) = mcb.father_name
             OR lower(l.guardian_name) = mcb.mother_name)
      ORDER BY mcb.school_name, mcb.enrollment_number
    `;

    console.log(`\n[stale-clean] matches to delete: ${matches.length}\n`);
    for (const r of matches) {
      console.log(
        `  ${r.enrollment_number} ${r.student_name} @ ${r.school_name?.slice(0, 28)}  ` +
          `link#${r.row_idx} rel=${r.relation ?? ""} name="${r.link_name}" stale=${r.link_phone} ` +
          `(MCB F=${r.father_phone} M=${r.mother_phone})`
      );
    }

    if (!APPLY) {
      console.log(`\n[stale-clean] DRY RUN — re-run with --apply to delete the above ${matches.length} rows.`);
      return;
    }

    if (matches.length === 0) {
      console.log(`[stale-clean] nothing to delete`);
      return;
    }
    const ids = matches.map((m) => m.link_id);
    const deleted = await sql`
      DELETE FROM student_guardian_links WHERE id = ANY(${ids}::uuid[]) RETURNING id
    `;
    console.log(`\n[stale-clean] DELETED ${deleted.count} rows.`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
