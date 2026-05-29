/* eslint-disable no-console */
// Deep diff for four specific templates: KLS Waist Coat, QLS Blazer,
// SAS BP Sports Track, SAS KS Sports Track. For each:
//   1. local products row (status, schoolId link)
//   2. local product_school link (which school it's attached to)
//   3. local variant count + presence
//   4. price coverage (item_prices exists per variant?)
//   5. ERP variant attribute axes vs local productVariantAttributes

import { erpGet } from "./_client";
import { db, shutdown } from "./_db";
import { sql } from "drizzle-orm";

const TEMPLATES = [
  { erpName: "KLS Waist Coat",        userSchool: "KLINK" },
  { erpName: "QLS Blazer",            userSchool: "QLPHP" },
  { erpName: "SAS BP Sports Track",   userSchool: "SAS BP" },
  { erpName: "SAS KS Sports Track",   userSchool: "SAS KS" },
];

async function rows(sqlStr: string): Promise<any[]> {
  const r: any = await db.execute(sql.raw(sqlStr));
  return (r?.rows ?? r) as any[];
}

async function main() {
  for (const t of TEMPLATES) {
    console.log(`\n${"═".repeat(72)}\n${t.erpName}  (school clue: ${t.userSchool})\n${"═".repeat(72)}`);

    // ── Local product row
    const local = await rows(
      `SELECT id, item_code, name, status, base_price, base_mrp, category_id, hsn_code
         FROM products
        WHERE item_code = '${t.erpName.replace(/'/g, "''")}' LIMIT 1`
    );
    if (!local[0]) { console.log("  ✗ NOT in local products"); continue; }
    const p = local[0];
    console.log(`  ✓ local product: id=${p.id} status=${p.status} basePrice=${p.base_price} mrp=${p.base_mrp ?? "—"}`);

    // ── product_school link(s)
    const links = await rows(
      `SELECT ps.school_id, ps.is_required, ps.override_price, s.name AS school_name, s.school_code
         FROM product_school ps
         JOIN schools s ON s.id = ps.school_id
        WHERE ps.product_id = '${p.id}'`
    );
    if (!links.length) {
      console.log(`  ⚠ no product_school link for any school — invisible in school-filtered admin views`);
    } else {
      console.log(`  product_school links: ${links.length}`);
      for (const l of links) console.log(`     • ${l.school_code}/${l.school_name}  required=${l.is_required}`);
    }

    // ── Local variants
    const localVars = await rows(
      `SELECT id, sku, size, is_active FROM product_variants WHERE product_id = '${p.id}' ORDER BY sku`
    );
    console.log(`  local variants: ${localVars.length}`);

    // ── Variant prices
    const priced = await rows(
      `SELECT pv.sku, ip.price
         FROM product_variants pv
         LEFT JOIN item_prices ip ON ip.variant_id = pv.id
        WHERE pv.product_id = '${p.id}'`
    );
    const withPrice = priced.filter((r) => r.price != null).length;
    const noPrice = priced.length - withPrice;
    console.log(`  variant pricing:  ${withPrice} priced, ${noPrice} without price${noPrice ? "  ⚠" : ""}`);

    // ── Variant attributes (color/size axes) locally
    const attrs = await rows(
      `SELECT DISTINCT pa.name AS attr, pav.value
         FROM product_variant_attributes pva
         JOIN product_attributes pa ON pa.id = pva.attribute_id
         JOIN product_attribute_values pav ON pav.id = pva.value_id
         JOIN product_variants pv ON pv.id = pva.variant_id
        WHERE pv.product_id = '${p.id}'
        ORDER BY pa.name, pav.value`
    );
    const byAttr = new Map<string, string[]>();
    for (const a of attrs) {
      if (!byAttr.has(a.attr)) byAttr.set(a.attr, []);
      byAttr.get(a.attr)!.push(a.value);
    }
    console.log(`  local axes:`);
    if (byAttr.size === 0) console.log(`     (none — variants have no attribute mappings)`);
    for (const [k, vs] of byAttr) console.log(`     • ${k}: [${vs.join(", ")}]`);

    // ── ERP variants for this template
    const qs = new URLSearchParams({
      fields: JSON.stringify(["name", "item_name", "disabled"]),
      filters: JSON.stringify([["variant_of", "=", t.erpName]]),
      limit_page_length: "200",
    });
    let erpVariants: any[] = [];
    try { erpVariants = (await erpGet<any[]>(`/api/resource/Item?${qs}`)) as any[]; } catch (e) { console.log(`  (ERP fetch failed: ${(e as Error).message})`); }
    console.log(`  ERP variants:    ${erpVariants.length}`);

    // ── ERP axes: pull one ERP doc to inspect attributes
    if (erpVariants[0]) {
      try {
        const sample = await erpGet<any>(`/api/resource/Item/${encodeURIComponent(erpVariants[0].name)}`);
        const sa = sample?.attributes ?? [];
        if (sa.length) {
          console.log(`  ERP axes sample (from ${erpVariants[0].name}):`);
          for (const a of sa) console.log(`     • ${a.attribute}: ${a.attribute_value}`);
        }
      } catch {}
    }

    // ── Which ERP variants are NOT in local product_variants.sku?
    const localSkus = new Set(localVars.map((v: any) => v.sku));
    const erpMissing = erpVariants.filter((v: any) => !localSkus.has(v.name));
    console.log(`  ERP variants missing locally:  ${erpMissing.length}`);
    if (erpMissing.length) {
      for (const v of erpMissing.slice(0, 10)) console.log(`     ✗ ${v.name}${v.disabled ? " [disabled in ERP]" : ""}`);
    }
  }
  await shutdown();
}
main().catch(async (e) => { console.error(e); await shutdown(); process.exit(1); });
