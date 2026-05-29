/* eslint-disable no-console */
/**
 * For three known long-enrolment -> short-enrolment pairs, dump the full
 * raw payload to find which MCB field carries the short form.
 *   26WMWF0136 -> WF260136
 *   25SMS0109  -> AW250116
 *   26BP0197   -> SC260197
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

const TARGETS: Record<string, string> = {
  "26WMWF0136": "WF260136",
  "25SMS0109":  "AW250116",
  "26BP0197":   "SC260197",
};

async function main() {
  for (const [long, expectedShort] of Object.entries(TARGETS)) {
    const res = await db.execute(sql`
      SELECT enrolment_number, student_name, school_name, raw
        FROM mcb_students WHERE enrolment_number = ${long} LIMIT 1
    `);
    const rows = (Array.isArray(res) ? res : (res as { rows?: unknown[] }).rows ?? []);
    const r = rows[0] as { enrolment_number: string; student_name: string | null; school_name: string | null; raw: Record<string, unknown> } | undefined;
    if (!r) {
      console.log(`\n${long}: NOT FOUND in mcb_students`);
      continue;
    }
    console.log(`\n=== ${long}  →  ${expectedShort}  (${r.student_name} @ ${r.school_name}) ===`);
    // Find every raw field that contains the expected short form.
    const hits: string[] = [];
    for (const [k, v] of Object.entries(r.raw || {})) {
      const s = typeof v === "string" ? v : JSON.stringify(v);
      if (s && s.toUpperCase().includes(expectedShort.toUpperCase())) {
        hits.push(`  ${k}: ${s}`);
      }
    }
    if (hits.length) {
      console.log("  --- fields matching expected short form ---");
      for (const h of hits) console.log(h);
    } else {
      console.log("  (no field contains the expected short form; dumping all keys)");
      for (const [k, v] of Object.entries(r.raw || {})) {
        console.log(`  ${k}: ${JSON.stringify(v)}`);
      }
    }
  }
  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
