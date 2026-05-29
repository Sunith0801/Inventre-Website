/* eslint-disable no-console */
// Read-only spot-check: pull every ERP Item matching any of a list of name
// fragments (regardless of has_variants / disabled / variant_of), and
// cross-check each against local products.item_code AND product_variants.sku.

import { erpGet } from "./_client";
import { db, shutdown } from "./_db";
import { sql } from "drizzle-orm";

const QUERIES: string[] = [
  // school-coded prefixes the user gave us
  "KLINK",
  "QLPHP",
  "SAS BP",
  "SAS KS",
  // plain-text descriptors
  "waistcoat",
  "Waist Coat",
  "waist coat",
  "Blazer",
  "blazer",
  "Track",
  "track",
];

async function erpSearch(needle: string) {
  // OR across item_name and name (item_code).
  const filters = JSON.stringify([
    ["item_name", "like", `%${needle}%`],
  ]);
  const qs = new URLSearchParams({
    fields: JSON.stringify(["name", "item_name", "item_group", "has_variants", "variant_of", "disabled", "custom_school_name"]),
    filters,
    limit_page_length: "200",
  });
  const rows = (await erpGet<any[]>(`/api/resource/Item?${qs}`)) as any[];
  return rows ?? [];
}

async function localHasItemCode(code: string): Promise<boolean> {
  const r: any = await db.execute(sql.raw(`SELECT 1 FROM products WHERE item_code = '${code.replace(/'/g, "''")}' LIMIT 1`));
  return ((r?.rows ?? r) as any[]).length > 0;
}
async function localHasSku(sku: string): Promise<boolean> {
  const r: any = await db.execute(sql.raw(`SELECT 1 FROM product_variants WHERE sku = '${sku.replace(/'/g, "''")}' LIMIT 1`));
  return ((r?.rows ?? r) as any[]).length > 0;
}

async function main() {
  const seen = new Map<string, any>();
  for (const q of QUERIES) {
    try {
      const rows = await erpSearch(q);
      for (const r of rows) seen.set(r.name, r);
    } catch (e) {
      console.warn(`  ! search "${q}" failed:`, (e as Error).message.slice(0, 120));
    }
  }
  const rows = Array.from(seen.values()).sort((a, b) =>
    (a.custom_school_name ?? "").localeCompare(b.custom_school_name ?? "") || a.name.localeCompare(b.name)
  );

  console.log(`\nERP rows matching any of: ${QUERIES.join(", ")}`);
  console.log(`Total unique ERP items found: ${rows.length}\n`);
  console.log("status  | role           | item_code                                  | item_name                                      | school");
  console.log("-".repeat(160));
  for (const r of rows) {
    const role = r.has_variants ? "template" : r.variant_of ? `variant of ${r.variant_of}` : "single";
    const inProd = await localHasItemCode(r.name);
    const inVar = await localHasSku(r.name);
    const present = inProd || inVar;
    const disabled = r.disabled ? " [DISABLED in ERP]" : "";
    const status = present ? "  ✓     " : "  ✗ MISS";
    console.log(`${status}| ${role.padEnd(15)}| ${r.name.padEnd(42)} | ${(r.item_name ?? "").padEnd(46)} | ${r.custom_school_name ?? "—"}${disabled}`);
  }

  const missing = [];
  for (const r of rows) {
    const inProd = await localHasItemCode(r.name);
    const inVar = await localHasSku(r.name);
    if (!inProd && !inVar) missing.push(r);
  }
  console.log(`\nSummary: ${rows.length} ERP matches, ${rows.length - missing.length} present locally, ${missing.length} missing.`);

  await shutdown();
}
main().catch(async (e) => { console.error(e); await shutdown(); process.exit(1); });
