/* eslint-disable no-console */
/**
 * Audit storefront grade display across every school.
 *
 * For each student we compute:
 *   - stored        = students.grade (ERP-uniform vocab)
 *   - display       = school_grade_mappings.schoolGivenGradeName for
 *                     (students.school_id, students.grade) — what
 *                     session.ts and the admin views surface after the
 *                     erpGradeToReal-keyed translation fix.
 *   - mcb           = mcb_students.grade  (MCB source of truth; null for
 *                     non-MCB students)
 *   - mcb_simplified = mcb stripped to "Class N" / "Nursery|LKG|UKG" using
 *                     the same parser mcbGradeToCanonical uses internally.
 *
 * We then bucket each row:
 *   ALIGN          display matches MCB-simplified (Class 3 ↔ Grade 3, etc.)
 *   DISPLAY_MISS   no school_grade_mappings row → parent sees raw stored grade
 *   MCB_MISMATCH   display present but doesn't reconcile with MCB
 *   NO_MCB         non-MCB-granted student — display correctness not auditable
 *                  from this script alone
 *
 * READ-ONLY.
 *
 *   DATABASE_URL="..." DATABASE_DIRECT_URL="..." \
 *     npx tsx scripts/audit-grade-display-all-schools.ts
 */

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import * as schema from "../db/schema";

const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

const ROMAN: Record<string, number> = {
  I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6,
  VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12,
};

function mcbToNum(raw: string | null): { kind: "preprimary"; v: "Nursery" | "LKG" | "UKG" } | { kind: "class"; n: number } | null {
  if (!raw) return null;
  const s = raw.trim();
  if (/\bnur(?:sery)?\b/i.test(s)) return { kind: "preprimary", v: "Nursery" };
  if (/\blkg\b/i.test(s)) return { kind: "preprimary", v: "LKG" };
  if (/\bukg\b/i.test(s)) return { kind: "preprimary", v: "UKG" };
  let m = s.match(/\b(?:class|grade|gr\.?)[\s\-_]*(\d{1,2})\b/i);
  if (m) return { kind: "class", n: parseInt(m[1], 10) };
  m = s.match(/\b(?:class|grade|gr\.?)[\s\-_]+(I{1,3}|IV|V|VI{0,3}|IX|X{1,2}I{0,2})\b/i);
  if (m) return { kind: "class", n: ROMAN[m[1].toUpperCase()] };
  m = s.match(/^\s*(I{1,3}|IV|V|VI{0,3}|IX|X{1,2}I{0,2})\b/i);
  if (m) return { kind: "class", n: ROMAN[m[1].toUpperCase()] };
  return null;
}

// Normalize a display label to a comparable canonical form.
//   "Class 3", "Grade 3", "CLASS III", "Std 3" → "G3"
//   "Nursery"/"LKG"/"UKG" → "PreN"/"PreL"/"PreU"
function normalizeLabel(raw: string | null): string | null {
  const t = mcbToNum(raw);
  if (!t) return null;
  if (t.kind === "preprimary") return `Pre${t.v[0]}`;
  return `G${t.n}`;
}

type Row = {
  school_name: string;
  school_id: string;
  student_id: string;
  enrolment_number: string | null;
  student_name: string;
  stored: string | null;
  display: string | null;
  mcb: string | null;
};

async function main() {
  const rows = (await db.execute(sql`
    SELECT sc.school_name,
           s.school_id,
           s.id AS student_id,
           s.enrollment_number AS enrolment_number,
           COALESCE(s.first_name, s.erp_name) AS student_name,
           s.grade AS stored,
           (
             SELECT school_given_grade_name FROM school_grade_mappings sgm
              WHERE sgm.school_id = s.school_id AND lower(sgm.grade) = lower(s.grade)
              LIMIT 1
           ) AS display,
           m.grade AS mcb
      FROM students s
      LEFT JOIN schools sc ON sc.id = s.school_id
      LEFT JOIN mcb_students m ON m.enrolment_number = s.enrollment_number
     WHERE s.enabled = true
       AND s.grade IS NOT NULL
       AND sc.school_name IS NOT NULL
     ORDER BY sc.school_name, s.enrollment_number
  `)) as unknown as Row[];

  type B = { align: number; display_miss: number; mcb_mismatch: number; no_mcb: number; total: number };
  const bySchool = new Map<string, B>();
  const mismatches: Row[] = [];

  for (const r of rows) {
    const sch = r.school_name;
    if (!bySchool.has(sch)) bySchool.set(sch, { align: 0, display_miss: 0, mcb_mismatch: 0, no_mcb: 0, total: 0 });
    const b = bySchool.get(sch)!;
    b.total++;

    if (!r.display) {
      b.display_miss++;
      continue;
    }
    if (!r.mcb) {
      b.no_mcb++;
      continue;
    }
    const dispKey = normalizeLabel(r.display);
    const mcbKey = normalizeLabel(r.mcb);
    if (dispKey && mcbKey && dispKey === mcbKey) {
      b.align++;
    } else {
      b.mcb_mismatch++;
      mismatches.push(r);
    }
  }

  console.log("\nStorefront grade display audit — all schools\n");
  console.log("School".padEnd(38),
    "Align".padStart(8),
    "DisplayMiss".padStart(13),
    "MCBMismatch".padStart(13),
    "NoMCB".padStart(8),
    "Total".padStart(8),
  );
  console.log("-".repeat(95));
  for (const [school, b] of Array.from(bySchool.entries()).sort()) {
    console.log(school.padEnd(38),
      String(b.align).padStart(8),
      String(b.display_miss).padStart(13),
      String(b.mcb_mismatch).padStart(13),
      String(b.no_mcb).padStart(8),
      String(b.total).padStart(8),
    );
  }
  const g = { align: 0, display_miss: 0, mcb_mismatch: 0, no_mcb: 0, total: 0 };
  for (const b of bySchool.values()) {
    g.align += b.align; g.display_miss += b.display_miss; g.mcb_mismatch += b.mcb_mismatch; g.no_mcb += b.no_mcb; g.total += b.total;
  }
  console.log("-".repeat(95));
  console.log("TOTAL".padEnd(38),
    String(g.align).padStart(8),
    String(g.display_miss).padStart(13),
    String(g.mcb_mismatch).padStart(13),
    String(g.no_mcb).padStart(8),
    String(g.total).padStart(8),
  );

  if (mismatches.length > 0) {
    console.log(`\nFirst ${Math.min(mismatches.length, 20)} MCB↔display mismatches:`);
    for (const r of mismatches.slice(0, 20)) {
      console.log(`  ${r.enrolment_number ?? "—"}  ${r.student_name}  @ ${r.school_name}`);
      console.log(`    stored="${r.stored}"  display="${r.display}"  mcb="${r.mcb}"`);
    }
    if (mismatches.length > 20) console.log(`  ... and ${mismatches.length - 20} more`);
  }

  console.log("");
}

main().then(() => client.end()).catch((e) => { console.error(e); return client.end().then(() => process.exit(1)); });
