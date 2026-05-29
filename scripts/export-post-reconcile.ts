/**
 * Export the post-reconcile state of every student whose enrolment matches
 * an MCB record (1037 students as of today's run). One CSV per school plus
 * a combined `_all.csv`.
 *
 * Columns:
 *   school_name, enrollment_number, student_name, grade, section,
 *   current_guardian_phones,   -- all link rows: "Father 99…; Mother 88…"
 *   current_student_email,
 *   mcb_father_name, mcb_father_phone,
 *   mcb_mother_name, mcb_mother_phone,
 *   mcb_email
 */
import { config } from "dotenv";
import path from "path";
import fs from "fs";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env.deploy") });
import postgres from "postgres";

function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
const csvRow = (c: unknown[]) => c.map(csvCell).join(",") + "\n";
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

const HEADER = [
  "school_name", "enrollment_number", "student_name", "grade", "section",
  "current_guardian_phones", "current_student_email",
  "mcb_father_name", "mcb_father_phone",
  "mcb_mother_name", "mcb_mother_phone",
  "mcb_email",
];

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  try {
    const rows = (await sql`
      SELECT
        m.school_name,
        s.enrollment_number,
        s.name AS student_name,
        coalesce(s.grade, m.grade)     AS grade,
        coalesce(s.section, m.section) AS section,
        s.student_email_id AS current_student_email,
        m.email            AS mcb_email,
        NULLIF(m.raw->>'FatherName','') AS mcb_father_name,
        right(regexp_replace(coalesce(m.raw->>'FatherPhone',''),'\D','','g'),10) AS mcb_father_phone,
        NULLIF(m.raw->>'MotherName','') AS mcb_mother_name,
        right(regexp_replace(coalesce(m.raw->>'MotherPhone',''),'\D','','g'),10) AS mcb_mother_phone,
        (
          SELECT string_agg(
            trim(both ' ' FROM coalesce(l.relation,'') || ' ' ||
                 right(regexp_replace(coalesce(l.phone_no,''),'\D','','g'),10)),
            '; '
            ORDER BY l.row_idx
          )
          FROM student_guardian_links l
          WHERE l.student_id = s.id
            AND l.phone_no IS NOT NULL AND l.phone_no <> ''
        ) AS current_guardian_phones
      FROM mcb_students m
      JOIN students s ON s.enrollment_number = m.enrolment_number
      ORDER BY m.school_name, s.enrollment_number
    `) as any[];

    const outDir = path.resolve(process.cwd(), "tmp/post-reconcile");
    fs.mkdirSync(outDir, { recursive: true });
    for (const f of fs.readdirSync(outDir)) fs.unlinkSync(path.join(outDir, f));

    const fhAll = fs.openSync(path.join(outDir, "_all.csv"), "w");
    fs.writeSync(fhAll, csvRow(HEADER));
    const perSchool = new Map<string, number>();

    for (const r of rows) {
      const line = csvRow([
        r.school_name ?? "",
        r.enrollment_number ?? "",
        r.student_name ?? "",
        r.grade ?? "",
        r.section ?? "",
        r.current_guardian_phones ?? "",
        r.current_student_email ?? "",
        r.mcb_father_name ?? "",
        r.mcb_father_phone ?? "",
        r.mcb_mother_name ?? "",
        r.mcb_mother_phone ?? "",
        r.mcb_email ?? "",
      ]);
      fs.writeSync(fhAll, line);
      const fname = `${slug(String(r.school_name ?? "unknown")) || "unknown"}.csv`;
      const fp = path.join(outDir, fname);
      if (!perSchool.has(fname)) {
        fs.writeFileSync(fp, csvRow(HEADER));
        perSchool.set(fname, 0);
      }
      fs.appendFileSync(fp, line);
      perSchool.set(fname, (perSchool.get(fname) ?? 0) + 1);
    }
    fs.closeSync(fhAll);

    console.log(`\n[post-reconcile] total students exported: ${rows.length}\n`);
    console.log(`[post-reconcile] per school:`);
    for (const [f, n] of [...perSchool].sort()) {
      console.log(`   ${f.padEnd(45)} ${n}  →  ${path.join(outDir, f)}`);
    }
    console.log(`\n[post-reconcile] combined:  ${path.join(outDir, "_all.csv")}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
