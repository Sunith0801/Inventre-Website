/* eslint-disable no-console */
/**
 * One-shot cleanup that consolidates every `guardians` row sharing a
 * mobile number into a single canonical row, identical to the runtime
 * /api/admin/data/guardians/merge-by-phone endpoint (Issue 2). Runs the
 * merge for every duplicate-phone group in one pass — heals the existing
 * dataset so the runtime endpoint only has to handle stragglers.
 *
 *   npx tsx scripts/dedupe-guardians.ts            # dry-run + apply
 *   npx tsx scripts/dedupe-guardians.ts --dry-run  # report only, no writes
 *
 * Idempotent: re-running after a successful pass produces zero merges.
 *
 * Algorithm matches the API endpoint:
 *   1. Pick canonical = row with most student_guardian_links (oldest
 *      synced_at as tie-break).
 *   2. UPDATE student_guardian_links.guardian_erp_name from each
 *      non-canonical erp_name → canonical.
 *   3. Fill blanks on canonical from any donor row (guardian_name,
 *      email_address, mobile_number).
 *   4. DELETE non-canonical guardians.
 */

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";

const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_DIRECT_URL or DATABASE_URL is required");

const client = postgres(url, { max: 5 });
const db = drizzle(client);

type GuardianRow = {
  id: string;
  erp_name: string | null;
  guardian_name: string | null;
  mobile_number: string | null;
  email_address: string | null;
  email: string | null;
  synced_at: string | null;
  link_count: number;
};

type DupGroup = { phone: string; rows: GuardianRow[] };

async function loadDupGroups(): Promise<DupGroup[]> {
  const res = await db.execute(sql`
    WITH dup AS (
      SELECT right(regexp_replace(coalesce(mobile_number, ''), '\D', '', 'g'), 10) AS phone
        FROM guardians
       WHERE coalesce(mobile_number, '') <> ''
       GROUP BY 1
      HAVING COUNT(*) > 1 AND LENGTH(right(regexp_replace(coalesce(mobile_number, ''), '\D', '', 'g'), 10)) = 10
    )
    SELECT d.phone,
           g.id, g.erp_name, g.guardian_name, g.mobile_number, g.email_address, g.email, g.synced_at,
           (SELECT COUNT(*) FROM student_guardian_links sgl WHERE sgl.guardian_erp_name = g.erp_name)::int AS link_count
      FROM dup d
      JOIN guardians g
        ON right(regexp_replace(coalesce(g.mobile_number, ''), '\D', '', 'g'), 10) = d.phone
     ORDER BY d.phone, link_count DESC, g.synced_at ASC NULLS LAST, g.id ASC
  `);
  const rows = ((res as { rows?: (GuardianRow & { phone: string })[] }).rows ??
    (res as unknown as (GuardianRow & { phone: string })[])) as (GuardianRow & { phone: string })[];
  const byPhone = new Map<string, GuardianRow[]>();
  for (const r of rows) {
    const list = byPhone.get(r.phone) ?? [];
    list.push(r);
    byPhone.set(r.phone, list);
  }
  return Array.from(byPhone.entries()).map(([phone, rows]) => ({ phone, rows }));
}

async function mergeGroup(group: DupGroup, dryRun: boolean): Promise<{ rewired: number; deleted: number }> {
  let canonical = group.rows[0]; // highest link_count, oldest synced_at
  if (!canonical.erp_name) {
    const minted = `LOCAL-PH-${group.phone}`;
    if (!dryRun) {
      await db.execute(sql`UPDATE guardians SET erp_name = ${minted} WHERE id = ${canonical.id}`);
    }
    canonical = { ...canonical, erp_name: minted };
  }

  const losers = group.rows.slice(1);
  const loserErpNames = losers.map((r) => r.erp_name).filter((s): s is string => !!s);

  let rewired = 0;
  if (!dryRun) {
    if (loserErpNames.length > 0) {
      const inList = sql.join(loserErpNames.map((n) => sql`${n}`), sql`, `);
      const r = await db.execute(sql`
        UPDATE student_guardian_links
           SET guardian_erp_name = ${canonical.erp_name}
         WHERE guardian_erp_name IN (${inList})
      `);
      rewired = ((r as { rowCount?: number }).rowCount ?? 0) as number;
    }
    // Fill canonical blanks
    const merged: Record<string, unknown> = {};
    for (const k of ["guardian_name", "mobile_number", "email_address", "email"] as const) {
      if (!canonical[k]) {
        const donor = losers.find((r) => r[k]);
        if (donor) merged[k] = donor[k];
      }
    }
    if (Object.keys(merged).length > 0) {
      const set = Object.entries(merged)
        .map(([k, v]) => sql`${sql.raw(k)} = ${v}`)
        .reduce((acc, cur, i) => (i === 0 ? cur : sql`${acc}, ${cur}`));
      await db.execute(sql`UPDATE guardians SET ${set} WHERE id = ${canonical.id}`);
    }
    const loserIds = losers.map((r) => r.id);
    if (loserIds.length > 0) {
      const idList = sql.join(loserIds.map((n) => sql`${n}`), sql`, `);
      await db.execute(sql`DELETE FROM guardians WHERE id IN (${idList})`);
    }
  } else {
    rewired = losers.reduce((s, r) => s + r.link_count, 0);
  }
  return { rewired, deleted: losers.length };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`\n[dedupe-guardians] ${dryRun ? "DRY-RUN" : "LIVE"} — scanning for duplicate-mobile groups…\n`);

  const groups = await loadDupGroups();
  console.log(`  Found ${groups.length} duplicate-mobile groups.`);
  if (groups.length === 0) {
    console.log("  Nothing to do.\n");
    await client.end();
    return;
  }

  const totalDupRows = groups.reduce((s, g) => s + (g.rows.length - 1), 0);
  console.log(`  Will collapse ${totalDupRows} extra rows.\n`);

  let totalRewired = 0;
  let totalDeleted = 0;
  for (const g of groups) {
    const { rewired, deleted } = await mergeGroup(g, dryRun);
    totalRewired += rewired;
    totalDeleted += deleted;
    if (groups.indexOf(g) < 5 || groups.indexOf(g) % 50 === 0) {
      console.log(
        `  phone=${g.phone}  rows=${g.rows.length}  kept=${g.rows[0].erp_name}  ${dryRun ? "would rewire" : "rewired"}=${rewired}  ${dryRun ? "would delete" : "deleted"}=${deleted}`
      );
    }
  }

  console.log(`\n[dedupe-guardians] ${dryRun ? "DRY-RUN" : "LIVE"} done.`);
  console.log(`  Groups processed: ${groups.length}`);
  console.log(`  Total student_guardian_links rewired: ${totalRewired}`);
  console.log(`  Total guardians rows ${dryRun ? "would be" : ""} deleted: ${totalDeleted}\n`);

  await client.end();
}

main().catch(async (e) => {
  console.error(e);
  await client.end();
  process.exit(1);
});
