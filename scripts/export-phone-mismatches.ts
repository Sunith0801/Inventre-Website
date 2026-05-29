/**
 * Export a CSV of students whose registered/old phone numbers don't match
 * MCB's current Father/Mother phones.
 *
 * "Old phone" = the parent login number (`parents.phone` via
 * `students.parent_id`). We also include the full guardian-links phones
 * for context and a `mismatch_kind` column so the ops team can sort:
 *
 *   - login_not_in_mcb        parents.phone is NOT any MCB phone
 *   - mcb_father_missing      MCB Father phone has no link row on this student
 *   - mcb_mother_missing      MCB Mother phone has no link row on this student
 *   - link_not_in_mcb         a guardian-link phone is not any MCB phone
 *
 * One CSV per school under /root/Inventre/tmp/phone-mismatches/<school>.csv
 * plus a combined /root/Inventre/tmp/phone-mismatches/_all.csv .
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
function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(",") + "\n";
}
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

const HEADER = [
  "school_name",
  "enrollment_number",
  "student_name",
  "grade",
  "section",
  "login_mobile",            // parents.phone (old/registered login number)
  "link_phones",             // all student_guardian_links phones, semicolon separated, with relation
  "mcb_father_name",
  "mcb_father_phone",
  "mcb_mother_name",
  "mcb_mother_phone",
  "mismatch_kinds",          // comma-separated list of the kinds above
];

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  try {
    const rows = (await sql`
      WITH mcb AS (
        SELECT s.id AS student_id,
               s.enrollment_number,
               s.grade AS s_grade,
               s.section AS s_section,
               m.school_name,
               m.student_name,
               m.grade AS mcb_grade,
               m.section AS mcb_section,
               right(regexp_replace(coalesce(m.raw->>'FatherPhone',''),'\D','','g'),10) AS f_phone,
               right(regexp_replace(coalesce(m.raw->>'MotherPhone',''),'\D','','g'),10) AS m_phone,
               NULLIF(m.raw->>'FatherName','') AS f_name,
               NULLIF(m.raw->>'MotherName','') AS m_name
        FROM mcb_students m
        JOIN students s ON s.enrollment_number = m.enrolment_number
      ),
      links AS (
        SELECT l.student_id,
               string_agg(
                 trim(both ' /' FROM coalesce(l.relation,'') || ' ' ||
                      right(regexp_replace(coalesce(l.phone_no,''),'\D','','g'),10)),
                 '; '
                 ORDER BY l.row_idx
               ) AS link_phones_str,
               array_agg(right(regexp_replace(coalesce(l.phone_no,''),'\D','','g'),10)
                         ORDER BY l.row_idx) AS link_phone_arr
        FROM student_guardian_links l
        GROUP BY l.student_id
      ),
      parent_login AS (
        SELECT s.id AS student_id,
               right(regexp_replace(coalesce(p.phone,''),'\D','','g'),10) AS login_phone
        FROM students s LEFT JOIN parents p ON p.id = s.parent_id
      )
      SELECT mcb.*,
             pl.login_phone,
             coalesce(l.link_phones_str,'') AS link_phones_str,
             coalesce(l.link_phone_arr, '{}'::text[]) AS link_phone_arr
      FROM mcb
      LEFT JOIN links l USING (student_id)
      LEFT JOIN parent_login pl USING (student_id)
      ORDER BY mcb.school_name, mcb.enrollment_number
    `) as any[];

    const outDir = path.resolve(process.cwd(), "tmp/phone-mismatches");
    fs.mkdirSync(outDir, { recursive: true });
    // Wipe prior export
    for (const f of fs.readdirSync(outDir)) fs.unlinkSync(path.join(outDir, f));

    const fhAll = fs.openSync(path.join(outDir, "_all.csv"), "w");
    fs.writeSync(fhAll, csvRow(HEADER));
    const perSchool = new Map<string, number>();
    let total = 0;
    const counts: Record<string, number> = {};

    for (const r of rows) {
      const fPhone = String(r.f_phone || "");
      const mPhone = String(r.m_phone || "");
      const login = String(r.login_phone || "");
      const links: string[] = (r.link_phone_arr ?? []).map((x: any) => String(x || ""));

      const kinds: string[] = [];
      if (login && login.length === 10 && login !== fPhone && login !== mPhone) {
        kinds.push("login_not_in_mcb");
      }
      if (fPhone.length === 10 && !links.includes(fPhone)) {
        kinds.push("mcb_father_missing");
      }
      if (mPhone.length === 10 && !links.includes(mPhone)) {
        kinds.push("mcb_mother_missing");
      }
      for (const lp of links) {
        if (lp.length === 10 && lp !== fPhone && lp !== mPhone) {
          kinds.push("link_not_in_mcb");
          break;
        }
      }
      if (kinds.length === 0) continue;

      for (const k of kinds) counts[k] = (counts[k] ?? 0) + 1;
      total++;

      const cells = [
        r.school_name ?? "",
        r.enrollment_number ?? "",
        r.student_name ?? "",
        r.s_grade ?? r.mcb_grade ?? "",
        r.s_section ?? r.mcb_section ?? "",
        login,
        r.link_phones_str ?? "",
        r.f_name ?? "",
        fPhone,
        r.m_name ?? "",
        mPhone,
        kinds.join(","),
      ];
      const line = csvRow(cells);
      fs.writeSync(fhAll, line);

      const school = String(r.school_name ?? "unknown");
      const fname = `${slug(school) || "unknown"}.csv`;
      const fp = path.join(outDir, fname);
      if (!perSchool.has(fname)) {
        fs.writeFileSync(fp, csvRow(HEADER));
        perSchool.set(fname, 0);
      }
      fs.appendFileSync(fp, line);
      perSchool.set(fname, (perSchool.get(fname) ?? 0) + 1);
    }
    fs.closeSync(fhAll);

    console.log(`\n[mismatch-export] total students with at least one mismatch: ${total}`);
    console.log(`[mismatch-export] by kind:`);
    for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      console.log(`   ${k.padEnd(22)} ${v}`);
    }
    console.log(`\n[mismatch-export] per school:`);
    for (const [f, n] of [...perSchool].sort()) {
      console.log(`   ${f.padEnd(45)} ${n}  →  ${path.join(outDir, f)}`);
    }
    console.log(`\n[mismatch-export] combined:  ${path.join(outDir, "_all.csv")}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
