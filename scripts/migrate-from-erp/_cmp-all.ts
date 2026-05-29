/* eslint-disable no-console */
// Read-only ERP-vs-local diff for variants, customers, orders.
//
//   npx tsx scripts/migrate-from-erp/_cmp-all.ts

import { erpListPages } from "./_client";
import { db, shutdown, CUTOVER_ISO } from "./_db";
import { sql } from "drizzle-orm";

async function main() {
  // ── Variants (Item where variant_of is set) ──
  console.log("\nFetching ERP variants (≤ cutover)…");
  const erpVariants: { name: string; item_name: string; variant_of: string }[] = [];
  for await (const page of erpListPages<any>("Item", {
    fields: ["name", "item_name", "variant_of"],
    filters: [["variant_of", "is", "set"], ["disabled", "=", 0]],
    pageSize: 200,
    cutoffIso: CUTOVER_ISO,
    cutoffField: "modified",
  })) erpVariants.push(...page);

  const r1: any = await db.execute(sql.raw(`SELECT sku FROM product_variants`));
  const localSkus = new Set((r1?.rows ?? r1).map((x: any) => x.sku));
  const missingV = erpVariants.filter((v) => !localSkus.has(v.name));
  console.log(`\n=== VARIANTS ===`);
  console.log(`  ERP (≤ cutover):  ${erpVariants.length}`);
  console.log(`  Local skus:       ${localSkus.size}`);
  console.log(`  Missing locally:  ${missingV.length}`);
  missingV.slice(0, 10).forEach((v) => console.log(`    - ${v.name.padEnd(40)} (parent=${v.variant_of}, name=${v.item_name})`));

  // ── Customers (by mobile_no normalized to last 10) ──
  console.log("\nFetching ERP customers (≤ cutover)…");
  const erpCustomers: { name: string; customer_name: string; mobile_no?: string }[] = [];
  for await (const page of erpListPages<any>("Customer", {
    fields: ["name", "customer_name", "mobile_no"],
    pageSize: 200,
    cutoffIso: CUTOVER_ISO,
    cutoffField: "modified",
  })) erpCustomers.push(...page);

  const r2: any = await db.execute(sql.raw(`SELECT phone FROM parents`));
  const localPhones = new Set((r2?.rows ?? r2).map((x: any) => x.phone));
  const norm = (p?: string | null) => {
    if (!p) return null;
    const d = p.replace(/\D/g, "");
    return d.length >= 10 ? d.slice(-10) : null;
  };
  const withPhone = erpCustomers.map((c) => ({ ...c, phone: norm(c.mobile_no) })).filter((c) => c.phone);
  const missingC = withPhone.filter((c) => !localPhones.has(c.phone!));
  console.log(`\n=== CUSTOMERS (with valid 10-digit phone) ===`);
  console.log(`  ERP total (≤ cutover):     ${erpCustomers.length}`);
  console.log(`  ERP with 10-digit phone:   ${withPhone.length}`);
  console.log(`  Local parents (any phone): ${localPhones.size}`);
  console.log(`  Missing locally:           ${missingC.length}`);
  missingC.slice(0, 10).forEach((c) => console.log(`    - ${c.phone}  (${c.customer_name})`));

  // ── Sales Orders (Shopping Cart, docstatus=1) ──
  console.log("\nFetching ERP sales orders (≤ cutover)…");
  const erpSOs: { name: string; customer: string; transaction_date: string; grand_total: number }[] = [];
  for await (const page of erpListPages<any>("Sales Order", {
    fields: ["name", "customer", "transaction_date", "grand_total"],
    filters: [["order_type", "=", "Shopping Cart"], ["docstatus", "=", 1]],
    pageSize: 200,
    cutoffIso: CUTOVER_ISO,
    cutoffField: "creation",
  })) erpSOs.push(...page);

  const r3: any = await db.execute(sql.raw(`SELECT order_number FROM orders`));
  const localOrders = new Set((r3?.rows ?? r3).map((x: any) => x.order_number));
  const missingO = erpSOs.filter((o) => !localOrders.has(o.name));
  console.log(`\n=== SALES ORDERS ===`);
  console.log(`  ERP (≤ cutover):    ${erpSOs.length}`);
  console.log(`  Local order_number: ${localOrders.size}`);
  console.log(`  Missing locally:    ${missingO.length}`);
  missingO.slice(0, 15).forEach((o) =>
    console.log(`    - ${o.name.padEnd(28)} customer=${o.customer.padEnd(20)} date=${o.transaction_date}  ₹${o.grand_total}`)
  );

  await shutdown();
}
main().catch(async (e) => { console.error(e); await shutdown(); process.exit(1); });
