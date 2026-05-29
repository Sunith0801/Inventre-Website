/* eslint-disable no-console */
/**
 * End-to-end catalog audit across every school and grade.
 *
 * Sections:
 *   A. Bookkits / Booksets / Magic Boxes with empty BOM
 *      (visible on PDP as "Kit contents are being updated").
 *   B. Variants flagged inactive on active products
 *      (cart drops them silently — see lib/repos/cart.ts:217-222).
 *   C. Per-school price anomalies on the same variant
 *      (large delta between Standard Selling and per-school override).
 *   D. Active products with NO grade tag (orphaned from every student).
 *
 * Read-only. Run with no flags.
 *   tsx scripts/audit-catalog-health.ts
 */

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { db } from "../db/client";
import { sql } from "drizzle-orm";

type Row = Record<string, unknown>;
function rowsOf(r: unknown): Row[] {
  return (Array.isArray(r) ? r : (r as { rows?: Row[] }).rows ?? []) as Row[];
}

async function main() {
  // ── A. Empty BOMs ─────────────────────────────────────────────────
  console.log("\n=== A. Bundles missing BOM contents ===");
  const emptyA = rowsOf(
    await db.execute(sql`
      SELECT sc.name AS school, p.kind, p.bundle_level, p.name AS product, p.id
        FROM products p
        LEFT JOIN product_school ps ON ps.product_id = p.id
        LEFT JOIN schools sc ON sc.id = ps.school_id
       WHERE p.status='active'
         AND (p.kind = 'kit' OR p.kind = 'magic_box' OR p.bundle_level IN ('bookkit','magic_box','sub_bundle'))
         AND NOT EXISTS (
           SELECT 1 FROM product_bundles pb
            JOIN bundle_components bc ON bc.bundle_id = pb.id
            WHERE pb.product_id = p.id
         )
       ORDER BY sc.name, p.name
    `)
  );
  console.log(`  ${emptyA.length} active bundles have no BOM components.`);
  const bySchool = new Map<string, string[]>();
  for (const r of emptyA) {
    const arr = bySchool.get((r.school as string) ?? "(unlinked)") ?? [];
    arr.push(r.product as string);
    bySchool.set((r.school as string) ?? "(unlinked)", arr);
  }
  for (const [school, items] of bySchool) {
    console.log(`  • ${school}: ${items.length}`);
    for (const it of items.slice(0, 5)) console.log(`      - ${it}`);
    if (items.length > 5) console.log(`      … ${items.length - 5} more`);
  }

  // ── B. Inactive variants on active products ──────────────────────
  console.log("\n=== B. Inactive variants on active products ===");
  const inactiveVariants = rowsOf(
    await db.execute(sql`
      SELECT sc.name AS school, p.name AS product, count(*) AS num_inactive
        FROM product_variants pv
        JOIN products p ON p.id = pv.product_id AND p.status='active'
        LEFT JOIN product_school ps ON ps.product_id = p.id
        LEFT JOIN schools sc ON sc.id = ps.school_id
       WHERE pv.is_active = false
       GROUP BY 1,2 ORDER BY num_inactive DESC LIMIT 30
    `)
  );
  console.log(`  ${inactiveVariants.length} active products carry inactive variants (top 30 by count).`);
  for (const r of inactiveVariants.slice(0, 15)) {
    console.log(`  • ${r.school ?? "(unlinked)"} | ${r.product} — ${r.num_inactive} inactive variants`);
  }

  // ── C. Per-school price anomalies ────────────────────────────────
  console.log("\n=== C. Per-school price overrides that differ significantly ===");
  const priceAnomalies = rowsOf(
    await db.execute(sql`
      WITH base AS (
        SELECT ip.variant_id, ip.price::int AS price
          FROM item_prices ip
          JOIN price_lists pl ON pl.id = ip.price_list_id
         WHERE pl.name = 'Standard Selling' AND ip.school_id IS NULL
      ),
      overrides AS (
        SELECT ip.variant_id, ip.school_id, ip.price::int AS price
          FROM item_prices ip
          JOIN price_lists pl ON pl.id = ip.price_list_id
         WHERE pl.name = 'Standard Selling' AND ip.school_id IS NOT NULL
      )
      SELECT sc.name AS school, p.name AS product, pv.size,
             base.price AS std_price,
             ov.price AS school_price,
             (ov.price - base.price) AS delta
        FROM overrides ov
        JOIN base ON base.variant_id = ov.variant_id
        JOIN product_variants pv ON pv.id = ov.variant_id
        JOIN products p ON p.id = pv.product_id AND p.status='active'
        JOIN schools sc ON sc.id = ov.school_id
       WHERE abs(ov.price - base.price) > base.price * 0.5  -- >50% delta
       ORDER BY abs(ov.price - base.price) DESC LIMIT 30
    `)
  );
  console.log(`  ${priceAnomalies.length} (variant × school) overrides differ >50% from Standard.`);
  for (const r of priceAnomalies.slice(0, 15)) {
    console.log(
      `  • ${r.school} | ${r.product} (${r.size}): std=${r.std_price} school=${r.school_price} Δ=${r.delta}`
    );
  }

  // ── D. Active products with no grade tags ────────────────────────
  console.log("\n=== D. Active shoppable products with no product_grades tags ===");
  const orphans = rowsOf(
    await db.execute(sql`
      SELECT sc.name AS school, p.name, p.kind::text AS kind
        FROM products p
        LEFT JOIN product_school ps ON ps.product_id = p.id
        LEFT JOIN schools sc ON sc.id = ps.school_id
       WHERE p.status='active'
         AND p.kind::text NOT IN ('magic_box','book','sub_bundle')
         AND p.is_variant_item=false
         AND NOT EXISTS (SELECT 1 FROM product_grades pg WHERE pg.product_id = p.id)
       ORDER BY sc.name, p.name LIMIT 40
    `)
  );
  console.log(`  ${orphans.length} active products are visible to NO student (no grade tags).`);
  for (const r of orphans.slice(0, 20)) {
    console.log(`  • ${r.school ?? "(unlinked)"} | ${r.name} [${r.kind}]`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
