/* eslint-disable no-console */
// One-off ad-hoc diff: which ERP parent items (pre-cutover, has_variants=1,
// disabled=0) are missing from local products.item_code. Read-only.
//
//   npx tsx scripts/migrate-from-erp/_cmp-items.ts

import { erpListPages } from "./_client";
import { db, shutdown, CUTOVER_ISO } from "./_db";
import { sql } from "drizzle-orm";

async function main() {
  const erpItems: { name: string; item_name: string; item_group: string; custom_school_name?: string }[] = [];
  for await (const page of erpListPages<any>("Item", {
    fields: ["name", "item_name", "item_group", "custom_school_name"],
    filters: [["has_variants", "=", 1], ["disabled", "=", 0]],
    pageSize: 100,
    cutoffIso: CUTOVER_ISO,
    cutoffField: "modified",
  })) {
    erpItems.push(...page);
  }

  const r: any = await db.execute(sql.raw(`SELECT item_code FROM products`));
  const localCodes = new Set((r?.rows ?? r).map((x: any) => x.item_code));

  const missing = erpItems.filter((i) => !localCodes.has(i.name));
  console.log(`\nERP parent items (≤ cutover): ${erpItems.length}`);
  console.log(`Local products with item_code: ${localCodes.size}`);
  console.log(`Missing locally:               ${missing.length}\n`);
  if (missing.length) {
    console.log(`First ${Math.min(20, missing.length)} missing items:`);
    missing.slice(0, 20).forEach((i) => {
      console.log(`  - ${i.name.padEnd(50)} | group=${i.item_group} | school=${i.custom_school_name ?? "—"}`);
    });
  }
  await shutdown();
}
main().catch(async (e) => { console.error(e); await shutdown(); process.exit(1); });
