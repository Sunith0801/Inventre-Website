/**
 * One-off: apply the Winmore Magic Box price list (supplied by the school,
 * 2026-08-28) to the boxes whose price was missing or stale.
 *
 * Ladder (identical at both campuses): Nursery/LKG/UKG ₹14,500 ·
 * Grade 1–3 ₹20,000 · Grade 4–11 ₹22,000. Grade 12 was absent from the
 * supplied list; the user confirmed ₹22,000 on 2026-08-28.
 *
 * A box's price resolves item_prices → product_school.override_price →
 * products.base_price, so both item_prices and base_price are written and
 * kept in agreement.
 */
import postgres from "postgres";

const PRICE_LIST = "0502cdd2-2c6b-4741-a039-05ddaefc3355"; // Standard Selling
const TARGETS: { name: string; price: number }[] = [
  // Genuinely free — no item_prices row, base_price 0.
  { name: "WM JK Magic Box Girls Grade 11", price: 2_200_000 },
  { name: "WM JK Magic Box Boys Grade 12", price: 2_200_000 },
  { name: "WM JK Magic Box Girls Grade 12", price: 2_200_000 },
  // Correct on item_prices already; base_price stale at 0.
  { name: "WM WF Magic box Boys Grade 9", price: 2_200_000 },
  { name: "WM WF Magic box Girls Grade 9", price: 2_200_000 },
  { name: "WM WF Magic box Boys Grade 10", price: 2_200_000 },
  { name: "WM WF Magic box Girls Grade 10", price: 2_200_000 },
];

const APPLY = process.argv.includes("--apply");

async function main() {
  const sql = postgres(process.env.DBU!, { prepare: false });
  for (const t of TARGETS) {
    const [p] = await sql`
      SELECT id, base_price FROM products
       WHERE name = ${t.name} AND kind = 'magic_box' AND status = 'active'`;
    if (!p) { console.log(`MISS  ${t.name}`); continue; }
    const variants = await sql`
      SELECT v.id, v.sku, ip.id AS price_id, ip.price
        FROM product_variants v
        LEFT JOIN item_prices ip
          ON ip.variant_id = v.id AND ip.price_list_id = ${PRICE_LIST}
         AND ip.school_id IS NULL
       WHERE v.product_id = ${p.id}`;
    console.log(`\n${t.name}`);
    console.log(`  base_price ${p.base_price} → ${t.price}`);
    for (const v of variants) {
      console.log(`  variant ${v.sku}: item_price ${v.price ?? "(none)"} → ${t.price}`);
    }
    if (!APPLY) continue;
    await sql.begin(async (tx) => {
      await tx`UPDATE products SET base_price = ${t.price} WHERE id = ${p.id}`;
      for (const v of variants) {
        if (v.price_id) {
          await tx`UPDATE item_prices SET price = ${t.price}, updated_at = now()
                    WHERE id = ${v.price_id}`;
        } else {
          await tx`INSERT INTO item_prices (variant_id, price_list_id, school_id, price)
                   VALUES (${v.id}, ${PRICE_LIST}, NULL, ${t.price})`;
        }
      }
    });
    console.log("  ✓ applied");
  }
  if (!APPLY) console.log("\nDRY RUN — re-run with --apply to write.");
  await sql.end();
}
main();
