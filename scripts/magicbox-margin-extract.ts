/**
 * One-off: dump Magic Box composition + per-item pricing vs box price for the
 * SAS / SMS / Winmore / TSUS campuses, grade-wise. Feeds the margin PDF.
 *
 * Item price = item_prices on the component's ACTIVE variants (school override
 * preferred, else global) — products.base_price is 0 for most uniforms.
 * Because a size ladder can be priced differently per size, each component
 * carries min / max / typical (modal) unit price.
 */
import postgres from "postgres";
import { writeFileSync } from "node:fs";

const SCHOOLS = ["SASBP", "SASKS", "SMSAW", "WMAJK", "WMAWF", "TSUSC"];

async function main() {
  const sql = postgres(process.env.DBU!, { prepare: false });

  const boxes = await sql<any[]>`
    SELECT p.id, p.name, p.item_code, p.base_price,
           s.school_code, s.name AS school_name, s.id AS school_id,
           pb.id AS bundle_id,
           (SELECT string_agg(g.grade, ', ' ORDER BY g.grade)
              FROM product_grades g WHERE g.product_id = p.id) AS grades,
           (SELECT url FROM product_images WHERE product_id = p.id
             ORDER BY is_primary DESC NULLS LAST, sort_order ASC LIMIT 1) AS img,
           -- cross-check: what this box has actually been charged at
           (SELECT max(oi.unit_price) FROM order_items oi
              JOIN product_variants v ON v.id = oi.variant_id
             WHERE v.product_id = p.id) AS last_charged,
           (SELECT count(*) FROM order_items oi
              JOIN product_variants v ON v.id = oi.variant_id
             WHERE v.product_id = p.id) AS times_ordered,
           -- How many of this box have actually been ordered. Cancelled
           -- orders excluded; qty_paid is the subset where money landed
           -- (an SMS box is 0 rupees but still settles as paid).
           (SELECT COALESCE(sum(oi.qty), 0) FROM order_items oi
              JOIN orders o ON o.id = oi.order_id
              JOIN product_variants v ON v.id = oi.variant_id
             WHERE v.product_id = p.id AND o.status <> 'cancelled') AS qty_ordered,
           (SELECT COALESCE(sum(oi.qty), 0) FROM order_items oi
              JOIN orders o ON o.id = oi.order_id
              JOIN product_variants v ON v.id = oi.variant_id
             WHERE v.product_id = p.id AND o.status <> 'cancelled'
               AND o.payment_status = 'paid') AS qty_paid,
           -- Effective price, resolved exactly as the cart does:
           -- item_prices (school row preferred) → product_school override → base_price
           (SELECT ip.price FROM item_prices ip
              JOIN product_variants v ON v.id = ip.variant_id
             WHERE v.product_id = p.id
               AND (ip.school_id = s.id OR ip.school_id IS NULL)
               AND (ip.valid_from IS NULL OR ip.valid_from <= now())
               AND (ip.valid_until IS NULL OR ip.valid_until >= now())
             ORDER BY (ip.school_id = s.id) DESC, ip.created_at DESC LIMIT 1) AS ip_price,
           ps.override_price AS override_price
      FROM products p
      JOIN product_school ps ON ps.product_id = p.id
      JOIN schools s ON s.id = ps.school_id
      LEFT JOIN product_bundles pb ON pb.product_id = p.id
     WHERE p.kind = 'magic_box' AND p.status = 'active'
       AND s.school_code IN ${sql(SCHOOLS)}
     ORDER BY s.school_code, p.name`;

  const out: any[] = [];
  for (const b of boxes) {
    const comps = await sql<any[]>`
      SELECT bc.qty, bc.is_optional, c.id AS product_id, c.name, c.kind::text AS kind,
             c.base_price,
             (SELECT url FROM product_images WHERE product_id = c.id
               ORDER BY is_primary DESC NULLS LAST, sort_order ASC LIMIT 1) AS img,
             (SELECT json_agg(v.sku) FROM product_variants v
               WHERE v.product_id = c.id AND v.is_active) AS skus,
             (SELECT json_agg(x.price ORDER BY x.price) FROM (
                SELECT DISTINCT ON (v.id) ip.price
                  FROM product_variants v
                  JOIN item_prices ip ON ip.variant_id = v.id
                 WHERE v.product_id = c.id AND v.is_active
                   AND (ip.school_id = ${b.school_id} OR ip.school_id IS NULL)
                   AND (ip.valid_from IS NULL OR ip.valid_from <= now())
                   AND (ip.valid_until IS NULL OR ip.valid_until >= now())
                 ORDER BY v.id, (ip.school_id = ${b.school_id}) DESC, ip.created_at DESC
              ) x) AS prices
        FROM bundle_components bc
        JOIN products c ON c.id = bc.product_id
       WHERE bc.bundle_id = ${b.bundle_id} AND bc.is_visible = true
         AND c.status <> 'archived'
       ORDER BY c.kind, c.name`;

    const items = comps.map((c) => {
      const all: number[] = c.prices ?? [];
      const prices = all.filter((n: number) => n > 0);
      const fallback = c.base_price > 0 ? [c.base_price] : [];
      const pool = prices.length ? prices : fallback;
      // Distinguish a real ₹0 (SMS bookkits are free) from no price on file.
      const priceState = pool.length ? "priced" : all.length ? "zero" : "none";
      let typical: number | null = null;
      if (pool.length) {
        const freq = new Map<number, number>();
        for (const p of pool) freq.set(p, (freq.get(p) ?? 0) + 1);
        typical = [...freq.entries()].sort((a, z) => z[1] - a[1] || a[0] - z[0])[0][0];
      }
      // Average across the sizes actually priced — this is the per-piece
      // price the report shows (a size ladder is often priced per size).
      const avg = pool.length
        ? Math.round(pool.reduce((a, b) => a + b, 0) / pool.length)
        : null;
      return {
        name: c.name, kind: c.kind, qty: c.qty, img: c.img, skus: c.skus ?? [],
        priced: pool.length,
        priceState,
        min: pool.length ? Math.min(...pool) : null,
        max: pool.length ? Math.max(...pool) : null,
        typical, avg,
      };
    });
    out.push({
      productId: b.id, school: b.school_code, schoolName: b.school_name,
      box: b.name, itemCode: b.item_code, grades: b.grades,
      boxPrice: b.ip_price ?? b.override_price ?? b.base_price,
      basePrice: b.base_price, lastCharged: b.last_charged, timesOrdered: Number(b.times_ordered),
      ordered: Number(b.qty_ordered), paid: Number(b.qty_paid),
      img: b.img, items,
    });
  }
  writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
  console.log(`${out.length} boxes → ${process.argv[2]}`);
  await sql.end();
}
main();
