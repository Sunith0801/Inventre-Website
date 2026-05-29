/**
 * Import ERPNext Sales Orders (company "Inventre Edu Services Pvt Ltd",
 * status To Deliver / To Deliver and Bill) into the production DB so
 * /admin/orders can show the live fulfilment queue.
 *
 *   npx tsx scripts/import-erp-sales-orders.ts
 *
 * Refreshes the `erp_sales_orders` table (idempotent).
 */
import postgres from "postgres";

const ERP = "https://erp.inventre.in";
const TOKEN = "368aba31f063d55:3f45e93d2419d2a";
const FILTERS = JSON.stringify([
  ["company", "like", "%Inventre Edu Services Pvt Ltd%"],
  ["status", "in", ["To Deliver", "To Deliver and Bill"]],
]);
const sql = postgres(
  "postgres://inventre:inventre_prod@161.97.132.211:55433/inventre",
  { prepare: false }
);

async function fetchAll(fields: string[]) {
  const PAGE = 500;
  const out: any[] = [];
  for (let start = 0; ; start += PAGE) {
    const qs = new URLSearchParams({
      fields: JSON.stringify(fields),
      filters: FILTERS,
      limit_start: String(start),
      limit_page_length: String(PAGE),
    });
    const res = await fetch(`${ERP}/api/resource/Sales%20Order?${qs}`, {
      headers: { Authorization: `token ${TOKEN}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = (await res.json()).data as any[];
    out.push(...rows);
    process.stdout.write(`\r  fetched ${out.length}`);
    if (rows.length < PAGE) break;
  }
  process.stdout.write("\n");
  return out;
}

async function main() {
  console.log("Importing ERPNext Sales Orders (To Deliver / To Deliver and Bill)…");
  const rows = await fetchAll([
    "name", "customer", "transaction_date", "delivery_date",
    "status", "grand_total", "per_delivered", "per_billed",
  ]);

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS erp_sales_orders (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      erp_name text UNIQUE,
      customer text,
      transaction_date date,
      delivery_date date,
      status text,
      grand_total numeric NOT NULL DEFAULT 0,
      per_delivered numeric NOT NULL DEFAULT 0,
      per_billed numeric NOT NULL DEFAULT 0
    )`);
  await sql`TRUNCATE erp_sales_orders`;

  const vals = rows.map((r) => ({
    erp_name: r.name,
    customer: r.customer || null,
    transaction_date: r.transaction_date || null,
    delivery_date: r.delivery_date || null,
    status: r.status || null,
    grand_total: Number(r.grand_total) || 0,
    per_delivered: Number(r.per_delivered) || 0,
    per_billed: Number(r.per_billed) || 0,
  }));
  for (let i = 0; i < vals.length; i += 500) {
    await sql`INSERT INTO erp_sales_orders ${sql(
      vals.slice(i, i + 500),
      "erp_name", "customer", "transaction_date", "delivery_date",
      "status", "grand_total", "per_delivered", "per_billed"
    )} ON CONFLICT (erp_name) DO NOTHING`;
  }
  const [{ n }] = await sql`SELECT count(*)::int n FROM erp_sales_orders`;
  console.log(`Done — ${n} sales orders loaded.`);
  await sql.end();
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
