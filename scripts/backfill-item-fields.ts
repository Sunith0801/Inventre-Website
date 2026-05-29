/* eslint-disable no-console */
/**
 * Backfills every Item.csv column we previously dropped on the floor into
 * the products row + product_uoms + product_barcodes child tables.
 *
 * Sources per column:
 *   products.hsnCode              ← "HSN/SAC"
 *   products.description (jsonb)  ← "Description"  (single-line ⇒ ["…"])
 *   products.brand                ← "Brand"
 *   products.weightGrams          ← "Weight Per Unit"  (× 1000 if UOM == kg)
 *   products.dimensions (jsonb)   ← "Length (cm)", "Width (cm)", "Height (cm)"
 *   products.weightPerUnit (kg)   ← "Weight Per Unit"
 *   products.reorderTatDays       ← "Re-ordering TAT"
 *   products.minOrderQty          ← "Minimum Order Qty"
 *   products.countryOfOrigin      ← "Country of Origin"
 *   products.customsTariffNumber  ← "Customs Tariff Number"
 *
 * Child tables (one row per child-table entry — many rows per item code):
 *   product_uoms     ← "UOM (UOMs)" + "Conversion Factor (UOMs)"
 *   product_barcodes ← "Barcode (Barcodes)" + "Barcode Type (Barcodes)" + "UOM (Barcodes)"
 *
 * Idempotent — UPDATE for scalar fields; ON CONFLICT DO NOTHING for child tables.
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

const numOrNull = (s: string | undefined): number | null => {
  if (!s) return null;
  const n = parseFloat(s.replace(/,/g, ""));
  return Number.isFinite(n) && n !== 0 ? n : null;
};
const trimOrNull = (s: string | undefined): string | null => {
  const t = s?.trim();
  return t && t !== "0" && t !== "0.0" ? t : null;
};

async function main() {
  const csvPath = path.resolve(process.cwd(), "Item (1).csv");
  console.log("Reading", csvPath);
  const rows = parseCsv(fs.readFileSync(csvPath, "utf8"));
  const hdr = rows[0];
  const ix = (h: string) => hdr.indexOf(h);

  const idx = {
    code: ix("Item Code"),
    hsn: ix("HSN/SAC"),
    description: ix("Description"),
    brand: ix("Brand"),
    weight: ix("Weight Per Unit"),
    weightUom: ix("Weight UOM"),
    length: ix("Length (cm)"),
    width: ix("Width (cm)"),
    height: ix("Height (cm)"),
    weightKg: ix("Weight (kg)"),
    reorderTat: ix("Re-ordering TAT"),
    minOrderQty: ix("Minimum Order Qty"),
    country: ix("Country of Origin"),
    customs: ix("Customs Tariff Number"),
    uom: ix("UOM (UOMs)"),
    uomConversion: ix("Conversion Factor (UOMs)"),
    barcode: ix("Barcode (Barcodes)"),
    barcodeType: ix("Barcode Type (Barcodes)"),
    barcodeUom: ix("UOM (Barcodes)"),
  };

  // Group rows by item code (one item can have multiple child-table rows)
  type Acc = {
    scalar: Record<string, unknown> | null;
    uoms: { uom: string; conv: number }[];
    barcodes: { code: string; type: string | null; uom: string | null }[];
  };
  const byCode = new Map<string, Acc>();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const code = r[idx.code]?.trim();
    if (!code) continue;
    if (!byCode.has(code)) byCode.set(code, { scalar: null, uoms: [], barcodes: [] });
    const acc = byCode.get(code)!;
    if (!acc.scalar) {
      const desc = trimOrNull(r[idx.description]);
      const dims: Record<string, number> = {};
      const l = numOrNull(r[idx.length]);
      const w = numOrNull(r[idx.width]);
      const h = numOrNull(r[idx.height]);
      if (l) dims.l = l;
      if (w) dims.w = w;
      if (h) dims.h = h;
      const weightKg = numOrNull(r[idx.weightKg]);
      const weightUom = trimOrNull(r[idx.weightUom]);
      let weightGrams: number | null = null;
      if (weightKg) weightGrams = Math.round(weightKg * 1000);
      else if (idx.weight >= 0) {
        const w0 = numOrNull(r[idx.weight]);
        if (w0) weightGrams = weightUom?.toLowerCase() === "kg" ? Math.round(w0 * 1000) : Math.round(w0);
      }
      acc.scalar = {
        hsnCode: trimOrNull(r[idx.hsn]),
        description: desc ? [desc] : null,
        brand: trimOrNull(r[idx.brand]),
        weightGrams,
        dimensions: Object.keys(dims).length ? dims : null,
        reorderTatDays: numOrNull(r[idx.reorderTat]),
        minOrderQty: numOrNull(r[idx.minOrderQty]),
        countryOfOrigin: trimOrNull(r[idx.country]),
        customsTariffNumber: trimOrNull(r[idx.customs]),
      };
    }
    // child-table rows: each Item.csv row may also carry a UOM and/or
    // a Barcode entry. Capture them whenever present.
    const u = trimOrNull(r[idx.uom]);
    const conv = numOrNull(r[idx.uomConversion]) ?? 1;
    if (u) acc.uoms.push({ uom: u, conv });
    const b = trimOrNull(r[idx.barcode]);
    if (b) {
      acc.barcodes.push({
        code: b,
        type: trimOrNull(r[idx.barcodeType]),
        uom: trimOrNull(r[idx.barcodeUom]),
      });
    }
  }

  // Resolve product ids by name
  const prodRows = (await db.execute(sql`
    SELECT id, name, erp_name FROM products
  `)) as unknown as { id: string; name: string; erp_name: string | null }[];
  const idByName = new Map<string, string>();
  for (const p of prodRows) {
    idByName.set(p.name.toLowerCase(), p.id);
    if (p.erp_name) idByName.set(p.erp_name.toLowerCase(), p.id);
  }

  let scalarUpdated = 0;
  let uomsInserted = 0;
  let barcodesInserted = 0;
  let unmatched = 0;
  let processed = 0;

  for (const [code, acc] of byCode) {
    const productId = idByName.get(code.toLowerCase());
    if (!productId) {
      unmatched++;
      continue;
    }
    processed++;

    if (acc.scalar) {
      const s = acc.scalar;
      await db.execute(sql`
        UPDATE products SET
          hsn_code              = COALESCE(${s.hsnCode as string | null}, hsn_code),
          description           = COALESCE(${JSON.stringify(s.description) as unknown as string}::jsonb, description),
          brand                 = COALESCE(${s.brand as string | null}, brand),
          weight_grams          = COALESCE(${s.weightGrams as number | null}, weight_grams),
          dimensions            = COALESCE(${JSON.stringify(s.dimensions) as unknown as string}::jsonb, dimensions),
          reorder_tat_days      = COALESCE(${s.reorderTatDays as number | null}, reorder_tat_days),
          min_order_qty         = COALESCE(${s.minOrderQty as number | null}, min_order_qty),
          country_of_origin     = COALESCE(${s.countryOfOrigin as string | null}, country_of_origin),
          customs_tariff_number = COALESCE(${s.customsTariffNumber as string | null}, customs_tariff_number)
         WHERE id = ${productId}
      `);
      scalarUpdated++;
    }

    for (const u of acc.uoms) {
      await db.execute(sql`
        INSERT INTO product_uoms (product_id, uom, conversion_factor)
        VALUES (${productId}, ${u.uom}, ${u.conv})
        ON CONFLICT (product_id, uom) DO NOTHING
      `);
      uomsInserted++;
    }
    for (const b of acc.barcodes) {
      await db.execute(sql`
        INSERT INTO product_barcodes (product_id, barcode, barcode_type, uom)
        VALUES (${productId}, ${b.code}, ${b.type}, ${b.uom})
        ON CONFLICT (product_id, barcode) DO NOTHING
      `);
      barcodesInserted++;
    }
  }

  console.log(`Processed ${processed} item codes (unmatched: ${unmatched})`);
  console.log(`Scalar fields written: ${scalarUpdated}`);
  console.log(`UOM rows: ${uomsInserted}`);
  console.log(`Barcode rows: ${barcodesInserted}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
