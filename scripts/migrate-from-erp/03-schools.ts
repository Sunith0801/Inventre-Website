/* eslint-disable no-console */
/**
 * Migrate distinct schools from Item.custom_school_name.
 * Upserts by name → schools.
 *
 *   npx tsx scripts/migrate-from-erp/03-schools.ts
 */

import { erpListPages } from "./_client";
import { db, shutdown, ensureCheckpointTable, writeCheckpoint } from "./_db";
import { schools } from "../../db/schema";
import { eq } from "drizzle-orm";

const SCRIPT = "03-schools";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function main() {
  await ensureCheckpointTable();
  console.log(`\n[${SCRIPT}] discovering distinct custom_school_name values\n`);

  const distinct = new Set<string>();
  for await (const page of erpListPages<{ custom_school_name: string | null }>("Item", {
    fields: ["custom_school_name"],
    pageSize: 200,
  })) {
    for (const r of page) {
      if (r.custom_school_name) distinct.add(r.custom_school_name.trim());
    }
  }
  console.log(`  found ${distinct.size} distinct school names`);

  let processed = 0;
  for (const name of distinct) {
    const slug = slugify(name);
    const existing = await db.select().from(schools).where(eq(schools.slug, slug)).limit(1);
    if (existing.length === 0) {
      await db
        .insert(schools)
        .values({ slug, name, status: "active", isFeatured: false })
        .onConflictDoNothing();
    }
    processed++;
    if (processed % 5 === 0) await writeCheckpoint(SCRIPT, processed);
  }

  await writeCheckpoint(SCRIPT, processed, null, true);
  console.log(`\n[${SCRIPT}] ✓ ${processed} schools upserted\n`);
  await shutdown();
}

main().catch(async (e) => {
  console.error("Fatal:", e);
  await shutdown();
  process.exit(1);
});
