/**
 * Import ERPNext "Website Customer" records into the production DB so
 * /admin/customers can show the website accounts.
 *
 *   npx tsx scripts/import-website-customers.ts
 *
 * Creates/refreshes the `website_customers` table (idempotent).
 */
import postgres from "postgres";

const ERP = "https://erp.inventre.in";
const TOKEN = "368aba31f063d55:3f45e93d2419d2a";
const sql = postgres(
  "postgres://inventre:inventre_prod@161.97.132.211:55433/inventre",
  { prepare: false }
);

async function fetchAll(doctype: string, fields: string[]) {
  const PAGE = 500;
  const out: any[] = [];
  for (let start = 0; ; start += PAGE) {
    const qs = new URLSearchParams({
      fields: JSON.stringify(fields),
      limit_start: String(start),
      limit_page_length: String(PAGE),
    });
    const res = await fetch(`${ERP}/api/resource/${encodeURIComponent(doctype)}?${qs}`, {
      headers: { Authorization: `token ${TOKEN}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${doctype}`);
    const rows = (await res.json()).data as any[];
    out.push(...rows);
    process.stdout.write(`\r  fetched ${out.length}`);
    if (rows.length < PAGE) break;
  }
  process.stdout.write("\n");
  return out;
}

async function main() {
  console.log("Importing ERPNext Website Customers…");
  const rows = await fetchAll("Website Customer", [
    "name", "user", "customer", "student",
    "whatsapp_message", "sms_alert", "email_alert", "order_updates",
  ]);

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS website_customers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      erp_name text UNIQUE,
      email text,
      erp_customer text,
      student text,
      whatsapp boolean NOT NULL DEFAULT false,
      sms boolean NOT NULL DEFAULT false,
      email_alert boolean NOT NULL DEFAULT false,
      order_updates boolean NOT NULL DEFAULT false
    )`);
  await sql`TRUNCATE website_customers`;

  const vals = rows.map((r) => ({
    erp_name: r.name,
    email: r.user || r.name || null,
    erp_customer: r.customer || null,
    student: r.student || null,
    whatsapp: r.whatsapp_message === 1,
    sms: r.sms_alert === 1,
    email_alert: r.email_alert === 1,
    order_updates: r.order_updates === 1,
  }));
  for (let i = 0; i < vals.length; i += 500) {
    await sql`INSERT INTO website_customers ${sql(
      vals.slice(i, i + 500),
      "erp_name", "email", "erp_customer", "student",
      "whatsapp", "sms", "email_alert", "order_updates"
    )} ON CONFLICT (erp_name) DO NOTHING`;
  }
  const [{ n }] = await sql`SELECT count(*)::int n FROM website_customers`;
  console.log(`Done — ${n} website customers loaded.`);
  await sql.end();
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
