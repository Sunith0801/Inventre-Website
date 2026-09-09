/**
 * Import Item Attributes from the legacy ERPNext export.
 *
 * Reads `Item Attribute.csv` at the repo root. Each "header" row carries
 * an Attribute Name + numeric-range flags; subsequent rows with an empty
 * Attribute Name are continuation rows holding additional values for the
 * same attribute.
 *
 * Upserts by `erp_id`:
 *   - productAttributes.erp_id  ← first value row's ERP id is reused as a
 *     stable identifier (the CSV doesn't expose an attribute-level id).
 *   - productAttributeValues.erp_id ← the per-value ERP id.
 *
 * Type is inferred from the name (Color/Colour → color, Size/Sizes → size,
 * Design/Styles → design, otherwise → other).
 *
 * Usage:  tsx scripts/import-item-attributes.ts [path/to/Item Attribute.csv]
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, sql as drz } from "drizzle-orm";
import * as schema from "../db/schema";

const csvPath =
  process.argv[2] ?? path.resolve(process.cwd(), "data/imports/Item Attribute.csv");

if (!fs.existsSync(csvPath)) {
  console.error(`CSV not found at ${csvPath}`);
  process.exit(1);
}

const dbUrl = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("DATABASE_DIRECT_URL or DATABASE_URL must be set");
  process.exit(1);
}

const client = postgres(dbUrl, { max: 1, prepare: false });
const db = drizzle(client, { schema });

// ─── CSV parsing ────────────────────────────────────────────────────
// Minimal RFC-4180-ish parser: handles quoted fields with embedded commas.

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = false;
        }
      } else {
        cur += c;
      }
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") {
        row.push(cur);
        cur = "";
      } else if (c === "\n") {
        row.push(cur);
        cur = "";
        rows.push(row);
        row = [];
      } else if (c === "\r") {
        // skip
      } else {
        cur += c;
      }
    }
  }
  if (cur.length > 0 || row.length > 0) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

// ─── Type inference ─────────────────────────────────────────────────

type AttrType = "size" | "color" | "design" | "model" | "other";

function inferType(name: string): AttrType {
  const n = name.toLowerCase();
  if (/colou?r|strips?\b/.test(n)) return "color";
  if (/\bsize(s)?\b/.test(n)) return "size";
  if (/design|styles?\b/.test(n)) return "design";
  if (/\bmodel\b/.test(n)) return "model";
  return "other";
}

// ─── Main ───────────────────────────────────────────────────────────

type CsvRow = {
  name: string;
  isNumeric: boolean;
  fromRange: number | null;
  toRange: number | null;
  increment: number | null;
  isDisabled: boolean;
  valueErpId: string;
  abbreviation: string;
  value: string;
};

function num(s: string): number | null {
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : null;
}

(async () => {
  const raw = fs.readFileSync(csvPath, "utf8");
  const rows = parseCsv(raw);
  const header = rows.shift();
  if (!header) {
    console.error("Empty CSV");
    process.exit(1);
  }

  // Group: each non-empty Attribute Name starts a new group; empty-name
  // rows are continuation values for the previous group.
  const groups: { meta: CsvRow; values: CsvRow[] }[] = [];
  let current: { meta: CsvRow; values: CsvRow[] } | null = null;
  for (const r of rows) {
    if (r.length < 9) continue;
    const [name, numeric, from, disabled, inc, to, vid, abbr, val] = r;
    const parsed: CsvRow = {
      name: name.trim(),
      isNumeric: numeric === "1",
      fromRange: num(from),
      toRange: num(to),
      increment: num(inc),
      isDisabled: disabled === "1",
      valueErpId: vid.trim(),
      abbreviation: abbr.trim(),
      value: val.trim(),
    };
    if (parsed.name) {
      current = { meta: parsed, values: [parsed] };
      groups.push(current);
    } else if (current) {
      current.values.push(parsed);
    }
  }

  console.log(`Parsed ${groups.length} attributes, ${groups.reduce((a, g) => a + g.values.length, 0)} values`);

  let attrInserted = 0;
  let attrUpdated = 0;
  let valInserted = 0;
  let valUpdated = 0;

  for (const g of groups) {
    const meta = g.meta;
    const erpId = g.values[0].valueErpId || `name:${meta.name}`;
    const type = inferType(meta.name);

    // Look up by erpId, then by name as fallback (in case of pre-existing rows).
    const existingByErp = await db
      .select()
      .from(schema.productAttributes)
      .where(eq(schema.productAttributes.erpId, erpId))
      .limit(1);
    const existingByName =
      existingByErp.length === 0
        ? await db
            .select()
            .from(schema.productAttributes)
            .where(eq(schema.productAttributes.name, meta.name))
            .limit(1)
        : [];
    const existing = existingByErp[0] ?? existingByName[0] ?? null;

    let attrId: string;
    if (existing) {
      attrId = existing.id;
      await db
        .update(schema.productAttributes)
        .set({
          name: meta.name,
          type,
          isDisabled: meta.isDisabled,
          isNumeric: meta.isNumeric,
          numericFromRange: meta.fromRange != null ? String(meta.fromRange) : null,
          numericToRange: meta.toRange != null ? String(meta.toRange) : null,
          numericIncrement: meta.increment != null ? String(meta.increment) : null,
          erpId,
          updatedAt: new Date(),
        })
        .where(eq(schema.productAttributes.id, attrId));
      attrUpdated++;
    } else {
      const [created] = await db
        .insert(schema.productAttributes)
        .values({
          name: meta.name,
          type,
          isDisabled: meta.isDisabled,
          isNumeric: meta.isNumeric,
          numericFromRange: meta.fromRange != null ? String(meta.fromRange) : null,
          numericToRange: meta.toRange != null ? String(meta.toRange) : null,
          numericIncrement: meta.increment != null ? String(meta.increment) : null,
          erpId,
          sortOrder: 0,
        })
        .returning();
      attrId = created.id;
      attrInserted++;
    }

    // Upsert each value by erpId
    let order = 0;
    for (const v of g.values) {
      if (!v.value) continue;
      order++;
      const existingVal = v.valueErpId
        ? await db
            .select()
            .from(schema.productAttributeValues)
            .where(eq(schema.productAttributeValues.erpId, v.valueErpId))
            .limit(1)
        : [];
      if (existingVal[0]) {
        await db
          .update(schema.productAttributeValues)
          .set({
            attributeId: attrId,
            value: v.value,
            displayLabel: v.abbreviation || null,
            sortOrder: order,
          })
          .where(eq(schema.productAttributeValues.id, existingVal[0].id));
        valUpdated++;
      } else {
        // Avoid duplicate (attrId, value) collisions on re-import.
        await db
          .insert(schema.productAttributeValues)
          .values({
            attributeId: attrId,
            value: v.value,
            displayLabel: v.abbreviation || null,
            sortOrder: order,
            erpId: v.valueErpId || null,
          })
          .onConflictDoNothing({
            target: [
              schema.productAttributeValues.attributeId,
              schema.productAttributeValues.value,
            ],
          });
        valInserted++;
      }
    }
  }

  console.log(`Attributes: ${attrInserted} inserted, ${attrUpdated} updated`);
  console.log(`Values:     ${valInserted} inserted, ${valUpdated} updated`);

  await client.end({ timeout: 5 });
})().catch(async (e) => {
  console.error(e);
  await client.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
});
