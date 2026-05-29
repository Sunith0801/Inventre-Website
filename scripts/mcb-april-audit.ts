/* eslint-disable no-console */
/**
 * One-off MCB fee audit. Dumps every student's last fee-paid status
 * keyed against the April 2026 ops line. Output:
 *
 *   scripts/migrate-from-erp/_reports/mcb-april-fee-status-<ts>.csv
 *
 *   enrolment_number, school_code, school_name, name, grade, section,
 *   last_fee_paid_date, last_fee_paid_amount, status
 *
 * status = paid_april+ | paid_march | paid_earlier | unpaid
 *
 *   npx tsx scripts/mcb-april-audit.ts
 */

import { config } from "dotenv";
import path from "path";
import fs from "fs";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";

const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_DIRECT_URL or DATABASE_URL is required");

const client = postgres(url, { max: 5 });
const db = drizzle(client);

type Row = {
  enrolment_number: string;
  student_name: string | null;
  school_name: string | null;
  grade: string | null;
  section: string | null;
  last_fee_paid_date: string | null;
  last_fee_paid_amount: string | null;
};

function classify(date: string | null): "paid_april+" | "paid_march" | "paid_earlier" | "unpaid" {
  if (!date) return "unpaid";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "unpaid";
  if (d >= new Date("2026-04-01T00:00:00Z")) return "paid_april+";
  if (d >= new Date("2026-03-01T00:00:00Z")) return "paid_march";
  return "paid_earlier";
}

function csvEscape(v: string | null | undefined): string {
  if (v == null) return "";
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

async function main() {
  console.log("\n[mcb-april-audit] reading mcb_students…");
  const res = await db.execute(sql`
    SELECT enrolment_number, student_name, school_name, grade, section,
           last_fee_paid_date::text AS last_fee_paid_date, last_fee_paid_amount::text AS last_fee_paid_amount
      FROM mcb_students
     ORDER BY school_name NULLS LAST, last_fee_paid_date ASC NULLS LAST, enrolment_number
  `);
  const rows = ((res as { rows?: Row[] }).rows ?? (res as unknown as Row[])) as Row[];
  console.log(`  ${rows.length} rows.`);

  const counts = { "paid_april+": 0, paid_march: 0, paid_earlier: 0, unpaid: 0 };
  for (const r of rows) counts[classify(r.last_fee_paid_date)]++;

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.resolve(process.cwd(), "scripts/migrate-from-erp/_reports");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `mcb-april-fee-status-${ts}.csv`);

  const header = [
    "enrolment_number",
    "school_name",
    "name",
    "grade",
    "section",
    "last_fee_paid_date",
    "last_fee_paid_amount",
    "status",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.enrolment_number,
        r.school_name,
        r.student_name,
        r.grade,
        r.section,
        r.last_fee_paid_date,
        r.last_fee_paid_amount,
        classify(r.last_fee_paid_date),
      ]
        .map(csvEscape)
        .join(",")
    );
  }
  fs.writeFileSync(outPath, lines.join("\n"));

  console.log("\nFee status distribution:");
  for (const [k, v] of Object.entries(counts)) {
    console.log(`  ${k.padEnd(14)} ${v.toLocaleString()}`);
  }
  console.log(`\n  → ${outPath}\n`);
  await client.end();
}

main().catch(async (e) => {
  console.error(e);
  await client.end();
  process.exit(1);
});
