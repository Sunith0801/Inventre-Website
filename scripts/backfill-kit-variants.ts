/* eslint-disable no-console */
/**
 * Backfill missing product_variants rows for active kit products.
 *
 * Why: bookkits (and other kits) were imported as `products` rows without
 * a corresponding `product_variants` row, so add-to-cart can't resolve a
 * SKU and the storefront shows "Size not available". This script creates
 * one variant per affected kit so the language-picker / kit Add-to-Cart
 * flows succeed.
 *
 * Shape of inserted row:
 *   - size      = 'Standard'   (matches existing kit-variant convention)
 *   - sku       = <product.slug>  (slugs are UNIQUE, so SKU stays UNIQUE)
 *   - stock_qty = 0
 *   - is_active = true
 *   - erp_name  = NULL  (these aren't ERP-synced; multiple NULLs allowed)
 *
 * Usage:
 *   DATABASE_URL="postgres://inventre:inventre_prod@localhost:6433/inventre" \
 *     npx tsx scripts/backfill-kit-variants.ts            # dry-run
 *   DATABASE_URL=... npx tsx scripts/backfill-kit-variants.ts --commit
 */

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { db } from "../db/client";
import { sql } from "drizzle-orm";

const COMMIT = process.argv.includes("--commit");

type Row = { id: string; name: string; slug: string };

async function main() {
  // Active kits with NO active variants. Includes both standalone kits and
  // sibling-language leaves (variant_of_product_id IS NOT NULL).
  const candidates = (await db.execute(sql`
    SELECT p.id, p.name, p.slug
      FROM products p
     WHERE p.kind = 'kit'
       AND p.status = 'active'
       AND NOT EXISTS (
         SELECT 1 FROM product_variants pv
          WHERE pv.product_id = p.id AND pv.is_active = true
       )
     ORDER BY p.name
  `)) as unknown as Row[];

  console.log(`Found ${candidates.length} active kit products missing a variant.`);

  // Defensive: ensure no slug collides with an existing SKU. UNIQUE index on
  // product_variants.sku would error out otherwise.
  const slugs = candidates.map((c) => c.slug);
  const collisions = slugs.length === 0
    ? []
    : ((await db.execute(sql`
        SELECT sku FROM product_variants
         WHERE sku IN (${sql.join(slugs.map((s) => sql`${s}`), sql`, `)})
      `)) as unknown as { sku: string }[]);
  if (collisions.length > 0) {
    console.warn(
      `WARN: ${collisions.length} slug(s) already exist as SKUs; will skip those.`,
      collisions.slice(0, 10).map((c) => c.sku)
    );
  }
  const skipSet = new Set(collisions.map((c) => c.sku));
  const targets = candidates.filter((c) => !skipSet.has(c.slug));

  console.log(`Will insert variants for ${targets.length} products.`);
  if (targets.length > 0) {
    console.log("Sample (first 10):");
    for (const t of targets.slice(0, 10)) console.log(` - ${t.name}  (slug=${t.slug})`);
  }

  if (!COMMIT) {
    console.log("\nDRY RUN. Re-run with --commit to apply.");
    return;
  }

  if (targets.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  // Single bulk insert. ON CONFLICT DO NOTHING guards the race where a row
  // appeared between the SELECT above and this INSERT (e.g. concurrent
  // ERP sync). The UNIQUE on sku is also a backstop.
  const values = sql.join(
    targets.map(
      (t) => sql`(${t.id}::uuid, 'Standard', ${t.slug}, 0, 5, true)`
    ),
    sql`, `
  );
  const inserted = (await db.execute(sql`
    INSERT INTO product_variants
      (product_id, size, sku, stock_qty, low_stock_threshold, is_active)
    VALUES ${values}
    ON CONFLICT (sku) DO NOTHING
    RETURNING id
  `)) as unknown as { id: string }[];

  console.log(`Inserted ${inserted.length} product_variants rows.`);

  // Verification: re-query the kits still missing a variant.
  const remaining = (await db.execute(sql`
    SELECT COUNT(*) AS n
      FROM products p
     WHERE p.kind = 'kit'
       AND p.status = 'active'
       AND NOT EXISTS (
         SELECT 1 FROM product_variants pv
          WHERE pv.product_id = p.id AND pv.is_active = true
       )
  `)) as unknown as [{ n: string }];
  console.log(`Active kits still missing a variant after backfill: ${remaining[0]?.n ?? "?"}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
