/* eslint-disable no-console */
/**
 * Move CAS pre-primary (Nursery/LKG/UKG) students to their TTT sister
 * school. CAS schools don't run pre-primary cohorts — those students
 * attend the TTT (TIC TAC TOE) sister branch.
 *
 *   CASLRCBSE   → TTTLR
 *   CASLRCIE    → TTTLR
 *   CASNIBMCBSE → TTTNIBM
 *   CASNIBMCIE  → TTTNIBM
 *
 * Updates students.school_id + students.school_code. All FK references
 * (orders, carts, addresses, etc.) stay tied to students.id and don't
 * need updating.
 *
 *   npx tsx scripts/move-cas-preprimary-to-ttt.ts           # dry-run
 *   npx tsx scripts/move-cas-preprimary-to-ttt.ts --apply
 */
import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import * as schema from "../db/schema";

const APPLY = process.argv.includes("--apply");

const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

const MOVES: Record<string, string> = {
  CASLRCBSE: "TTTLR",
  CASLRCIE: "TTTLR",
  CASNIBMCBSE: "TTTNIBM",
  CASNIBMCIE: "TTTNIBM",
};
const PRE_PRIMARY = ["Nursery", "LKG", "UKG"];

async function main() {
  console.log(`\nMove CAS pre-primary students → TTT sister schools  (${APPLY ? "APPLY" : "DRY-RUN"})\n`);

  // Resolve school IDs.
  const schools = (await db.execute(sql`
    SELECT school_code, id FROM schools
     WHERE school_code IN (${sql.join(
       [...Object.keys(MOVES), ...Object.values(MOVES)].map((c) => sql`${c}`),
       sql`, `,
     )})
  `)) as unknown as { school_code: string; id: string }[];
  const id = Object.fromEntries(schools.map((s) => [s.school_code, s.id]));

  let total = 0;
  for (const [from, to] of Object.entries(MOVES)) {
    const fromId = id[from];
    const toId = id[to];
    if (!fromId || !toId) {
      console.log(`  ⚠ ${from} → ${to}: school id missing, skip`);
      continue;
    }
    const rows = (await db.execute(sql`
      SELECT id, grade, first_name, enrollment_number FROM students
       WHERE school_id = ${fromId}
         AND grade IN (${sql.join(PRE_PRIMARY.map((g) => sql`${g}`), sql`, `)})
    `)) as unknown as { id: string; grade: string; first_name: string|null; enrollment_number: string|null }[];

    const byGrade = new Map<string, number>();
    for (const r of rows) byGrade.set(r.grade, (byGrade.get(r.grade) ?? 0) + 1);
    console.log(`  ${from.padEnd(13)} → ${to.padEnd(8)} ${rows.length} students  (${
      [...byGrade.entries()].map(([g, n]) => `${g}: ${n}`).join(", ")
    })`);

    if (APPLY && rows.length > 0) {
      // Skip 5 known anomaly enrolments (different students sharing a
      // typo/test number across schools) — the partial unique index
      // on (school_id, enrollment_number) would otherwise collide.
      await db.execute(sql`
        UPDATE students SET school_id = ${toId}, school_code = ${to}
         WHERE school_id = ${fromId}
           AND grade IN (${sql.join(PRE_PRIMARY.map((g) => sql`${g}`), sql`, `)})
           AND enrollment_number NOT IN ('123456','25100','25101','25102','25CAG10299')
      `);
    }
    total += rows.length;
  }

  console.log(`\nDone. ${total} students would be moved.`);
  if (!APPLY) console.log(`DRY-RUN — re-run with --apply to commit.\n`);
}

main().then(() => client.end()).catch((e) => { console.error(e); return client.end().then(() => process.exit(1)); });
