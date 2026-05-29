/* eslint-disable no-console */
/**
 * 5-second connectivity probe.
 * Verifies API key works without touching any data.
 *
 *   npx tsx scripts/migrate-from-erp/00-probe.ts
 */

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

const BASE = process.env.ERP_BASE_URL;
const KEY = process.env.ERP_API_KEY;
const SECRET = process.env.ERP_API_SECRET;

if (!BASE || !KEY || !SECRET) {
  console.error("✗ Missing ERP_BASE_URL / ERP_API_KEY / ERP_API_SECRET in .env.local");
  process.exit(1);
}

const headers = {
  Authorization: `token ${KEY}:${SECRET}`,
};

async function probe(path: string, label: string) {
  const start = Date.now();
  try {
    const r = await fetch(`${BASE}${path}`, { headers });
    const ms = Date.now() - start;
    const txt = await r.text();
    if (!r.ok) {
      console.log(`  ✗ ${label} → ${r.status} (${ms}ms): ${txt.slice(0, 200)}`);
      return null;
    }
    const json = JSON.parse(txt);
    console.log(`  ✓ ${label} → ${r.status} (${ms}ms)`);
    return json;
  } catch (e) {
    const ms = Date.now() - start;
    console.log(`  ✗ ${label} → fetch failed (${ms}ms): ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

async function main() {
  console.log(`\nProbing ${BASE}\n`);

  // 1. Auth check — who am I logged in as?
  const me = await probe("/api/method/frappe.auth.get_logged_user", "auth check");
  if (!me) {
    console.error("\n  Auth failed. Verify ERP_API_KEY and ERP_API_SECRET in .env.local.\n");
    process.exit(1);
  }

  // 2. Item count check
  const items = await probe(
    "/api/resource/Item?fields=%5B%22name%22%5D&limit_page_length=1",
    "item read (1 row)"
  );
  if (!items) process.exit(1);

  // 3. Customer count check
  await probe(
    "/api/resource/Customer?fields=%5B%22name%22%5D&limit_page_length=1",
    "customer read (1 row)"
  );

  // 4. Sales Order count check
  await probe(
    '/api/resource/Sales Order?fields=%5B%22name%22%5D&filters=%5B%5B%22order_type%22%2C%22%3D%22%2C%22Shopping Cart%22%5D%5D&limit_page_length=1',
    "sales order read (1 row)"
  );

  // 5. Total counts (single SQL via Frappe's count helper)
  const cnt = await probe(
    '/api/method/frappe.client.get_count?doctype=Item',
    "item total count"
  );
  if (cnt) {
    console.log(`     Item total: ${cnt.message ?? cnt}`);
  }

  console.log(`\n  ✓ Connectivity good. Ready for migration.\n`);
  process.exit(0);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(2);
});
