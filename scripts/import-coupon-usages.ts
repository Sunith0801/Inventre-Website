/**
 * Pull every ERPNext Sales Order whose `custom_cart_coupon_code` is set into
 * `website_cart_coupon_usages` so the admin Discounts pages can render
 * Total Usage / Total Discount Given / linked-orders table directly from
 * the local DB (no live ERPNext round-trips at render time).
 *
 *   npx tsx scripts/import-coupon-usages.ts
 *
 * Idempotent: upsert on erp_sales_order. Pairs with
 * scripts/import-website-cart-coupons.ts — run that first so coupons exist.
 */
import postgres from "postgres";

const ERP = process.env.ERP_BASE_URL ?? "https://erp.inventre.in";
const TOKEN =
  process.env.ERP_API_TOKEN ??
  `${process.env.ERP_API_KEY ?? "368aba31f063d55"}:${process.env.ERP_API_SECRET ?? "3f45e93d2419d2a"}`;
const DB_URL =
  process.env.DATABASE_DIRECT_URL ??
  "postgres://inventre:inventre_prod@161.97.132.211:55433/inventre";

const sql = postgres(DB_URL, { prepare: false });

type SalesOrder = {
  name: string;
  customer_name: string | null;
  transaction_date: string | null;
  grand_total: number | null;
  discount_amount: number | null;
  custom_cart_coupon_code: string | null;
};

async function fetchAll(): Promise<SalesOrder[]> {
  const PAGE = 500;
  const fields = JSON.stringify([
    "name",
    "customer_name",
    "transaction_date",
    "grand_total",
    "discount_amount",
    "custom_cart_coupon_code",
  ]);
  const filters = JSON.stringify([
    ["custom_cart_coupon_code", "is", "set"],
    ["docstatus", "!=", 2], // skip cancelled
  ]);
  const out: SalesOrder[] = [];
  for (let start = 0; ; start += PAGE) {
    const qs = new URLSearchParams({
      fields,
      filters,
      limit_start: String(start),
      limit_page_length: String(PAGE),
    });
    const url = `${ERP}/api/resource/Sales%20Order?${qs}`;
    const res = await fetch(url, {
      headers: { Authorization: `token ${TOKEN}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching Sales Order`);
    const rows = (await res.json()).data as SalesOrder[];
    out.push(...rows);
    process.stdout.write(`\r  fetched ${out.length}`);
    if (rows.length < PAGE) break;
  }
  process.stdout.write("\n");
  return out;
}

async function main() {
  console.log(`▶ Pulling Sales Orders with custom_cart_coupon_code from ${ERP}…`);
  const orders = await fetchAll();
  console.log(`  ${orders.length} rows`);

  console.log("▶ Indexing local coupons by LOWER(coupon_code)…");
  const couponMap = new Map<string, string>();
  for (const r of await sql<
    { id: string; coupon_code: string }[]
  >`SELECT id, coupon_code FROM website_cart_coupons`) {
    couponMap.set(r.coupon_code.toLowerCase(), r.id);
  }
  console.log(`  ${couponMap.size} coupons indexed`);

  console.log("▶ Upserting usages…");
  let inserted = 0;
  let updated = 0;
  let unmatched = 0;
  for (const o of orders) {
    const code = (o.custom_cart_coupon_code ?? "").trim();
    if (!code) continue;
    const couponId = couponMap.get(code.toLowerCase());
    if (!couponId) {
      unmatched++;
      continue;
    }
    const discountPaise = Math.round(Number(o.discount_amount ?? 0) * 100);
    const orderAmtPaise = Math.round(Number(o.grand_total ?? 0) * 100);
    const r = await sql<{ inserted: boolean }[]>`
      INSERT INTO website_cart_coupon_usages (
        coupon_id, amount_saved,
        erp_sales_order, customer_name, order_amount, transaction_date,
        created_at
      ) VALUES (
        ${couponId}, ${discountPaise},
        ${o.name}, ${o.customer_name}, ${orderAmtPaise}, ${o.transaction_date},
        NOW()
      )
      ON CONFLICT (erp_sales_order) WHERE erp_sales_order IS NOT NULL DO UPDATE SET
        coupon_id        = EXCLUDED.coupon_id,
        amount_saved     = EXCLUDED.amount_saved,
        customer_name    = EXCLUDED.customer_name,
        order_amount     = EXCLUDED.order_amount,
        transaction_date = EXCLUDED.transaction_date
      RETURNING (xmax = 0) AS inserted`;
    if (r[0]?.inserted) inserted++;
    else updated++;
  }
  console.log(`  ✓ inserted=${inserted} updated=${updated}`);
  console.log(`  ↪ orders whose coupon code isn't in website_cart_coupons: ${unmatched}`);

  // Refresh the denormalised used_count on the coupons themselves so the
  // list page's "Uses" column matches without an extra subquery on render.
  console.log("▶ Refreshing website_cart_coupons.used_count…");
  await sql`
    UPDATE website_cart_coupons c SET used_count = sub.n FROM (
      SELECT coupon_id, COUNT(*)::int AS n
      FROM website_cart_coupon_usages
      GROUP BY coupon_id
    ) sub WHERE c.id = sub.coupon_id`;
  await sql`
    UPDATE website_cart_coupons SET used_count = 0
    WHERE id NOT IN (SELECT DISTINCT coupon_id FROM website_cart_coupon_usages)`;

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
