/* eslint-disable no-console */
/**
 * Imports the BOM.csv hierarchy into product_bundles + bundle_components.
 *
 * Source: c:\Users\Global soc\Downloads\Inventre\BOM.csv
 * Columns: ID,Item,Company,Quantity,Currency,Conversion Rate,
 *          ID(Items),Item Code(Items),Qty(Items),Rate(Items),UOM(Items)
 *
 *   Row with ID set       → parent BOM (cols 0..5)
 *   Row with ID empty     → child of the *previous* parent (cols 6..10)
 *
 * For each parent BOM:
 *   1) Find or stub-create the parent product (by exact name match).
 *   2) Upsert a `product_bundles` row (bundle_type='fixed', pricing_mode='sum').
 *   3) For each child row:
 *        a) Find or stub-create the child product (by name).
 *        b) Insert a `bundle_components` row (qty from BOM, no variantId).
 *
 * Idempotent: child rows are wiped per-bundle before re-insert so re-runs
 * don't double-count. Stubbed products are status='active' so existing shop
 * pipeline keeps treating them like ERP-imported items.
 */

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import fs from "fs";
import { db } from "../db/client";
import { sql } from "drizzle-orm";

const CSV_PATH = path.resolve(
  process.cwd(),
  "..",
  "BOM.csv"
);
// Prefer the explicit project copy if present
const ALT_PATH = path.resolve(process.cwd(), "BOM.csv");

function pickCsv(): string {
  for (const p of [ALT_PATH, CSV_PATH]) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error("BOM.csv not found in project root");
}

/** Minimal RFC-4180 CSV parser (handles quoted cells with embedded commas). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += c;
      }
    } else {
      if (c === '"') inQuotes = true;
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
      } else {
        cell += c;
      }
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

type Level = "magic_box" | "bookkit" | "sub_bundle" | "leaf";

function classifyName(name: string): Level {
  if (/magic\s*box/i.test(name)) return "magic_box";
  if (/bookkit/i.test(name)) return "bookkit";
  if (/\bbundle\s*\d+/i.test(name)) return "sub_bundle";
  return "leaf";
}

function genderFromName(name: string): "Boys" | "Girls" | null {
  const m = name.match(/\b(boys|girls)\b/i);
  if (!m) return null;
  return m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() === "Boys"
    ? "Boys"
    : "Girls";
}

async function getOrCreateProductId(
  name: string,
  defaultPricePaise: number
): Promise<string> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("empty product name");

  // Look up by name OR erp_name (case-insensitive) — handles pre-existing
  // ERP-imported rows that may have slightly different casing.
  const existing = (await db.execute(sql`
    SELECT id FROM products
     WHERE lower(name) = lower(${trimmed})
        OR lower(erp_name) = lower(${trimmed})
     LIMIT 1
  `)) as unknown as { id: string }[];
  if (existing[0]?.id) return existing[0].id;

  const level = classifyName(trimmed);
  const gender = level === "magic_box" ? genderFromName(trimmed) : null;
  const baseSlug = slugify(trimmed);
  const slug = `${baseSlug}-${Math.random().toString(36).slice(2, 8)}`;

  const inserted = (await db.execute(sql`
    INSERT INTO products
      (slug, name, base_price, status, erp_name, is_magic_box,
       bundle_level, bundle_gender)
    VALUES
      (${slug}, ${trimmed}, ${defaultPricePaise}, 'active', ${trimmed},
       ${level === "magic_box"}, ${level}::bundle_level, ${gender})
    ON CONFLICT (erp_name) DO UPDATE
      SET bundle_level   = EXCLUDED.bundle_level,
          bundle_gender  = EXCLUDED.bundle_gender,
          is_magic_box   = EXCLUDED.is_magic_box
    RETURNING id
  `)) as unknown as { id: string }[];
  return inserted[0].id;
}

/**
 * Detect a language/stream variant bookkit and split its name.
 *
 * The BOM.csv expresses variants as a concatenated suffix with no space
 * between "Bookkit" and the variant token, e.g.
 *   "SMS Grade 6 BookkitHindi 2nd Lan Tel 3rd Lan"
 *   "WM JK Grade 6 BookkitFrench 2nd Lan Kan 3rd Lan"
 *   "SMS Grade 11 BookkitMandateBiologyPhysicsChemistryMathematics"
 *
 * The text after "Bookkit" up to the next space is the primary axis
 * value (language or stream); the remainder is a secondary modifier
 * we collapse into the same value. The "template" is everything up to
 * and including "Bookkit".
 *
 * Returns null when the name is a plain bookkit (no suffix), or when
 * a space already separates "Bookkit" from the next word (those rows
 * are treated as standalone kits, not variants).
 */
function splitBookkitVariant(
  name: string
): { templateName: string; variantValue: string } | null {
  // Match "<base Bookkit><Suffix>" where suffix starts with a letter
  // (no separating space). Stop the base match at " Bookkit" boundary.
  const m = name.match(/^(.+?\sBookkit)([A-Za-z].*)$/);
  if (!m) return null;
  const templateName = m[1].trim();
  const variantValue = m[2].trim();
  if (!variantValue) return null;
  return { templateName, variantValue };
}

async function linkAsBookkitVariant(
  variantProductId: string,
  templateName: string,
  variantValue: string
): Promise<void> {
  // Resolve the template product, stubbing it if missing.
  const templateId = await getOrCreateProductId(templateName, 0);

  // Mark this product as a variant of the template.
  await db.execute(sql`
    UPDATE products
       SET is_variant_item = true,
           variant_of_product_id = ${templateId},
           variant_attribute = 'Bookkit Variant',
           variant_attribute_value = ${variantValue},
           kind = 'kit',
           bundle_level = 'bookkit'::bundle_level
     WHERE id = ${variantProductId}
  `);

  // Ensure the template itself is treated as a kit template (not a leaf).
  await db.execute(sql`
    UPDATE products
       SET kind = 'kit',
           bundle_level = 'bookkit'::bundle_level
     WHERE id = ${templateId}
       AND (kind IS NULL OR kind = 'book' OR kind = 'sub_bundle' OR kind <> 'kit')
  `);

  // Upsert a product_variants row on the TEMPLATE so the PDP picker
  // (loadVariantBundleTree in lib/repos/products.ts) sees the option.
  //
  // The PDP picker discovers variants by:
  //   1. parseBookkitLangs (lib/bookkit-langs.ts) regex-matches
  //      "bookkit<Lang> 2nd Lan <Abbr> 3rd Lan" against variant.size.
  //   2. loadVariantBundleTree (lib/repos/products.ts) looks up the
  //      standalone language product by `name = variant.sku`.
  // To satisfy BOTH callers we set sku AND size to the original BOM
  // parent name (e.g. "SMS Grade 6 BookkitHindi 2nd Lan Tel 3rd Lan").
  const fullName = `${templateName}${variantValue}`;
  await db.execute(sql`
    INSERT INTO product_variants
      (product_id, size, sku, is_active, erp_name)
    VALUES
      (${templateId}, ${fullName}, ${fullName}, true, ${fullName})
    ON CONFLICT (sku) DO UPDATE
      SET product_id = EXCLUDED.product_id,
          size       = EXCLUDED.size,
          erp_name   = EXCLUDED.erp_name,
          is_active  = true
  `);

  // Deactivate any stale pre-existing language variants on the same
  // template whose `size` doesn't include "Bookkit" — those came from an
  // earlier import that stripped the word and so won't parse. We don't
  // delete them (cart/order FKs may reference them); deactivation hides
  // them from the storefront picker.
  await db.execute(sql`
    UPDATE product_variants
       SET is_active = false
     WHERE product_id = ${templateId}
       AND sku <> ${fullName}
       AND size !~* 'bookkit'
  `);
}

async function upsertBundle(productId: string): Promise<string> {
  const existing = (await db.execute(sql`
    SELECT id FROM product_bundles WHERE product_id = ${productId} LIMIT 1
  `)) as unknown as { id: string }[];
  if (existing[0]?.id) return existing[0].id;
  const inserted = (await db.execute(sql`
    INSERT INTO product_bundles (product_id, bundle_type, pricing_mode)
    VALUES (${productId}, 'fixed'::bundle_type, 'sum'::bundle_pricing_mode)
    RETURNING id
  `)) as unknown as { id: string }[];
  return inserted[0].id;
}

async function main() {
  const csvPath = pickCsv();
  console.log("Reading", csvPath);
  const text = fs.readFileSync(csvPath, "utf8");
  const rows = parseCsv(text);
  console.log("Parsed", rows.length, "rows");

  // Group child rows under their preceding parent.
  type Parent = { id: string; name: string; children: { code: string; qty: number; rate: number }[] };
  const parents: Parent[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 8) continue;
    const id = r[0]?.trim();
    if (id) {
      // new parent
      parents.push({ id, name: r[1]?.trim() ?? "", children: [] });
      // first child is on the same line (cols 6..)
      const childCode = r[7]?.trim();
      if (childCode) {
        parents[parents.length - 1].children.push({
          code: childCode,
          qty: parseFloat(r[8]) || 1,
          rate: parseFloat(r[9]) || 0,
        });
      }
    } else {
      const childCode = r[7]?.trim();
      if (!childCode || parents.length === 0) continue;
      parents[parents.length - 1].children.push({
        code: childCode,
        qty: parseFloat(r[8]) || 1,
        rate: parseFloat(r[9]) || 0,
      });
    }
  }

  console.log(`Found ${parents.length} parent BOMs`);
  const totalChildren = parents.reduce((s, p) => s + p.children.length, 0);
  console.log(`Found ${totalChildren} child entries`);

  let processed = 0;
  let stubbedParents = 0;
  let stubbedChildren = 0;

  for (const p of parents) {
    if (!p.name) continue;

    // Resolve parent product
    const parentBefore = (await db.execute(sql`
      SELECT id FROM products WHERE name = ${p.name} LIMIT 1
    `)) as unknown as { id: string }[];
    const parentExisted = !!parentBefore[0]?.id;
    const parentId = await getOrCreateProductId(p.name, 0);
    if (!parentExisted) stubbedParents++;

    // If this parent is a language/stream variant of a template Bookkit
    // (e.g. "SMS Grade 6 BookkitHindi 2nd Lan Tel 3rd Lan"), link it as
    // a variant of the template and create a picker row on the template.
    // The BOM stays attached to the variant — that's where the per-language
    // component list lives.
    const variantSplit = splitBookkitVariant(p.name);
    if (variantSplit) {
      await linkAsBookkitVariant(
        parentId,
        variantSplit.templateName,
        variantSplit.variantValue
      );
    }

    const bundleId = await upsertBundle(parentId);

    // Wipe existing components for idempotency
    await db.execute(sql`DELETE FROM bundle_components WHERE bundle_id = ${bundleId}`);

    for (const c of p.children) {
      const before = (await db.execute(sql`
        SELECT id FROM products WHERE name = ${c.code} LIMIT 1
      `)) as unknown as { id: string }[];
      const existed = !!before[0]?.id;
      const childId = await getOrCreateProductId(c.code, Math.round(c.rate * 100));
      if (!existed) stubbedChildren++;
      await db.execute(sql`
        INSERT INTO bundle_components (bundle_id, product_id, qty)
        VALUES (${bundleId}, ${childId}, ${Math.round(c.qty)})
      `);
    }

    processed++;
    if (processed % 50 === 0) {
      process.stdout.write(`  ${processed}/${parents.length}\r`);
    }
  }

  console.log(`\nImport done. parents=${processed}, stubbed_parents=${stubbedParents}, stubbed_children=${stubbedChildren}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
