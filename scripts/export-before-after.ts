/**
 * Per-school before/after CSV for today's MCB reconcile.
 *
 * "Before" = state from /root/Inventre/backups/inventre_migrate_20260526-233056.dump
 *   (restored into DB `inventre_pre_reconcile` on the deploy postgres)
 * "After" = current `inventre`
 *
 * For each student whose enrollment matches an MCB record (1037 in total):
 *   - guardian phones before vs after (with relation labels)
 *   - student email before vs after
 *   - change_kinds: which fields changed
 *
 * Outputs to /root/Inventre/tmp/before-after/<school>.csv plus _all.csv.
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
  "guardian_phones_before", "guardian_phones_after",
  "student_email_before", "student_email_after",
  "mcb_father_name", "mcb_father_phone",
  "mcb_mother_name", "mcb_mother_phone",
  "change_kinds",
];

async function fetchPhones(sql: postgres.Sql, studentIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (studentIds.length === 0) return out;
  const rows = (await sql`
    SELECT student_id,
           string_agg(
             trim(both ' ' FROM coalesce(relation,'') || ' ' ||
                  right(regexp_replace(coalesce(phone_no,''),'\D','','g'),10)),
             '; '
             ORDER BY row_idx
           ) AS phones
    FROM student_guardian_links
    WHERE student_id = ANY(${studentIds}::uuid[])
      AND phone_no IS NOT NULL AND phone_no <> ''
    GROUP BY student_id
  `) as any[];
  for (const r of rows) out.set(r.student_id, r.phones ?? "");
  return out;
}

async function fetchEmails(sql: postgres.Sql, studentIds: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (studentIds.length === 0) return out;
  const rows = (await sql`
    SELECT id, student_email_id FROM students WHERE id = ANY(${studentIds}::uuid[])
  `) as any[];
  for (const r of rows) out.set(r.id, r.student_email_id);
  return out;
}

async function main() {
  // Direct postgres (not pgbouncer) so we can address both DBs.
  const dsnAfter  = "postgres://inventre:inventre_prod@localhost:55433/inventre";
  const dsnBefore = "postgres://inventre:inventre_prod@localhost:55433/inventre_pre_reconcile";
  const after  = postgres(dsnAfter,  { prepare: false });
  const before = postgres(dsnBefore, { prepare: false });
  try {
    // Anchor list — current 1037 reconciled students with their MCB columns.
    const anchor = (await after`
      SELECT
        s.id AS student_id,
        m.school_name,
        s.enrollment_number,
        s.name AS student_name,
        coalesce(s.grade, m.grade)     AS grade,
        coalesce(s.section, m.section) AS section,
        NULLIF(m.raw->>'FatherName','') AS mcb_father_name,
        right(regexp_replace(coalesce(m.raw->>'FatherPhone',''),'\D','','g'),10) AS mcb_father_phone,
        NULLIF(m.raw->>'MotherName','') AS mcb_mother_name,
        right(regexp_replace(coalesce(m.raw->>'MotherPhone',''),'\D','','g'),10) AS mcb_mother_phone
      FROM mcb_students m
      JOIN students s ON s.enrollment_number = m.enrolment_number
      ORDER BY m.school_name, s.enrollment_number
    `) as any[];
    const ids = anchor.map((r) => r.student_id);

    // Fetch before & after phones / emails in two roundtrips each.
    const [phonesAfter, phonesBefore, emailsAfter, emailsBefore] = await Promise.all([
      fetchPhones(after, ids),
      fetchPhones(before, ids),
      fetchEmails(after, ids),
      fetchEmails(before, ids),
    ]);

    const outDir = path.resolve(process.cwd(), "tmp/before-after");
    fs.mkdirSync(outDir, { recursive: true });
    for (const f of fs.readdirSync(outDir)) fs.unlinkSync(path.join(outDir, f));
    const fhAll = fs.openSync(path.join(outDir, "_all.csv"), "w");
    fs.writeSync(fhAll, csvRow(HEADER));
    const perSchool = new Map<string, number>();
    let withChange = 0;
    const counts: Record<string, number> = {};

    for (const r of anchor) {
      const pBefore = phonesBefore.get(r.student_id) ?? "";
      const pAfter  = phonesAfter.get(r.student_id)  ?? "";
      const eBefore = emailsBefore.get(r.student_id) ?? null;
      const eAfter  = emailsAfter.get(r.student_id)  ?? null;

      const changes: string[] = [];
      if (pBefore !== pAfter) changes.push("phones_changed");
      if ((eBefore ?? "").toLowerCase() !== (eAfter ?? "").toLowerCase()) changes.push("email_changed");
      if (changes.length === 0) continue; // only export rows that changed
      withChange++;
      for (const k of changes) counts[k] = (counts[k] ?? 0) + 1;

      const line = csvRow([
        r.school_name ?? "",
        r.enrollment_number ?? "",
        r.student_name ?? "",
        r.grade ?? "",
        r.section ?? "",
        pBefore,
        pAfter,
        eBefore ?? "",
        eAfter ?? "",
        r.mcb_father_name ?? "",
        r.mcb_father_phone ?? "",
        r.mcb_mother_name ?? "",
        r.mcb_mother_phone ?? "",
        changes.join(","),
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

    console.log(`\n[before-after] students with at least one change: ${withChange} of ${anchor.length} reconciled\n`);
    console.log(`[before-after] by kind:`);
    for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      console.log(`   ${k.padEnd(18)} ${v}`);
    }
    console.log(`\n[before-after] per school:`);
    for (const [f, n] of [...perSchool].sort()) {
      console.log(`   ${f.padEnd(45)} ${n}  →  ${path.join(outDir, f)}`);
    }
    console.log(`\n[before-after] combined:  ${path.join(outDir, "_all.csv")}`);
  } finally {
    await Promise.all([after.end({ timeout: 5 }), before.end({ timeout: 5 })]);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
