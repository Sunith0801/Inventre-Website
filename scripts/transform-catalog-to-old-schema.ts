/**
 * Transform the clean catalog (new 19-table schema, DB `catalog_new`) into the
 * old ecommerce schema's catalog tables (DB `inventre`), so the original
 * Inventre app displays the clean ERPNext catalog.
 *
 *   npx tsx scripts/transform-catalog-to-old-schema.ts
 *
 * - Existing old products are set status='archived' (hidden from the shop;
 *   their variants stay so the 6 historical orders keep their FKs).
 * - Clean rows are tagged erp_raw->>'_clean'='true' so re-runs replace them.
 *
 * Mapping:  items(main)→products · items(variant)→product_variants ·
 *           item_images→product_images · item_school_grade_map→product_school
 *           + product_grades · boms→product_bundles · bom_items→bundle_components
 */
import crypto from "crypto";
import postgres from "postgres";

const PROD = "postgres://inventre:inventre_prod@161.97.132.211:55433";
const SRC = postgres(`${PROD}/catalog_new`, { prepare: false });
const DST = postgres(`${PROD}/inventre`, { prepare: false });

const uuid = () => crypto.randomUUID();

/** Deterministic UUID (v5-style) from a key — same key always yields the
 *  same UUID, so product / variant IDs stay stable across transform re-runs. */
function stableUuid(key: string): string {
  const h = crypto.createHash("sha1").update("inventre:" + key).digest("hex");
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
const slugify = (s: string) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 90) || "item";

async function insertChunked(db: any, table: string, cols: string[], rows: any[][]) {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const ph = chunk
      .map((_, r) => "(" + cols.map((__, c) => `$${r * cols.length + c + 1}`).join(",") + ")")
      .join(",");
    await db.unsafe(
      `INSERT INTO ${table} (${cols.join(",")}) VALUES ${ph}`,
      chunk.flat()
    );
  }
}

async function main() {
  console.log("Transforming clean catalog → old schema…\n");

  // ── 0. non-destructive reset: drop our own previous clean rows, then
  //       archive the remaining (original) products so the shop shows only
  //       the clean catalog. No transactional data is touched — clean
  //       variants are never referenced by orders/carts.
  await DST`DELETE FROM products WHERE erp_raw::text LIKE '%_clean%'`;
  const arch = await DST`
    UPDATE products SET status='archived' WHERE status <> 'archived' RETURNING id`;
  console.log(`  0. Archived ${arch.length} original products (kept for order history).`);

  // ── 1. school map: catalog_new.schools → inventre.schools ────────────────
  const srcSchools = await SRC`SELECT id, code, erp_name FROM schools`;
  const dstSchools = await DST`SELECT id, school_code, erp_name, slug FROM schools`;
  const dstByErp = new Map(dstSchools.filter((s) => s.erp_name).map((s) => [s.erp_name, s.id]));
  const dstByCode = new Map(dstSchools.filter((s) => s.school_code).map((s) => [s.school_code, s.id]));
  const schoolMap = new Map<string, string>();
  for (const s of srcSchools) {
    const dst = dstByErp.get(s.erp_name) || dstByCode.get(s.code);
    if (dst) schoolMap.set(s.id, dst);
  }
  console.log(`  1. School map: ${schoolMap.size}/${srcSchools.length} matched.`);

  // grade id → name
  const gradeMap = new Map((await SRC`SELECT id, name FROM grades`).map((g) => [g.id, g.name]));

  // ── 2. main items → products ─────────────────────────────────────────────
  const items = await SRC`
    SELECT i.id, i.item_code, i.name, i.kind, i.enabled, i.hsn_code, i.is_variant,
           i.parent_item_id,
           (SELECT min(price) FROM item_prices p WHERE p.item_id=i.id) price
    FROM items i`;
  const usedSlug = new Set<string>(dstSchools.map((s) => s.slug)); // avoid any clash
  for (const r of await DST`SELECT slug FROM products`) usedSlug.add(r.slug);

  const productMap = new Map<string, string>(); // src item id → dst product id
  const productRows: any[][] = [];
  for (const it of items.filter((x) => !x.is_variant)) {
    let slug = slugify(it.item_code);
    let s = slug, n = 2;
    while (usedSlug.has(s)) s = `${slug}-${n++}`;
    usedSlug.add(s);
    const pid = stableUuid("product:" + it.id);
    productMap.set(it.id, pid);
    productRows.push([
      pid, s, it.name, Math.round(Number(it.price) || 0), it.item_code,
      it.kind, it.enabled ? "active" : "archived", it.kind === "magic_box",
      it.hsn_code, it.id, { _clean: true },
    ]);
  }
  await insertChunked(DST, "products",
    ["id", "slug", "name", "base_price", "item_code", "kind", "status",
     "is_magic_box", "hsn_code", "erp_name", "erp_raw"],
    productRows);
  console.log(`  2. Products: ${productRows.length} inserted.`);

  // ── 3. variant items → product_variants ──────────────────────────────────
  const variants = items.filter((x) => x.is_variant && productMap.has(x.parent_item_id));
  // size = value of a "size" attribute, else item code
  const vAttr = await SRC`
    SELECT iva.item_id, v.value, a.name attr
    FROM item_variant_attributes iva
    JOIN item_attributes a ON a.id=iva.attribute_id
    JOIN item_attribute_values v ON v.id=iva.attribute_value_id`;
  const sizeOf = new Map<string, string>();
  for (const r of vAttr)
    if (/size/i.test(r.attr) && !sizeOf.has(r.item_id)) sizeOf.set(r.item_id, r.value);
  // SKU must be globally unique (incl. the archived old variants) — dedupe.
  const usedSku = new Set<string>(
    (await DST`SELECT sku FROM product_variants`).map((r) => r.sku)
  );
  const uniqSku = (base: string) => {
    let s = base, n = 2;
    while (usedSku.has(s)) s = `${base}-${n++}`;
    usedSku.add(s);
    return s;
  };
  const variantMap = new Map<string, string>();
  const variantRows: any[][] = [];
  for (const v of variants) {
    const vid = stableUuid("variant:" + v.id);
    variantMap.set(v.id, vid);
    variantRows.push([
      vid, productMap.get(v.parent_item_id), sizeOf.get(v.id) || v.item_code,
      uniqSku(v.item_code), v.enabled,
    ]);
  }
  // default variant for products that have no variant children
  const haveVariant = new Set(variants.map((v) => v.parent_item_id));
  for (const it of items.filter((x) => !x.is_variant && !haveVariant.has(x.id)))
    variantRows.push([
      stableUuid("variant:default:" + it.id),
      productMap.get(it.id), "Standard", uniqSku(it.item_code), it.enabled,
    ]);
  await insertChunked(DST, "product_variants",
    ["id", "product_id", "size", "sku", "is_active"], variantRows);
  console.log(`  3. Product variants: ${variantRows.length} (incl. default variants).`);

  // ── 4. images → product_images (main items) ──────────────────────────────
  const imgs = await SRC`SELECT item_id, url, is_primary, sort_order FROM item_images`;
  const imgRows = imgs
    .filter((im) => productMap.has(im.item_id))
    .map((im) => [uuid(), productMap.get(im.item_id), im.url, !!im.is_primary, im.sort_order || 0]);
  await insertChunked(DST, "product_images",
    ["id", "product_id", "url", "is_primary", "sort_order"], imgRows);
  console.log(`  4. Product images: ${imgRows.length}.`);

  // ── 5. item_school_grade_map → product_school + product_grades ───────────
  const isgm = await SRC`SELECT item_id, school_id, grade_id, is_required FROM item_school_grade_map`;
  const psSeen = new Set<string>();
  const psRows: any[][] = [];
  const pgSeen = new Set<string>();
  const pgRows: any[][] = [];
  for (const m of isgm) {
    const pid = productMap.get(m.item_id);
    const sid = schoolMap.get(m.school_id);
    if (!pid || !sid) continue;
    const psk = pid + sid;
    if (!psSeen.has(psk)) {
      psSeen.add(psk);
      psRows.push([uuid(), pid, sid, !!m.is_required]);
    }
    if (m.grade_id) {
      const gname = gradeMap.get(m.grade_id);
      const pgk = pid + "|" + gname;
      if (gname && !pgSeen.has(pgk)) {
        pgSeen.add(pgk);
        pgRows.push([pid, gname]);
      }
    }
  }
  await insertChunked(DST, "product_school",
    ["id", "product_id", "school_id", "is_required"], psRows);
  await insertChunked(DST, "product_grades", ["product_id", "grade"], pgRows);
  console.log(`  5. product_school: ${psRows.length} · product_grades: ${pgRows.length}.`);

  // ── 6. boms → product_bundles + bundle_components ────────────────────────
  const boms = await SRC`SELECT id, item_id FROM boms WHERE is_active`;
  const bundleMap = new Map<string, string>();
  const bundleRows: any[][] = [];
  for (const b of boms) {
    const pid = productMap.get(b.item_id);
    if (!pid || bundleMap.has(pid)) continue; // one bundle per product
    const bid = uuid();
    bundleMap.set(pid, bid);
    bundleMap.set("bom:" + b.id, bid);
    bundleRows.push([bid, pid, "fixed"]);
  }
  await insertChunked(DST, "product_bundles",
    ["id", "product_id", "bundle_type"], bundleRows);
  const bomItems = await SRC`SELECT bom_id, item_id, quantity FROM bom_items WHERE is_active`;
  const bcRows: any[][] = [];
  for (const bi of bomItems) {
    const bid = bundleMap.get("bom:" + bi.bom_id);
    const cpid = productMap.get(bi.item_id);
    if (bid && cpid) bcRows.push([uuid(), bid, cpid, Math.max(1, Math.round(Number(bi.quantity) || 1))]);
  }
  await insertChunked(DST, "bundle_components",
    ["id", "bundle_id", "product_id", "qty"], bcRows);
  console.log(`  6. product_bundles: ${bundleRows.length} · bundle_components: ${bcRows.length}.`);

  // ── 7. attributes → product_attributes / values / variant_attributes ─────
  // So drilling into a product shows each variant decoded to colour + size.
  await DST`DELETE FROM product_attribute_bindings`;
  await DST`DELETE FROM product_variant_attributes`;
  await DST`DELETE FROM product_attribute_values`;
  await DST`DELETE FROM product_attributes`;
  const srcAttrs = await SRC`SELECT id, name, is_numeric FROM item_attributes`;
  const attrMap = new Map<string, string>();
  const attrRows = srcAttrs.map((a) => {
    const id = uuid();
    attrMap.set(a.id, id);
    const nm = String(a.name || "").toLowerCase();
    const type = /colou?r/.test(nm) ? "color" : /size/.test(nm) ? "size" : "other";
    return [id, a.name, type, !!a.is_numeric];
  });
  await insertChunked(DST, "product_attributes",
    ["id", "name", "type", "is_numeric"], attrRows);

  const srcVals = await SRC`
    SELECT id, attribute_id, value, abbreviation, hex_color, sort_order
    FROM item_attribute_values`;
  const valMap = new Map<string, string>();
  const valRows: any[][] = [];
  for (const v of srcVals) {
    const aid = attrMap.get(v.attribute_id);
    if (!aid) continue;
    const id = uuid();
    valMap.set(v.id, id);
    valRows.push([id, aid, v.value, v.abbreviation, v.hex_color, v.sort_order || 0]);
  }
  await insertChunked(DST, "product_attribute_values",
    ["id", "attribute_id", "value", "display_label", "hex_color", "sort_order"], valRows);

  const srcIva = await SRC`
    SELECT item_id, attribute_id, attribute_value_id FROM item_variant_attributes`;
  const ivaRows: any[][] = [];
  const ivaSeen = new Set<string>();
  for (const r of srcIva) {
    const vid = variantMap.get(r.item_id);
    const aid = attrMap.get(r.attribute_id);
    const valid = valMap.get(r.attribute_value_id);
    if (!vid || !aid || !valid) continue;
    const k = vid + "|" + aid;
    if (ivaSeen.has(k)) continue;
    ivaSeen.add(k);
    ivaRows.push([vid, aid, valid]);
  }
  await insertChunked(DST, "product_variant_attributes",
    ["variant_id", "attribute_id", "value_id"], ivaRows);
  console.log(`  7. attributes: ${attrRows.length} · values: ${valRows.length} · variant-attributes: ${ivaRows.length}.`);

  // ── 8. variant prices → old item_prices ─────────────────────────────────
  // ERP prices each variant SKU individually; load them so the variants
  // editor and shop show a per-variation price.
  await DST`DELETE FROM item_prices`;
  const srcPL = await SRC`SELECT id, name FROM price_lists`;
  const dstPL = await DST`SELECT id, name FROM price_lists`;
  const dstPLByName = new Map(dstPL.map((p) => [p.name, p.id]));
  const defaultPL = dstPLByName.get("Standard Selling") || dstPL[0]?.id;
  const plMap = new Map(
    srcPL.map((p) => [p.id, dstPLByName.get(p.name) || defaultPL])
  );
  const srcPrices = await SRC`
    SELECT item_id, price_list_id, price, min_qty FROM item_prices`;
  const priceRows: any[][] = [];
  for (const p of srcPrices) {
    const vid = variantMap.get(p.item_id); // only variant-level prices
    const plid = plMap.get(p.price_list_id) || defaultPL;
    if (!vid || !plid) continue;
    priceRows.push([uuid(), vid, plid, p.price, p.min_qty || 0]);
  }
  await insertChunked(DST, "item_prices",
    ["id", "variant_id", "price_list_id", "price", "min_qty"], priceRows);
  console.log(`  8. variant prices: ${priceRows.length}.`);

  // ── 9. school grade labels → school_grade_labels ────────────────────────
  // Per-school "school-given grade name" for a uniform grade, so the admin
  // can show "Nursery (Grade 1)" etc. Stored in a small side table.
  await DST.unsafe(`
    CREATE TABLE IF NOT EXISTS school_grade_labels (
      school_id uuid NOT NULL,
      grade text NOT NULL,
      school_grade_name text NOT NULL,
      PRIMARY KEY (school_id, grade)
    )`);
  await DST`DELETE FROM school_grade_labels`;
  const srcSG = await SRC`
    SELECT school_id, organisation_grade_id, school_grade_name FROM school_grades`;
  const sgRows: any[][] = [];
  const sgSeen = new Set<string>();
  for (const r of srcSG) {
    const sid = schoolMap.get(r.school_id);
    const gname = gradeMap.get(r.organisation_grade_id);
    if (!sid || !gname || !r.school_grade_name) continue;
    const k = sid + "|" + gname;
    if (sgSeen.has(k)) continue;
    sgSeen.add(k);
    sgRows.push([sid, gname, r.school_grade_name]);
  }
  await insertChunked(DST, "school_grade_labels",
    ["school_id", "grade", "school_grade_name"], sgRows);
  console.log(`  9. school grade labels: ${sgRows.length}.`);

  const [{ active }] = await DST`SELECT count(*)::int active FROM products WHERE status='active'`;
  console.log(`\nDone. ${active} active products now in the old schema.`);
  await SRC.end();
  await DST.end();
}

main().catch((err) => {
  console.error("TRANSFORM FAILED:", err);
  process.exit(1);
});
