/* eslint-disable no-console */
/**
 * For each template product (Has Variants=1 in Item.csv), aggregate the
 * variant attribute pairs (e.g. "Uniform Colors" → {Red, Green, Blue,
 * Yellow}) across all of its variants and write them as a JSONB array of
 * { name, values[] } onto products.attribute_groups.
 *
 * Size attribute is synthesised from product_variants.size (sizes weren't
 * exported in Item.csv's variant-attribute child table — only colours
 * were; sizes are encoded in variant suffixes). The size attribute label
 * is derived from the product's "Item Group" so live's "SHIRT SIZE" /
 * "FULL PANT SIZE" labels are preserved.
 */

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import fs from "fs";
import { db } from "../db/client";
import { sql } from "drizzle-orm";

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else {
      if (c === '"') q = true;
      else if (c === ",") {
        row.push(cell);
        cell = "";
      } else if (c === "\n") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else if (c === "\r") {
        // skip
      } else cell += c;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Convert an item-group label into the live UI's size-attribute label.
 *  Hardcoded because Item Attribute.csv doesn't carry the mapping. */
const ITEM_GROUP_TO_SIZE_LABEL: Record<string, string> = {
  Shirt: "Shirt Size",
  "Full Pants": "Full Pant Size",
  "Half Pants": "WM WF Half Pants Sizes",
  Belt: "Belt Size",
  Shoes: "Shoe Size",
  Hoodie: "Hoodie Sizes",
  Socks: "Socks Size",
  "Track Pant": "Track Pant Size",
  "Track Shorts": "Track Shorts Sizes",
  Tshirt: "Tshirt Size",
  RNT: "Tshirt Size",
  Caps: "Caps Sizes",
  Skirt: "Skirt Sizes",
  Bags: "Bags Size",
};

async function main() {
  const csvPath = path.resolve(process.cwd(), "Item (1).csv");
  console.log("Reading", csvPath);
  const rows = parseCsv(fs.readFileSync(csvPath, "utf8"));
  const hdr = rows[0];
  const ixCode = hdr.indexOf("Item Code");
  const ixVo = hdr.indexOf("Variant Of");
  const ixAttr = hdr.indexOf("Attribute (Variant Attributes)");
  const ixVal = hdr.indexOf("Attribute Value (Variant Attributes)");
  const ixGroup = hdr.indexOf("Item Group");

  // Build template → attrName → Set<value> from variant rows.
  const groups = new Map<string, Map<string, Set<string>>>();
  // Also template name → item_group (for size-label inference)
  const groupOfTemplate = new Map<string, string>();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const c = r[ixCode]?.trim();
    if (!c) continue;
    const vo = r[ixVo]?.trim();
    const a = r[ixAttr]?.trim();
    const v = r[ixVal]?.trim();
    const grp = r[ixGroup]?.trim();
    if (!vo && grp) groupOfTemplate.set(c, grp);
    if (!vo || !a || !v) continue;
    if (!groups.has(vo)) groups.set(vo, new Map());
    const g = groups.get(vo)!;
    if (!g.has(a)) g.set(a, new Set());
    g.get(a)!.add(v);
  }
  console.log(`Found attribute groups for ${groups.size} templates`);

  // Load DB products + their product_variants for size synthesis
  const productRows = (await db.execute(sql`
    SELECT p.id, p.name, p.erp_name
      FROM products p
     WHERE p.is_variant_item = false
  `)) as unknown as { id: string; name: string; erp_name: string | null }[];

  const variants = (await db.execute(sql`
    SELECT product_id, size FROM product_variants WHERE is_active = true
  `)) as unknown as { product_id: string; size: string }[];
  const sizesByProduct = new Map<string, string[]>();
  for (const v of variants) {
    const list = sizesByProduct.get(v.product_id) ?? [];
    list.push(v.size);
    sizesByProduct.set(v.product_id, list);
  }

  const ALPHA_ORDER = ["XXS","XS","S","M","L","XL","XXL","2XL","3XL","4XL","5XL","6XL"];
  function sortSizes(sizes: string[]): string[] {
    const key = (s: string): [number, number, number, string] => {
      if (/^\d+$/.test(s)) return [1, parseInt(s, 10), 0, s];
      const d = s.match(/^(\d+)-(\d+)$/);
      if (d) return [2, parseInt(d[1], 10), parseInt(d[2], 10), s];
      const ai = ALPHA_ORDER.indexOf(s.toUpperCase());
      if (ai >= 0) return [3, ai, 0, s];
      const lead = s.match(/^(\d+)/);
      if (lead) return [4, parseInt(lead[1], 10), 0, s];
      return [5, 0, 0, s.toUpperCase()];
    };
    return [...sizes].sort((a, b) => {
      const ka = key(a), kb = key(b);
      for (let i = 0; i < 3; i++) if (ka[i] !== kb[i]) return (ka[i] as number) - (kb[i] as number);
      return (ka[3] as string).localeCompare(kb[3] as string);
    });
  }
  function cleanSizeGroup(sizes: string[]): string[] {
    if (sizes.length < 2) return sortSizes(sizes);
    if (!sizes.every((s) => s.length > 1 && /^[A-Z]/i.test(s))) return sortSizes(sizes);
    if (sizes.every((s) => s.length > 2 && /^[A-Z]{2}\d/i.test(s))) {
      const stripped2 = sizes.map((s) => s.slice(2));
      const uniq2 = new Set(stripped2);
      if (uniq2.size < sizes.length) return sortSizes([...uniq2]);
    }
    const firstLetters = new Set(sizes.map((s) => s[0].toUpperCase()));
    const stripped1 = sizes.map((s) => s.slice(1));
    if (firstLetters.size === 1) return sortSizes([...new Set(stripped1)]);
    const uniq1 = new Set(stripped1);
    if (uniq1.size < sizes.length) return sortSizes([...uniq1]);
    return sortSizes(sizes);
  }

  let updated = 0;
  for (const p of productRows) {
    const colorMap = groups.get(p.name) ?? groups.get(p.erp_name ?? "");
    const sizes = sizesByProduct.get(p.id) ?? [];
    const itemGroup = groupOfTemplate.get(p.name) ?? groupOfTemplate.get(p.erp_name ?? "") ?? "";

    const out: { name: string; values: string[] }[] = [];
    if (colorMap) {
      for (const [a, vs] of colorMap.entries()) {
        out.push({ name: a, values: [...vs].sort() });
      }
    }
    // Synthesise a size group from product_variants ONLY if Item.csv didn't
    // already declare a size attribute (matches name /size|sizes/i). This
    // avoids double-rendering e.g. "Skirt Size" + "Skirt Sizes" on the PDP.
    const alreadyHasSize = out.some((g) => /size|sizes/i.test(g.name));
    if (sizes.length > 0 && !alreadyHasSize) {
      const sizeLabel =
        ITEM_GROUP_TO_SIZE_LABEL[itemGroup] ?? `${itemGroup || "Variant"} Size`;
      out.push({ name: sizeLabel, values: cleanSizeGroup(sizes) });
    }
    if (out.length === 0) continue;

    await db.execute(sql`
      UPDATE products
         SET attribute_groups = ${JSON.stringify(out)}::jsonb
       WHERE id = ${p.id}
    `);
    updated++;
  }
  console.log(`Updated attribute_groups on ${updated} products`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
