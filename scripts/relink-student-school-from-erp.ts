/* eslint-disable no-console */
/**
 * One-shot backfill: relink students.school_id (and students.school_code)
 * to whatever schools.school_code matches erp_raw->>'school_code'.
 *
 * Why: upsertStudentMirror in lib/erp-poll.ts deliberately doesn't
 * touch school_id (it's treated as an "auth column"). When a student
 * moves schools upstream — most recently the TTT-* → CAS-* migrations
 * (1,617 students as of 2026-06-01) — the local school_id stays
 * stuck, so the storefront shows them the old school's catalog and
 * the new school's catalog appears empty.
 *
 * Safety rails:
 *   - Only relinks when the ERP-told school exists locally AND is
 *     active.
 *   - Skips when erp_raw is null or school_code is missing.
 *   - Idempotent: already-correct rows are no-ops.
 *
 * Modes:
 *   default        — dry-run
 *   --apply        — perform the writes
 *
 *   DATABASE_URL="postgres://inventre:inventre_prod@localhost:6433/inventre" \
 *   DATABASE_DIRECT_URL="postgres://inventre:inventre_prod@localhost:55433/inventre" \
 *     npx tsx scripts/relink-student-school-from-erp.ts [--apply]
 */

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.deploy") });
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";

const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_DIRECT_URL or DATABASE_URL is required");
const client = postgres(url, { max: 1 });
const db = drizzle(client);

const APPLY = process.argv.includes("--apply");

async function main() {
  const candidates = (await db.execute(sql`
    SELECT s.id::text                AS student_id,
           s.enrollment_number,
           cur_sc.school_code        AS current_code,
           erp_sc.id::text           AS new_school_id,
           erp_sc.school_code        AS new_code,
           erp_sc.status::text       AS new_status
      FROM students s
      JOIN schools cur_sc ON cur_sc.id = s.school_id
 LEFT JOIN schools erp_sc ON erp_sc.school_code = s.erp_raw->>'school_code'
     WHERE s.erp_raw->>'school_code' IS NOT NULL
       AND s.erp_raw->>'school_code' <> cur_sc.school_code
  `)) as unknown as {
    student_id: string;
    enrollment_number: string | null;
    current_code: string;
    new_school_id: string | null;
    new_code: string | null;
    new_status: string | null;
  }[];

  console.log(
    `\nMode: ${APPLY ? "APPLY" : "DRY-RUN"}\nCandidates: ${candidates.length}\n`
  );

  let updated = 0;
  let skipped_missing_school = 0;
  let skipped_inactive = 0;
  const samples: string[] = [];

  // Tally by transition
  const byTransition = new Map<string, number>();

  for (const c of candidates) {
    const key = `${c.current_code} → ${c.new_code ?? "(no such school)"}`;
    byTransition.set(key, (byTransition.get(key) ?? 0) + 1);

    if (!c.new_school_id) {
      skipped_missing_school++;
      continue;
    }
    if (c.new_status !== "active") {
      skipped_inactive++;
      continue;
    }
    if (samples.length < 8) {
      samples.push(
        `  ${c.enrollment_number ?? "?"}: ${c.current_code} → ${c.new_code}`
      );
    }
    updated++;
    if (APPLY) {
      await db.execute(sql`
        UPDATE students
           SET school_id   = ${c.new_school_id}::uuid,
               school_code = ${c.new_code}
         WHERE id = ${c.student_id}::uuid
      `);
    }
  }

  console.log("Transitions:");
  for (const [k, n] of [...byTransition.entries()].sort(
    (a, b) => b[1] - a[1]
  )) {
    console.log(`  ${k}: ${n}`);
  }
  console.log(
    `\nWould update: ${updated}` +
      `  skipped (no such school): ${skipped_missing_school}` +
      `  skipped (target inactive): ${skipped_inactive}`
  );
  console.log("\nSamples:");
  for (const line of samples) console.log(line);
  console.log(
    `\n${APPLY ? "Applied." : "Dry-run — re-run with --apply to commit."}\n`
  );
}

main()
  .then(() => client.end())
  .catch((e) => {
    console.error(e);
    return client.end().then(() => process.exit(1));
  });
