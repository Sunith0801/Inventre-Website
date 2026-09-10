/**
 * ERP item upserter.
 *
 * Pulls `/api/items/export` (lib/erp/items-feed.ts) and upserts into
 * `products` + `productVariants` + supporting relation tables.
 *
 * Strategy (two passes):
 *   1. For every item that is a template (`has_variants:true`) or a
 *      standalone (neither has_variants nor variant_of) → upsert a
 *      `products` row keyed by erp_name. Also upserts for variant items
 *      whose parent doesn't appear in the feed (orphans).
 *   2. For every item that is `variant_of:X` → upsert a `productVariants`
 *      row, storing `variantOfErpName` on it. After the loop, resolve
 *      `variantOfErpName` → `productId` via a single SQL UPDATE.
 *
 * Side effects per item:
 *   - Auto-creates `categories` rows for unknown `item_group`.
 *   - Auto-creates `schools` rows for unknown `effective.custom_school_name`.
 *   - Replaces `productSchool` links for the item.
 *   - Replaces `productGrades` rows from split `effective.custom_grade`.
 *   - Replaces `productImages` primary row from `effective.image_url`.
 *
 * Per session-decision (Override everything):
 *   - New products land as status="draft".
 *   - Always overwrites name/description/category/HSN/image (no
 *     per-field "locally edited" tracking in v1).
 *   - Ignores `custom_organization_mrp` (price stays admin-owned).
 *   - Hot-links images from audit.inventre.online (mirror to MinIO is
 *     a follow-up).
 */

import { db, schema } from "@/db/client";
import { and, eq, isNull, sql } from "drizzle-orm";
import { iterateItems, splitGrades, type ErpItem, type FeedConfig } from "@/server/erp/items-feed";
import { makeTargetedGradeResolver } from "@/server/repos/grades";

export type SyncReport = {
  scanned: number;
  productsInserted: number;
  productsUpdated: number;
  variantsInserted: number;
  variantsUpdated: number;
  schoolsCreated: number;
  categoriesCreated: number;
  variantsLinked: number;
  variantsOrphaned: number;
  failed: number;
  errors: { erpName: string; message: string }[];
  startedAt: string;
  finishedAt: string;
  durationMs: number;
};

export type SyncOptions = {
  pageSize?: number;
  itemGroup?: string;
  includeDeleted?: boolean;
  // Stop early after this many items — handy for ad-hoc testing.
  maxItems?: number;
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function getOrCreateCategoryId(
  name: string,
  cache: Map<string, string>,
  counters: { created: number }
): Promise<string> {
  const key = name.trim();
  if (cache.has(key)) return cache.get(key)!;
  const slug = slugify(key) || "uncategorised";
  const existing = await db
    .select({ id: schema.categories.id })
    .from(schema.categories)
    .where(eq(schema.categories.slug, slug))
    .limit(1);
  if (existing[0]) {
    cache.set(key, existing[0].id);
    return existing[0].id;
  }
  const [row] = await db
    .insert(schema.categories)
    .values({ slug, name: key, path: slug })
    .returning({ id: schema.categories.id });
  counters.created++;
  cache.set(key, row.id);
  return row.id;
}

async function getOrCreateSchoolId(
  codedName: string,
  cache: Map<string, string>,
  counters: { created: number }
): Promise<string> {
  const key = codedName.trim();
  if (cache.has(key)) return cache.get(key)!;
  // The feed sends labels like "TSUSC-TSUS Chennai" — preserve as `name`
  // and slug the whole thing.
  const slug = slugify(key) || "unknown-school";
  const existing = await db
    .select({ id: schema.schools.id })
    .from(schema.schools)
    .where(eq(schema.schools.slug, slug))
    .limit(1);
  if (existing[0]) {
    cache.set(key, existing[0].id);
    return existing[0].id;
  }
  const [row] = await db
    .insert(schema.schools)
    .values({
      slug,
      name: key,
      status: "onboarding",
    })
    .returning({ id: schema.schools.id });
  counters.created++;
  cache.set(key, row.id);
  return row.id;
}

async function syncOneProduct(
  it: ErpItem,
  caches: { cat: Map<string, string>; school: Map<string, string> },
  counters: {
    inserted: number;
    updated: number;
    schools: { created: number };
    cats: { created: number };
  }
): Promise<string> {
  const eff = it.effective;

  const categoryId = it.item_group
    ? await getOrCreateCategoryId(it.item_group, caches.cat, counters.cats)
    : null;

  const existing = await db
    .select({ id: schema.products.id })
    .from(schema.products)
    .where(eq(schema.products.erpName, it.erp_name))
    .limit(1);

  const baseSlug = slugify(it.erp_name) || `erp-${Math.random().toString(36).slice(2, 8)}`;

  // ERPNext lifecycle flags. Anything ERP marks `disabled` or
  // `is_deleted` is auto-archived on our side so it disappears from the
  // storefront (which filters status='active') and the new-student Magic
  // Box list. Re-enabling in ERP does NOT auto-revive — admin must flip
  // status back to active explicitly so accidental ERP toggles don't
  // surface stale items.
  const erpIsDisabled = it.disabled === 1 || it.disabled === true;
  const erpIsDeleted = it.is_deleted === true;
  const erpHidden = erpIsDisabled || erpIsDeleted;

  // Size chart — try the typed field first, then the raw bag (the ERP feed
  // contract is being extended; older feeds put it under `raw`). Skip the
  // column when neither is present so existing admin uploads aren't
  // overwritten by an absent ERP value.
  const sizeChartFromFeed =
    it.custom_size_chart ??
    ((it.raw && typeof it.raw === "object" && "custom_size_chart" in it.raw
      ? (it.raw as Record<string, unknown>).custom_size_chart
      : undefined) as string | undefined);

  let productId: string;
  if (existing[0]) {
    productId = existing[0].id;
    await db
      .update(schema.products)
      .set({
        name: it.item_name,
        categoryId,
        hsnCode: it.gst_hsn_code,
        erpSubCategory: it.custom_sub_category,
        erpUom: it.stock_uom,
        isStockItem: it.is_stock_item,
        erpIsDisabled,
        erpIsDeleted,
        // Auto-archive when ERP flips disabled/is_deleted. Skip the
        // status change when ERP says enabled — admin owns reactivation.
        ...(erpHidden ? { status: "archived" as const } : {}),
        // Size chart — only overwrite when ERP supplies one. Empty / null
        // from ERP must NOT wipe an admin-uploaded chart.
        ...(typeof sizeChartFromFeed === "string" && sizeChartFromFeed
          ? { sizeChartUrl: sizeChartFromFeed }
          : {}),
        erpRaw: it.raw,
        lastErpSyncAt: new Date(),
      })
      .where(eq(schema.products.id, productId));
    counters.updated++;
  } else {
    // Ensure slug uniqueness — if a non-ERP product already grabbed our slug,
    // suffix with a short hash of the ERP name.
    let slug = baseSlug;
    const slugClash = await db
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(eq(schema.products.slug, slug))
      .limit(1);
    if (slugClash[0]) {
      slug = `${baseSlug}-${it.erp_name.length.toString(36)}${baseSlug.length.toString(36)}`;
    }
    const [row] = await db
      .insert(schema.products)
      .values({
        slug,
        name: it.item_name,
        // ERP-hidden items land archived directly; everything else is
        // draft until admin activates.
        status: erpHidden ? ("archived" as const) : ("draft" as const),
        categoryId,
        basePrice: 0, // admin sets the real price
        hsnCode: it.gst_hsn_code,
        erpName: it.erp_name,
        erpSubCategory: it.custom_sub_category,
        erpUom: it.stock_uom,
        isStockItem: it.is_stock_item,
        erpIsDisabled,
        erpIsDeleted,
        ...(typeof sizeChartFromFeed === "string" && sizeChartFromFeed
          ? { sizeChartUrl: sizeChartFromFeed }
          : {}),
        erpRaw: it.raw,
        lastErpSyncAt: new Date(),
      })
      .returning({ id: schema.products.id });
    productId = row.id;
    counters.inserted++;
  }

  // School link — replace.
  await db.delete(schema.productSchool).where(eq(schema.productSchool.productId, productId));
  if (eff.custom_school_name) {
    const schoolId = await getOrCreateSchoolId(
      eff.custom_school_name,
      caches.school,
      counters.schools
    );
    await db.insert(schema.productSchool).values({ productId, schoolId }).onConflictDoNothing();
  }

  // Grades — replace.
  //
  // `effective.custom_grade` ships ERP's "Uniform Grade" CSV (e.g. "Grade
  // 8, Grade 9"). Translate each value to the canonical Targeted-Grade
  // vocabulary (Nursery / LKG / UKG / Grade 1..12) so the shop filter
  // — which joins `product_grades.grade = students.grade` — lines up with
  // student-facing labels. School-given local names (e.g. "Class 5",
  // "JKG") are resolved via `school_grade_mappings` inside the helper.
  //
  // When a product has no school link, or the school's mapping table
  // doesn't cover the supplied value, the raw ERP value is kept so the
  // tag isn't silently lost.
  await db.delete(schema.productGrades).where(eq(schema.productGrades.productId, productId));
  const grades = splitGrades(eff.custom_grade);
  if (grades.length > 0) {
    const schoolRows = await db
      .select({ schoolId: schema.productSchool.schoolId })
      .from(schema.productSchool)
      .where(eq(schema.productSchool.productId, productId));
    const schoolIds = schoolRows.map((r) => r.schoolId);

    const targeted = new Set<string>();
    if (schoolIds.length === 0) {
      for (const g of grades) targeted.add(g);
    } else {
      for (const sid of schoolIds) {
        const resolver = await makeTargetedGradeResolver(sid);
        for (const g of grades) targeted.add(resolver(g) ?? g);
      }
    }

    await db
      .insert(schema.productGrades)
      .values(Array.from(targeted, (grade) => ({ productId, grade })))
      .onConflictDoNothing();
  }

  // Primary image — idempotent vs the rehoster. If a primary row already
  // exists pointing at the SAME upstream erp_source_url, leave it alone
  // (its `url` may already be the local mirror; we mustn't overwrite that).
  // Otherwise replace.
  if (eff.image_url) {
    const existingPrimary = await db
      .select({
        id: schema.productImages.id,
        erpSourceUrl: schema.productImages.erpSourceUrl,
      })
      .from(schema.productImages)
      .where(
        and(
          eq(schema.productImages.productId, productId),
          eq(schema.productImages.isPrimary, true)
        )
      )
      .limit(1);
    const sameUpstream =
      existingPrimary[0]?.erpSourceUrl === eff.image_url;
    if (!sameUpstream) {
      await db
        .delete(schema.productImages)
        .where(
          and(
            eq(schema.productImages.productId, productId),
            eq(schema.productImages.isPrimary, true)
          )
        );
      await db.insert(schema.productImages).values({
        productId,
        url: eff.image_url,
        erpSourceUrl: eff.image_url,
        alt: it.item_name,
        isPrimary: true,
        sortOrder: 0,
      });
    }
  }

  return productId;
}

/**
 * Best-effort cleaning of a variant's axis value from its item_name.
 * The feed does not ship structured (attribute, value) pairs, so we
 * strip the parent template's display name prefix and trailing legacy
 * separators ($, $$, $$$).
 *
 *   parent="Boys Pant"  item="Boys Pant22$$"  -> "22"
 *   parent="Navy Belt"  item="Navy BeltL$$$"  -> "L"
 *
 * If no prefix match we keep the raw item_name (capped) so the row is
 * still inserted — a later admin pass can fix.
 */
function cleanVariantSize(itemName: string, parentDisplayName: string | null): string {
  const raw = itemName ?? "";
  let s = raw;
  if (parentDisplayName && raw.startsWith(parentDisplayName)) {
    s = raw.slice(parentDisplayName.length);
  }
  s = s.replace(/^[-_\s]+/, "");
  s = s.replace(/\${1,3}$/, "");
  s = s.trim();
  return (s || raw).slice(0, 100);
}

async function syncOneVariant(
  it: ErpItem,
  parentErpName: string,
  parentProductId: string,
  parentDisplayName: string | null,
  counters: { inserted: number; updated: number }
): Promise<void> {
  const sku = it.erp_name;
  const existing = await db
    .select({ id: schema.productVariants.id, size: schema.productVariants.size })
    .from(schema.productVariants)
    .where(eq(schema.productVariants.erpName, it.erp_name))
    .limit(1);

  const cleanedSize = cleanVariantSize(it.item_name, parentDisplayName);

  if (existing[0]) {
    // Only overwrite `size` if the existing row's value is still the
    // raw item_name shape (admin or cleaner hasn't touched it). This
    // preserves manual edits and the post-import cleanup.
    const sizeLooksUncleaned =
      existing[0].size === it.item_name ||
      existing[0].size.startsWith(parentDisplayName ?? "");
    await db
      .update(schema.productVariants)
      .set({
        productId: parentProductId,
        sku,
        variantOfErpName: parentErpName,
        ...(sizeLooksUncleaned ? { size: cleanedSize } : {}),
      })
      .where(eq(schema.productVariants.id, existing[0].id));
    counters.updated++;
  } else {
    // SKU collision guard — `variants_sku_idx` is unique.
    const skuClash = await db
      .select({ id: schema.productVariants.id })
      .from(schema.productVariants)
      .where(eq(schema.productVariants.sku, sku))
      .limit(1);
    if (skuClash[0]) {
      // SKU exists under a different erpName — adopt the row.
      await db
        .update(schema.productVariants)
        .set({
          productId: parentProductId,
          erpName: it.erp_name,
          variantOfErpName: parentErpName,
        })
        .where(eq(schema.productVariants.id, skuClash[0].id));
      counters.updated++;
      return;
    }
    await db.insert(schema.productVariants).values({
      productId: parentProductId,
      size: cleanedSize,
      sku,
      erpName: it.erp_name,
      variantOfErpName: parentErpName,
    });
    counters.inserted++;
  }
}

export async function runErpItemSync(opts: SyncOptions = {}, cfg: FeedConfig = {}): Promise<SyncReport> {
  const startedAt = new Date();
  const startMs = Date.now();
  const caches = { cat: new Map<string, string>(), school: new Map<string, string>() };

  // Pass 1 collects all items so we can deterministically order templates
  // before variants. The full feed is ~6107 items; storing them in memory
  // is fine.
  const items: ErpItem[] = [];
  let scanned = 0;
  for await (const it of iterateItems(
    {
      pageSize: opts.pageSize ?? 1000,
      itemGroup: opts.itemGroup,
      includeDeleted: opts.includeDeleted,
    },
    cfg
  )) {
    items.push(it);
    scanned++;
    if (opts.maxItems && scanned >= opts.maxItems) break;
  }

  // Templates and standalones first.
  const templatesAndStandalone = items.filter((it) => !it.variant_of);
  const variants = items.filter((it) => it.variant_of);

  const productCounters = {
    inserted: 0,
    updated: 0,
    schools: { created: 0 },
    cats: { created: 0 },
  };
  const errors: SyncReport["errors"] = [];

  for (const it of templatesAndStandalone) {
    try {
      await syncOneProduct(it, caches, productCounters);
    } catch (e) {
      errors.push({
        erpName: it.erp_name,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // Pass 2: variants. Resolve their parent product id by erp_name.
  const variantCounters = { inserted: 0, updated: 0 };
  let orphaned = 0;
  for (const it of variants) {
    try {
      const parent = await db
        .select({ id: schema.products.id, name: schema.products.name })
        .from(schema.products)
        .where(eq(schema.products.erpName, it.variant_of!))
        .limit(1);
      if (!parent[0]) {
        // Parent absent from the feed — synthesise a placeholder product so
        // we don't lose the variant. Admin can clean up later.
        const placeholderName = it.variant_of!;
        const slug = slugify(placeholderName) || `erp-orphan-${Math.random().toString(36).slice(2, 8)}`;
        const [row] = await db
          .insert(schema.products)
          .values({
            slug,
            name: placeholderName,
            status: "draft",
            basePrice: 0,
            erpName: placeholderName,
            erpRaw: { _synthesised_for_orphan_variant: true, parent_of: it.erp_name },
            lastErpSyncAt: new Date(),
            isStockItem: true,
          })
          .onConflictDoNothing({ target: schema.products.erpName })
          .returning({ id: schema.products.id });
        let parentId = row?.id;
        if (!parentId) {
          const refetch = await db
            .select({ id: schema.products.id })
            .from(schema.products)
            .where(eq(schema.products.erpName, placeholderName))
            .limit(1);
          parentId = refetch[0]?.id;
        }
        if (!parentId) {
          orphaned++;
          continue;
        }
        await syncOneVariant(it, placeholderName, parentId, placeholderName, variantCounters);
        orphaned++;
      } else {
        await syncOneVariant(it, it.variant_of!, parent[0].id, parent[0].name, variantCounters);
      }
    } catch (e) {
      errors.push({
        erpName: it.erp_name,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // Backfill: catch any pre-existing variants whose variantOfErpName matches
  // a product erpName but whose productId is wrong/stale.
  const linkResult = await db.execute(sql`
    UPDATE product_variants v
       SET product_id = p.id
      FROM products p
     WHERE v.variant_of_erp_name IS NOT NULL
       AND p.erp_name = v.variant_of_erp_name
       AND v.product_id <> p.id
  `);
  const variantsLinked = (linkResult as unknown as { count?: number }).count ?? 0;

  const finishedAt = new Date();
  return {
    scanned,
    productsInserted: productCounters.inserted,
    productsUpdated: productCounters.updated,
    variantsInserted: variantCounters.inserted,
    variantsUpdated: variantCounters.updated,
    schoolsCreated: productCounters.schools.created,
    categoriesCreated: productCounters.cats.created,
    variantsLinked,
    variantsOrphaned: orphaned,
    failed: errors.length,
    errors: errors.slice(0, 20), // cap to keep the job payload bounded
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: Date.now() - startMs,
  };
}
