/**
 * One-time: insert ops-supplied magic-box component picks (size + house colour)
 * onto `order_items.bundle_selections` for orders that were paid+delivered with
 * NULL selections — the "truly lost" tail of the 2026-07-03 cart-race RCA, where
 * neither audit `sales_order_sub_items` nor `packing_unit_lines` held any record.
 *
 * The sheet is the ONLY source for these, so nothing here is inferred: every row
 * must resolve to exactly one active product_variant or the script aborts. The
 * `attributes` array is read back from `product_variant_attributes` rather than
 * hardcoded, so the written shape is identical to a native configurator pick.
 *
 * Backs up prior values to scratch.mb_manual_bsel_backup, then (unless --no-emit)
 * awaits an order.updated emit per order so audit receives the sub-items.
 *
 *   DATABASE_URL=... npx tsx --conditions=react-server \
 *     scripts/insert-missing-magicbox-selections.ts [--apply] [--no-emit]
 */
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { emitOrderEvent } from "@/lib/erp-bridge";

type Row = {
  comp: string;
  qty: number;
  size: string;
  colour?: string;
};

const SHEET: Record<string, Row[]> = {
  // Nihan Gowda N — WM JK Magic Box Boys Grade 1 (sheet 2026-07-24).
  // Sheet said Socks/Sports Socks "3" → 3XL (socks have no numeric sizes),
  // same shorthand as 28550's "4" → 4XL. Half pants "24" → 24B (ops).
  "SAL-ORD-2026-27633": [
    { comp: "WM JK Mint Polo", qty: 2, size: "32" },
    { comp: "WM JK Half Pants", qty: 2, size: "24B" },
    { comp: "WM JK Sports Polo", qty: 1, size: "32", colour: "Blue" },
    { comp: "WM JK Sports Track", qty: 1, size: "28", colour: "Blue" },
    { comp: "WM JK Belt", qty: 1, size: "M" },
    { comp: "WM JK Regular Socks", qty: 2, size: "3XL" },
    { comp: "WM JK Sports Socks", qty: 1, size: "3XL", colour: "Blue" },
    { comp: "WM JK Shoes", qty: 1, size: "1UK" },
    { comp: "WM JK Caps", qty: 1, size: "2" },
    { comp: "WM JK Hoodie", qty: 1, size: "34" },
    { comp: "WM JK Pri Bag", qty: 1, size: "Standard" },
  ],
  // Charith Sai B — WM JK Magic Box Boys Grade 6 (sheet 2026-07-24).
  // Sheet said Socks/Sports Socks "4"; neither product has numeric sizes
  // (XS–4XL only). Ops confirmed 4XL for both.
  "SAL-ORD-2026-28550": [
    { comp: "WM JK Mint Polo", qty: 2, size: "36" },
    { comp: "WM JK Boys Pant", qty: 2, size: "24" },
    { comp: "WM JK Sports Polo", qty: 1, size: "36", colour: "Yellow" },
    { comp: "WM JK Sports Track", qty: 1, size: "34", colour: "Yellow" },
    { comp: "WM JK Belt", qty: 1, size: "M" },
    { comp: "WM JK Regular Socks", qty: 2, size: "4XL" },
    { comp: "WM JK Sports Socks", qty: 1, size: "4XL", colour: "Yellow" },
    { comp: "WM JK Shoes", qty: 1, size: "6UK" },
    { comp: "WM JK Caps", qty: 1, size: "3" },
    { comp: "WM JK Hoodie", qty: 1, size: "40" },
    { comp: "WM JK Secondary Bag", qty: 1, size: "L" },
  ],
  "SAL-ORD-2026-27393": [
    { comp: "WM JK Mint Polo", qty: 2, size: "32" },
    { comp: "WM JK Sports Polo", qty: 1, size: "32", colour: "Yellow" },
    { comp: "WM JK Half Pants", qty: 2, size: "22B" },
    { comp: "WM JK Sports Track", qty: 1, size: "26", colour: "Yellow" },
    { comp: "WM JK Regular Socks", qty: 2, size: "M" },
    { comp: "WM JK Sports Socks", qty: 1, size: "M", colour: "Yellow" },
    { comp: "WM JK Belt", qty: 1, size: "S" },
    { comp: "WM JK Caps", qty: 1, size: "2" },
    { comp: "WM JK Hoodie", qty: 1, size: "32" },
    { comp: "WM JK Pri Bag", qty: 1, size: "Standard" },
    { comp: "WM JK Shoes", qty: 1, size: "12S" },
  ],
  "SAL-ORD-2026-30648": [
    { comp: "WM JK Maroon Polo", qty: 2, size: "42" },
    { comp: "WM JK Sports Polo", qty: 1, size: "44", colour: "Red" },
    { comp: "WM JK Girls Pant", qty: 2, size: "36" },
    { comp: "WM JK Sports Track", qty: 1, size: "46", colour: "Red" },
    { comp: "WM JK Regular Socks", qty: 2, size: "3XL" },
    { comp: "WM JK Sports Socks", qty: 1, size: "3XL", colour: "Red" },
    { comp: "WM JK Belt", qty: 1, size: "L" },
    // Sheet said "L"; WM JK Caps has no letter sizes (only 1-4).
    // Ops confirmed size 3.
    { comp: "WM JK Caps", qty: 1, size: "3" },
    { comp: "WM JK Hoodie", qty: 1, size: "54" },
    { comp: "WM JK Secondary Bag", qty: 1, size: "L" },
    { comp: "WM JK Shoes", qty: 1, size: "7UK" },
  ],

  // ── 2026-07-30 sheet: SAS BP / SAS KS / TSUS ────────────────────────────
  // NOTE: `colour` must be the EXACT product_attribute_values.value, which for
  // these schools is the HOUSE name, not a plain colour (unlike WM JK). Verified
  // per product — the naming is inconsistent even between SAS BP and SAS KS:
  //   SAS BP SPORTS POLO T-SHIRT → "Ruby Spartans - RED" / "Sapphire knights - BLUE"
  //                                "Emarald Gladiators- Green" / "Topaz Vikings- YELLOW"
  //   SAS KS Sports T-shirt      → "Ruby Spartans - (Red)" / "Sapphire Knights - (BLUE)"
  //                                "Emarald Gladiators- (Green)" / "Topaz Vikings - (Yellow)"
  //   TSUS Sports Polo           → "Abhay (RED)" / "Dhairya (Blue)"
  //                                "Lakshay (GREEN)" / "Nishchay (YELLOW)"
  //   SAS BP/KS Sports Socks, Sports Track, Sports Pant → plain Red/Blue/Green/Yellow
  // SKU suffixes confirm the A=Red B=Blue C=Green D=Yellow map also holds here.

  // Dhanavath Haricharan Naik — SAS BP GRADE 10 MAGIC BOX BOYS.
  // Sheet said Sports Socks "4XL" but that product stops at 3XL (Regular Socks
  // does have 4XL). Ops confirmed 3XL, the largest available.
  "SAL-ORD-2026-32331": [
    { comp: "SAS BP Shirt", qty: 2, size: "44" },
    { comp: "SAS BP SPORTS POLO T-SHIRT", qty: 1, size: "46", colour: "Ruby Spartans - RED" },
    { comp: "SAS BP Sec Full Pants", qty: 2, size: "32" },
    { comp: "SAS BP Sports Track", qty: 1, size: "40", colour: "Red" },
    { comp: "SAS BP Regular Socks", qty: 2, size: "4XL" },
    { comp: "SAS BP Sports Socks", qty: 1, size: "3XL", colour: "Red" },
    { comp: "SAS BP Belt", qty: 1, size: "XL" },
    { comp: "SAS BP Caps", qty: 1, size: "4" },
    { comp: "SAS BP Hoodies", qty: 1, size: "46" },
    { comp: "SAS BP Sec Bag", qty: 1, size: "Standard" },
    { comp: "SAS BP Shoes", qty: 1, size: "11UK" },
  ],

  // Arayana Kumar — SAS KS GRADE 2 MAGIC BOX GIRLS. Every sheet size existed.
  "SAL-ORD-2026-35316": [
    { comp: "SAS KS Frock", qty: 2, size: "34" },
    { comp: "SAS KS Sports T-shirt", qty: 1, size: "36", colour: "Emarald Gladiators- (Green)" },
    { comp: "SAS KS Bloomers", qty: 1, size: "75" },
    { comp: "SAS KS Sports Pant", qty: 1, size: "30", colour: "Green" },
    { comp: "SAS KS Regular Socks", qty: 2, size: "L" },
    { comp: "SAS KS Sports Socks", qty: 1, size: "L", colour: "Green" },
    { comp: "SAS KS CAPS", qty: 1, size: "3" },
    { comp: "SAS KS Hoodie", qty: 1, size: "38" },
    { comp: "SAS KS Primary Bag", qty: 1, size: "Standard" },
    { comp: "SAS KS Shoes", qty: 1, size: "2UK" },
  ],

  // TISHA — TSUS MagicBox Unisex Grade Nursery.
  // Sheet said White Socks "1" but the product is letter-sized only (XS-4XL).
  // Ops confirmed XS, the smallest (consistent with Shoes 1UK / Polo 24).
  "SAL-ORD-2026-36874": [
    { comp: "Sports Polo", qty: 2, size: "24", colour: "Nishchay (YELLOW)" },
    { comp: "Navy Halfpants", qty: 2, size: "16B" },
    { comp: "TSUS White Socks", qty: 3, size: "XS" },
    { comp: "Navy Belt", qty: 1, size: "S" },
    { comp: "Navy and Red Bag S", qty: 1, size: "Standard" },
    { comp: "Shoes", qty: 1, size: "1UK" },
  ],

  // NAMAN — TSUS MagicBox Boys Grade 11.
  // Sheet listed Track Pant as "Blue", but TSUS Track Pant has a single colour
  // (NAVY) — the house colour is not a variant axis for it, so no colour filter
  // (size 42 alone resolves to exactly one variant).
  "SAL-ORD-2026-37402": [
    { comp: "Stripe Shirt", qty: 2, size: "44" },
    { comp: "Sports Polo", qty: 1, size: "46", colour: "Dhairya (Blue)" },
    { comp: "Boys Pant", qty: 2, size: "30" },
    { comp: "Track Pant", qty: 1, size: "42" },
    { comp: "White Socks", qty: 3, size: "3XL" },
    { comp: "Navy Belt", qty: 1, size: "L" },
    { comp: "Secondary Bag L", qty: 1, size: "Standard" },
    { comp: "Shoes", qty: 1, size: "8UK" },
  ],

  // Vihaan Reddy Kantham — SAS BP GRADE 11 MAGIC BOX BOYS (sheet 2026-07-30).
  // Every sheet size existed as-is; no ops substitutions needed. Note the G11
  // box uses DIFFERENT components from the G10 one: "SAS BP Sr Secondary Belt"
  // (not "SAS BP Belt") and "SAS BP Maroon T-Shirt" / "SAS BP Boys Pants".
  "SAL-ORD-2026-37885": [
    { comp: "SAS BP Maroon T-Shirt", qty: 2, size: "38" },
    { comp: "SAS BP SPORTS POLO T-SHIRT", qty: 1, size: "38", colour: "Emarald Gladiators- Green" },
    { comp: "SAS BP Boys Pants", qty: 2, size: "30" },
    { comp: "SAS BP Sports Track", qty: 1, size: "30", colour: "Green" },
    { comp: "SAS BP Regular Socks", qty: 2, size: "L" },
    { comp: "SAS BP Sports Socks", qty: 1, size: "L", colour: "Green" },
    { comp: "SAS BP Sr Secondary Belt", qty: 1, size: "L" },
    { comp: "SAS BP Caps", qty: 1, size: "3" },
    { comp: "SAS BP Hoodies", qty: 1, size: "40" },
    { comp: "SAS BP Sec Bag", qty: 1, size: "Standard" },
    { comp: "SAS BP Shoes", qty: 1, size: "10UK" },
  ],

  // M H Rishon Rubens — SAS BP GRADE 11 MAGIC BOX BOYS (sheet 2026-07-31).
  // Same box as 37885. Sheet said Caps "XL"; the product has only numeric sizes
  // 1-4, so ops confirmed 4 (largest), consistent with Belt XL / Shirt 48.
  // The sheet's "(Tie 12)" note against Shoes is ignored — no Tie component in
  // this box. Every other size existed as-is.
  "SAL-ORD-2026-37506": [
    { comp: "SAS BP Maroon T-Shirt", qty: 2, size: "48" },
    { comp: "SAS BP SPORTS POLO T-SHIRT", qty: 1, size: "48", colour: "Ruby Spartans - RED" },
    { comp: "SAS BP Boys Pants", qty: 2, size: "32" },
    { comp: "SAS BP Sports Track", qty: 1, size: "42", colour: "Red" },
    { comp: "SAS BP Regular Socks", qty: 2, size: "3XL" },
    { comp: "SAS BP Sports Socks", qty: 1, size: "3XL", colour: "Red" },
    { comp: "SAS BP Sr Secondary Belt", qty: 1, size: "XL" },
    { comp: "SAS BP Caps", qty: 1, size: "4" },
    { comp: "SAS BP Hoodies", qty: 1, size: "46" },
    { comp: "SAS BP Sec Bag", qty: 1, size: "Standard" },
    { comp: "SAS BP Shoes", qty: 1, size: "10UK" },
  ],
};

// Bookkit is deliberately absent from every box here: the sheet did not carry a
// language choice and it is not recoverable from any system. A selection with
// an unresolvable variantId is silently dropped by erp-bridge (see the
// "could not resolve" continue), so writing a language-less line would leave
// inventre showing 12 components while audit received 11.

/**
 * Resolve a sheet row to exactly one active variant.
 *
 * `productId` is the component's product_id taken from the box's OWN definition
 * (bundle_components), never looked up by name: product names are not unique —
 * "Boys Pant" exists as both a kind='uniform' and a kind='book' product, so a
 * name-keyed lookup silently picks up the wrong one (or matches two).
 */
async function resolve(row: Row, productId: string) {
  const res: any = await db.execute(sql`
    SELECT v.id AS variant_id, v.product_id, p.name AS product_name, v.size, v.sku
    FROM products p
    JOIN product_variants v ON v.product_id = p.id
    WHERE p.id = ${productId} AND v.size = ${row.size} AND v.is_active
      AND (
        ${row.colour ?? null}::text IS NULL
        OR EXISTS (
          SELECT 1 FROM product_variant_attributes pva
          JOIN product_attribute_values av ON av.id = pva.value_id
          WHERE pva.variant_id = v.id AND av.value = ${row.colour ?? null}
        )
      )
  `);
  const rows = res.rows ?? res;
  if (rows.length !== 1) {
    throw new Error(
      `resolve failed for ${row.comp} size=${row.size} colour=${row.colour ?? "-"}: matched ${rows.length}`
    );
  }
  const v = rows[0];

  const attrRes: any = await db.execute(sql`
    SELECT a.name, av.value
    FROM product_variant_attributes pva
    JOIN product_attribute_values av ON av.id = pva.value_id
    JOIN product_attributes a ON a.id = av.attribute_id
    WHERE pva.variant_id = ${v.variant_id}
    ORDER BY a.name
  `);
  const attributes = (attrRes.rows ?? attrRes).map((r: any) => ({
    name: r.name,
    value: r.value,
  }));

  return {
    qty: row.qty,
    name: v.product_name,
    size: v.size,
    variantId: v.variant_id,
    attributes,
    componentProductId: v.product_id,
    manualEntryFromOps: true,
  };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const emit = !process.argv.includes("--no-emit");

  if (apply) {
    await db.execute(sql`CREATE SCHEMA IF NOT EXISTS scratch`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS scratch.mb_manual_bsel_backup (
        order_item_id uuid PRIMARY KEY,
        order_number text,
        old_bsel jsonb,
        backed_up_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  for (const [orderNo, rows] of Object.entries(SHEET)) {
    const oRes: any = await db.execute(sql`
      SELECT o.id AS order_id, oi.id AS item_id, oi.name_snapshot,
             oi.bundle_selections, p.id AS box_product_id
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      JOIN product_variants v ON v.id = oi.variant_id
      JOIN products p ON p.id = v.product_id
      WHERE o.order_number = ${orderNo} AND p.kind = 'magic_box'
    `);
    const items = oRes.rows ?? oRes;
    if (items.length !== 1) {
      throw new Error(`${orderNo}: expected 1 magic-box line, got ${items.length}`);
    }
    const item = items[0];
    if (item.bundle_selections != null) {
      console.log(`${orderNo}: already has selections — SKIPPING (no overwrite)`);
      continue;
    }

    // The box's own definition is the authority for which components exist and
    // how many of each. A sheet row naming something not in this box, or giving
    // a qty that disagrees with the definition, is a sheet error — abort.
    const cRes: any = await db.execute(sql`
      SELECT cp.name, cp.id AS product_id, cp.kind::text AS kind, bc.qty
      FROM product_bundles pb
      JOIN bundle_components bc ON bc.bundle_id = pb.id
      JOIN products cp ON cp.id = bc.product_id
      WHERE pb.product_id = ${item.box_product_id}
    `);
    const defs = new Map<string, { product_id: string; qty: number; kind: string }>();
    for (const c of cRes.rows ?? cRes) {
      if (defs.has(c.name)) throw new Error(`${orderNo}: duplicate component name "${c.name}" in box def`);
      defs.set(c.name, { product_id: c.product_id, qty: Number(c.qty), kind: c.kind });
    }

    const sels = [];
    for (const r of rows) {
      const def = defs.get(r.comp);
      if (!def) {
        throw new Error(
          `${orderNo}: "${r.comp}" is not a component of this box. Defined: ${[...defs.keys()].join(", ")}`
        );
      }
      if (def.qty !== r.qty) {
        throw new Error(
          `${orderNo}: qty mismatch for "${r.comp}" — sheet says ${r.qty}, box definition says ${def.qty}`
        );
      }
      sels.push(await resolve(r, def.product_id));
    }
    sels.sort((a, b) => a.name.localeCompare(b.name));

    // Report what the sheet did NOT cover, so a silent short-fill is impossible
    // to miss. Bookkits are expected here (deliberately excluded).
    const missing = [...defs.entries()].filter(([n]) => !rows.some((r) => r.comp === n));
    for (const [name, d] of missing) {
      console.log(`   ⚠ not in sheet, omitted: ${name} (kind=${d.kind}, qty=${d.qty})`);
    }

    console.log(`\n${orderNo} — ${item.name_snapshot} → ${sels.length} components`);
    for (const s of sels) {
      const col = s.attributes.map((a: any) => a.value).join(" · ");
      console.log(`   ${s.qty} × ${s.name}  [${s.size}]  ${col}`);
    }

    if (!apply) continue;

    await db.execute(sql`
      INSERT INTO scratch.mb_manual_bsel_backup (order_item_id, order_number, old_bsel)
      VALUES (${item.item_id}, ${orderNo}, ${item.bundle_selections})
      ON CONFLICT (order_item_id) DO NOTHING
    `);
    await db.execute(sql`
      UPDATE order_items SET bundle_selections = ${JSON.stringify(sels)}::jsonb
      WHERE id = ${item.item_id} AND bundle_selections IS NULL
    `);
    console.log(`   ✓ written`);

    if (emit) {
      // MUST await — a floating emit is lost when the process exits.
      await emitOrderEvent(item.order_id, "order.updated");
      console.log(`   ✓ order.updated emitted`);
    }
  }

  if (!apply) console.log("\nDRY RUN — re-run with --apply to write.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
