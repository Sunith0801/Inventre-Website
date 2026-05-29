/* eslint-disable no-console */
/**
 * Audit MCB enrolment-number prefixes per school.
 *   npx tsx scripts/mcb-prefix-check.ts
 *
 * Ops rule:
 *   Winmore Whitefield   → contains "WF"
 *   St. Andrews Keesara  → contains "KS"
 *   St. Andrews Suchitra → contains "BP" or "SC"
 */
import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";

const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const client = postgres(url, { max: 3 });
const db = drizzle(client);

type Row = { school_name: string | null; letters: string | null; n: number };

async function main() {
  // Extract the alpha run from the enrolment number (strip leading digits).
  const res = await db.execute(sql`
    SELECT school_name,
           upper(substring(enrolment_number FROM '[A-Za-z]+')) AS letters,
           count(*)::int AS n
      FROM mcb_students
     GROUP BY school_name, letters
     ORDER BY school_name, n DESC
  `);
  const rows = (Array.isArray(res) ? res : (res as { rows?: unknown[] }).rows ?? []) as Row[];

  console.log("\n=== Letter-run distribution by school ===");
  for (const r of rows) {
    console.log(
      `  ${(r.school_name ?? "(null)").padEnd(40)} ${(r.letters ?? "(none)").padEnd(10)} ${r.n}`
    );
  }

  // Expected letters MUST appear somewhere in the alpha run.
  const expectations: Record<string, string[]> = {
    "Winmore Academy Whitefield": ["WF"],
    "St. ANDREWS SCHOOL KEESARA": ["KS"],
    "St. ANDREWS HIGH SCHOOL SUCHITRA": ["BP", "SC"],
  };

  console.log("\n=== Rows whose alpha run is missing the expected token ===");
  let issues = 0;
  for (const [school, allowed] of Object.entries(expectations)) {
    const sample = rows.filter((r) => r.school_name === school);
    for (const r of sample) {
      const letters = (r.letters || "").toUpperCase();
      const ok = allowed.some((t) => letters.includes(t));
      if (!ok) {
        console.log(`  ✗ ${school}: ${r.n} rows with letters "${letters || "(none)"}" — expected token ${allowed.join("/")}`);
        issues += r.n;
      }
    }
  }
  if (issues === 0) console.log("  ✓ Every constrained-school row contains the expected token (WF/KS/BP/SC).");

  console.log("\n=== Cross-school leaks (token under wrong school) ===");
  let leaks = 0;
  for (const r of rows) {
    const letters = (r.letters || "").toUpperCase();
    if (!letters) continue;
    for (const [school, tokens] of Object.entries(expectations)) {
      for (const t of tokens) {
        if (letters.includes(t) && r.school_name !== school) {
          // BP also appears inside "BPS" style tokens; only flag when school differs.
          // (Winmore Whitefield is "WMWF" — WF is a substring there.)
          console.log(`  ✗ token "${t}" found in letters "${letters}" under "${r.school_name}" (${r.n} rows) — expected "${school}"`);
          leaks += r.n;
        }
      }
    }
  }
  if (leaks === 0) console.log("  ✓ No cross-school leaks.");

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
