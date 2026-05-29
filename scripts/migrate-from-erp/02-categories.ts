/* eslint-disable no-console */
/**
 * Migrate Item Group tree from ERPNext.
 * Upserts by name → categories. Builds materialized path.
 *
 *   npx tsx scripts/migrate-from-erp/02-categories.ts
 */

import { erpListPages } from "./_client";
import { db, shutdown, ensureCheckpointTable, writeCheckpoint } from "./_db";
import { categories } from "../../db/schema";
import { eq, isNull } from "drizzle-orm";

const SCRIPT = "02-categories";

type ItemGroup = {
  name: string;
  parent_item_group: string | null;
  is_group: number;
  lft?: number;
  rgt?: number;
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function main() {
  await ensureCheckpointTable();
  console.log(`\n[${SCRIPT}] migrating Item Groups\n`);

  // Pull entire tree first so we can resolve parents in any order
  const all: ItemGroup[] = [];
  for await (const page of erpListPages<ItemGroup>("Item Group", {
    fields: ["name", "parent_item_group", "is_group", "lft"],
    pageSize: 100,
  })) {
    all.push(...page);
  }
  console.log(`  fetched ${all.length} groups`);

  // Build a name → row map
  const byName = new Map(all.map((g) => [g.name, g]));

  // Upsert in order: roots first, then children. Sort by lft so parents come before children.
  all.sort((a, b) => (a.lft ?? 0) - (b.lft ?? 0));

  let processed = 0;
  for (const g of all) {
    const slug = slugify(g.name);
    let path = slug;
    if (g.parent_item_group && g.parent_item_group !== "All Item Groups") {
      const parent = byName.get(g.parent_item_group);
      if (parent) {
        const parentRow = await db
          .select()
          .from(categories)
          .where(eq(categories.slug, slugify(parent.name)))
          .limit(1);
        if (parentRow[0]) {
          path = `${parentRow[0].path}.${slug}`;
        }
      }
    }

    const parentDb = g.parent_item_group && g.parent_item_group !== "All Item Groups"
      ? await db
          .select()
          .from(categories)
          .where(eq(categories.slug, slugify(g.parent_item_group)))
          .limit(1)
      : [];

    await db
      .insert(categories)
      .values({
        slug,
        name: g.name,
        parentId: parentDb[0]?.id ?? null,
        sortOrder: g.lft ?? 0,
        path,
      })
      .onConflictDoUpdate({
        target: categories.slug,
        set: { name: g.name, parentId: parentDb[0]?.id ?? null, path },
      });
    processed++;
    if (processed % 10 === 0) await writeCheckpoint(SCRIPT, processed);
  }

  await writeCheckpoint(SCRIPT, processed, null, true);
  console.log(`\n[${SCRIPT}] ✓ ${processed} categories upserted\n`);
  await shutdown();
}

main().catch(async (e) => {
  console.error("Fatal:", e);
  await shutdown();
  process.exit(1);
});
