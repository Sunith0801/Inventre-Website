import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { z } from "zod";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  products,
  productVariants,
  productSchool,
  productAttributes,
  productVariantAttributes,
  productAttributeValues,
  itemPrices,
  priceLists,
} from "@/db/schema";
import { isResponse, requirePermission } from "@/lib/admin-guard";
import { invalidateCatalog } from "@/lib/cache";
import { getSizeAxisNameForProduct } from "@/lib/repos/product-attribute-groups";
import { normalizeAttributeName } from "@/lib/normalize-attribute-name";

const Variant = z.object({
  id: z.string().uuid().optional(),
  size: z.string().min(1),
  sku: z.string().min(1),
  stockQty: z.number().int().min(0),
  colorValueId: z.string().uuid().nullable().optional(),
  /** Selling price in paise. null clears it; undefined leaves it. */
  price: z.number().int().min(0).nullable().optional(),
});

const SpecRow = z.object({ label: z.string().min(1), value: z.string().min(1) });
const SizeRow = z.object({
  size: z.string().min(1),
  chest: z.string().default(""),
  length: z.string().default(""),
  sleeve: z.string().default(""),
});

const Body = z.object({
  name: z.string().optional(),
  slug: z.string().optional(),
  tagline: z.string().nullable().optional(),
  basePrice: z.number().int().min(0).optional(),
  baseMrp: z.number().int().min(0).nullable().optional(),
  categoryId: z.string().nullable().optional(),
  status: z.enum(["draft", "active", "archived"]).optional(),
  variants: z.array(Variant).optional(),
  // Audit-aligned extras
  itemCode: z.string().nullable().optional(),
  hsnCode: z.string().nullable().optional(),
  gstTreatment: z
    .enum(["taxable", "nil_rated", "exempt", "non_gst", "zero_rated"])
    .optional(),
  gstInclusive: z.boolean().optional(),
  brand: z.string().nullable().optional(),
  displayPrice: z.number().int().min(0).nullable().optional(),
  costPrice: z.number().int().min(0).nullable().optional(),
  organizationMrp: z.number().int().min(0).nullable().optional(),
  customerDiscountPercent: z.number().min(0).max(100).nullable().optional(),
  weightGrams: z.number().int().min(0).nullable().optional(),
  minOrderQty: z.number().int().min(1).optional(),
  isMagicBox: z.boolean().optional(),
  // BOM-hierarchy classification + variant linkage (Phase 5 / 6)
  bundleLevel: z.enum(["magic_box", "bookkit", "sub_bundle", "leaf"]).nullable().optional(),
  bundleGender: z.enum(["Boys", "Girls"]).nullable().optional(),
  isVariantItem: z.boolean().optional(),
  variantOfProductId: z.string().uuid().nullable().optional(),
  variantAttribute: z.string().nullable().optional(),
  variantAttributeValue: z.string().nullable().optional(),
  attributeGroups: z
    .array(z.object({ name: z.string(), values: z.array(z.string()) }))
    .nullable()
    .optional(),
  // PDP storefront content (was missing — admin couldn't edit what customers see)
  description: z.array(z.string().min(1)).nullable().optional(),
  specs: z.array(SpecRow).nullable().optional(),
  sizeTable: z.array(SizeRow).nullable().optional(),
  sizeChartUrl: z.string().url().nullable().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission("catalog.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;

  const update: Record<string, unknown> = {};
  if (body.name !== undefined) update.name = body.name;
  if (body.slug !== undefined) update.slug = body.slug;
  if (body.tagline !== undefined) update.tagline = body.tagline || null;
  if (body.basePrice !== undefined) update.basePrice = body.basePrice * 100;
  if (body.baseMrp !== undefined)
    update.baseMrp = body.baseMrp != null ? body.baseMrp * 100 : null;
  if (body.categoryId !== undefined)
    update.categoryId = body.categoryId || null;
  if (body.status !== undefined) update.status = body.status;
  if (body.itemCode !== undefined) update.itemCode = body.itemCode || null;
  if (body.hsnCode !== undefined) update.hsnCode = body.hsnCode || null;
  if (body.gstTreatment !== undefined) update.gstTreatment = body.gstTreatment;
  if (body.gstInclusive !== undefined) update.gstInclusive = body.gstInclusive;
  if (body.brand !== undefined) update.brand = body.brand || null;
  if (body.displayPrice !== undefined) update.displayPrice = body.displayPrice;
  if (body.costPrice !== undefined) update.costPrice = body.costPrice;
  if (body.organizationMrp !== undefined)
    update.organizationMrp = body.organizationMrp;
  if (body.customerDiscountPercent !== undefined)
    update.customerDiscountPercent =
      body.customerDiscountPercent != null
        ? String(body.customerDiscountPercent)
        : null;
  if (body.weightGrams !== undefined) update.weightGrams = body.weightGrams;
  if (body.minOrderQty !== undefined) update.minOrderQty = body.minOrderQty;
  if (body.isMagicBox !== undefined) update.isMagicBox = body.isMagicBox;
  if (body.bundleLevel !== undefined) update.bundleLevel = body.bundleLevel;
  if (body.bundleGender !== undefined) update.bundleGender = body.bundleGender;
  if (body.isVariantItem !== undefined) update.isVariantItem = body.isVariantItem;
  if (body.variantOfProductId !== undefined)
    update.variantOfProductId = body.variantOfProductId;
  if (body.variantAttribute !== undefined)
    update.variantAttribute = body.variantAttribute;
  if (body.variantAttributeValue !== undefined)
    update.variantAttributeValue = body.variantAttributeValue;
  if (body.attributeGroups !== undefined)
    update.attributeGroups = body.attributeGroups;
  if (body.description !== undefined) update.description = body.description;
  if (body.specs !== undefined) update.specs = body.specs;
  if (body.sizeTable !== undefined) update.sizeTable = body.sizeTable;
  if (body.sizeChartUrl !== undefined)
    update.sizeChartUrl = body.sizeChartUrl || null;

  // Snapshot the pre-update base price: the itemPrices propagation below
  // must fire only when the admin actually CHANGED it. The Basics/Pricing
  // form always includes basePrice in its payload, so an unconditional
  // propagation stomps per-variant prices (saved minutes earlier through
  // the variants editor) back to the stale base on every unrelated save —
  // that's how SMS Caps/Belt kept reverting to ₹0.
  let priorBasePricePaise: number | null = null;
  if (body.basePrice !== undefined) {
    const [prior] = await db
      .select({ basePrice: products.basePrice })
      .from(products)
      .where(eq(products.id, id))
      .limit(1);
    priorBasePricePaise = prior?.basePrice ?? null;
  }

  if (Object.keys(update).length > 0)
    await db.update(products).set(update).where(eq(products.id, id));

  // When basePrice changes, propagate to itemPrices for every active variant
  // on the default ("Standard Selling") price list at the global (schoolId
  // IS NULL) scope. The storefront resolver prefers itemPrices over
  // products.basePrice, so without this sync a Magic Box / Bookkit price
  // edited here would never surface on the shop or cart. School-specific
  // overrides (itemPrices rows with non-null schoolId) are left untouched
  // so per-school pricing keeps working.
  if (body.basePrice !== undefined && body.basePrice * 100 !== priorBasePricePaise) {
    const newPricePaise = body.basePrice * 100;
    const [defaultPL] = await db
      .select({ id: priceLists.id })
      .from(priceLists)
      .where(eq(priceLists.isDefault, true))
      .limit(1);
    if (defaultPL) {
      const activeVariants = await db
        .select({ id: productVariants.id })
        .from(productVariants)
        .where(
          and(
            eq(productVariants.productId, id),
            eq(productVariants.isActive, true)
          )
        );
      for (const v of activeVariants) {
        const existing = await db
          .select({ id: itemPrices.id })
          .from(itemPrices)
          .where(
            and(
              eq(itemPrices.variantId, v.id),
              eq(itemPrices.priceListId, defaultPL.id),
              sql`${itemPrices.schoolId} IS NULL`
            )
          )
          .limit(1);
        if (existing.length > 0) {
          await db
            .update(itemPrices)
            .set({ price: newPricePaise })
            .where(eq(itemPrices.id, existing[0].id));
        } else {
          await db.insert(itemPrices).values({
            variantId: v.id,
            priceListId: defaultPL.id,
            schoolId: null,
            price: newPricePaise,
          });
        }
      }
    }
  }

  // Variant sync — soft-delete model: rows missing from the incoming list are
  // marked isActive=false so historical orderItems / shipmentItems / etc keep
  // their FK references intact. Hard delete would FK-violate on any variant
  // that's ever been sold.
  if (body.variants) {
    const existing = await db
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(eq(productVariants.productId, id));
    const incomingIds = new Set(
      body.variants.filter((v) => v.id).map((v) => v.id!)
    );
    const toDeactivate = existing
      .filter((e) => !incomingIds.has(e.id))
      .map((e) => e.id);
    if (toDeactivate.length) {
      await db
        .update(productVariants)
        .set({ isActive: false })
        .where(inArray(productVariants.id, toDeactivate));
    }

    // Selling price list — variant prices are stored against it.
    const [sellPL] = await db
      .select({ id: priceLists.id })
      .from(priceLists)
      .where(eq(priceLists.name, "Standard Selling"))
      .limit(1);

    try {
      for (const v of body.variants) {
        // Look up the colour value (label + attribute id) up front so we
        // can both EAV-link the variant AND auto-clean the size column.
        // The editor's Size input is free text — admins have been typing
        // composite labels like "green · 24" into it because the input
        // gives them no hint that Colour is already a separate axis. We
        // strip a leading "<colour> · " prefix so the legacy size column
        // stays canonical even when the input was polluted.
        let colourVal: { attributeId: string; value: string } | null = null;
        if (v.colorValueId) {
          const [row] = await db
            .select({
              attributeId: productAttributeValues.attributeId,
              value: productAttributeValues.value,
            })
            .from(productAttributeValues)
            .where(eq(productAttributeValues.id, v.colorValueId))
            .limit(1);
          colourVal = row ?? null;
        }
        const cleanSize = (() => {
          const raw = (v.size ?? "").trim();
          if (!colourVal) return raw;
          // Match "<colour> · <rest>" case-insensitively, allowing either
          // the middle-dot (·) or a plain hyphen with surrounding spaces.
          // Keep one round of stripping — never recurse.
          const sep = /\s*[·\-–—]\s*/;
          const tryStrip = (label: string) => {
            const re = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${sep.source}`, "i");
            return raw.replace(re, "");
          };
          const stripped = tryStrip(colourVal.value);
          return stripped !== raw ? stripped : raw;
        })();

        let variantId = v.id;
        if (v.id) {
          await db
            .update(productVariants)
            .set({
              size: cleanSize,
              sku: v.sku,
              stockQty: v.stockQty,
              isActive: true,
            })
            .where(eq(productVariants.id, v.id));
        } else {
          // INSERT path. The `product_variants.sku` index is a GLOBAL
          // UNIQUE — soft-deleted rows still occupy their SKU. When an
          // admin removes a row from the editor and later re-adds the
          // same SKU (common workflow: "oh I deleted that by mistake"),
          // the raw INSERT would fail with a duplicate-key error and the
          // whole save would abort, blocking the re-derivation and the
          // PDP fix from landing. Detect that case here and reactivate
          // the existing row instead of failing.
          const [resurrectable] = await db
            .select({ id: productVariants.id })
            .from(productVariants)
            .where(
              and(
                eq(productVariants.productId, id),
                eq(productVariants.sku, v.sku),
                eq(productVariants.isActive, false),
              ),
            )
            .limit(1);
          if (resurrectable) {
            await db
              .update(productVariants)
              .set({
                size: cleanSize,
                stockQty: v.stockQty,
                isActive: true,
              })
              .where(eq(productVariants.id, resurrectable.id));
            variantId = resurrectable.id;
          } else {
            const [ins] = await db
              .insert(productVariants)
              .values({
                productId: id,
                size: cleanSize,
                sku: v.sku,
                stockQty: v.stockQty,
                isActive: true,
              })
              .returning({ id: productVariants.id });
            variantId = ins.id;
          }
        }
        // Persist the editable colour → product_variant_attributes. We
        // looked up the attribute id above so we don't pay for a second
        // round-trip here.
        if (variantId && v.colorValueId && colourVal) {
          await db
            .insert(productVariantAttributes)
            .values({
              variantId,
              attributeId: colourVal.attributeId,
              valueId: v.colorValueId,
            })
            .onConflictDoUpdate({
              target: [
                productVariantAttributes.variantId,
                productVariantAttributes.attributeId,
              ],
              set: { valueId: v.colorValueId },
            });
        }
        // Persist the editable price → item_prices (Standard Selling list).
        if (variantId && v.price !== undefined && sellPL) {
          await db
            .delete(itemPrices)
            .where(
              and(
                eq(itemPrices.variantId, variantId),
                eq(itemPrices.priceListId, sellPL.id)
              )
            );
          if (v.price !== null) {
            await db.insert(itemPrices).values({
              variantId,
              priceListId: sellPL.id,
              price: v.price,
            });
          }
        }
      }
    } catch (e) {
      // Unique-constraint violation on sku → return 409 instead of opaque 500.
      // The most common collision (a soft-deleted variant of the *same*
      // product holding the SKU) is now auto-healed in the INSERT path
      // above. If we land here it's almost always a different product
      // already owning the SKU — surface that explicitly so the admin
      // knows to pick a unique value, not to keep clicking Save.
      const msg = e instanceof Error ? e.message : "";
      if (/duplicate key|variants_sku_idx|unique/i.test(msg)) {
        const m = msg.match(/Key \(sku\)=\(([^)]+)\)/i);
        const conflictingSku = m?.[1];
        return NextResponse.json(
          {
            error: conflictingSku
              ? `SKU "${conflictingSku}" is already used by another product. Each SKU must be unique across the whole catalog — please pick a different code (e.g. add a school or category prefix).`
              : "One of the SKUs you entered is already used by another product. Each SKU must be unique across the whole catalog.",
            details: msg,
          },
          { status: 409 }
        );
      }
      throw e;
    }

    // Re-derive products.attributeGroups from the current variant set so the
    // PDP size/colour picker auto-includes any new size or colour value the
    // admin just added. Skip if the request explicitly set attributeGroups
    // (admin took manual control).
    if (body.attributeGroups === undefined) {
      // Size group comes from the legacy `product_variants.size` column.
      const sizeRows = await db
        .select({ size: productVariants.size })
        .from(productVariants)
        .where(
          and(eq(productVariants.productId, id), eq(productVariants.isActive, true))
        );
      const sizes = Array.from(
        new Set(sizeRows.map((r) => r.size).filter((s): s is string => Boolean(s)))
      );

      // Every other axis (Color, Design, Model, …) comes from
      // product_variant_attributes joined through product_attributes —
      // grouped by the *attribute's name + type* so we never mash values
      // from different attributes into a single picker. Skip the
      // pseudo-"size" attribute (the legacy size column already covers it).
      const attrRows = await db
        .select({
          attrId: productAttributes.id,
          attrName: productAttributes.name,
          attrType: productAttributes.type,
          attrSort: productAttributes.sortOrder,
          value: productAttributeValues.value,
          valueSort: productAttributeValues.sortOrder,
        })
        .from(productVariantAttributes)
        .innerJoin(
          productVariants,
          eq(productVariants.id, productVariantAttributes.variantId)
        )
        .innerJoin(
          productAttributeValues,
          eq(productAttributeValues.id, productVariantAttributes.valueId)
        )
        .innerJoin(
          productAttributes,
          eq(productAttributes.id, productVariantAttributes.attributeId)
        )
        .where(
          and(eq(productVariants.productId, id), eq(productVariants.isActive, true))
        );

      // Bucket EAV rows by *normalised* attribute name so two equivalent
      // attribute rows (e.g. "Size" + "Sizes", or "Color" + "Colour")
      // collapse into one axis. The old code bucketed by `attrId` which
      // produced the doubled-Size symptom on inventre-dev when admin had
      // both rows bound to a product's variants. Note: we no longer skip
      // type='size' rows here — the legacy `productVariants.size` column
      // is merged into the same normalised "size" bucket below, so EAV
      // size rows participate in the merge without duplicating.
      type Bucket = {
        normalizedKey: string;
        displayName: string;
        attrSort: number;
        attributeIds: Set<string>;
        values: { value: string; sort: number }[];
        seen: Set<string>;
      };
      const buckets = new Map<string, Bucket>();
      for (const r of attrRows) {
        if (!r.value) continue;
        const key = normalizeAttributeName(r.attrName);
        let bucket = buckets.get(key);
        if (!bucket) {
          bucket = {
            normalizedKey: key,
            displayName: r.attrName,
            attrSort: r.attrSort ?? 0,
            attributeIds: new Set<string>(),
            values: [],
            seen: new Set<string>(),
          };
          buckets.set(key, bucket);
        }
        // Prefer the type='size' attribute's display name for the size axis
        // (matches MultiAttributePicker's expected key) when the first row
        // we saw used a different display label.
        if (r.attrType === "size" && bucket.displayName !== r.attrName) {
          bucket.displayName = r.attrName;
        }
        bucket.attributeIds.add(r.attrId);
        if ((r.attrSort ?? 0) < bucket.attrSort) bucket.attrSort = r.attrSort ?? 0;
        if (!bucket.seen.has(r.value)) {
          bucket.seen.add(r.value);
          bucket.values.push({ value: r.value, sort: r.valueSort ?? 0 });
        }
      }

      // Decide what to do with the legacy `product_variants.size` column.
      //
      // Variant rows now arrive here already cleaned (the loop above
      // stripped any `<colour> · ` prefix). That means legacy values are
      // trustworthy — they can be unioned into the EAV size bucket so a
      // newly added size (e.g. white·30 added in the variants editor
      // without yet being declared as an EAV value) still shows on the
      // PDP picker. Three cases:
      //
      //   1. An EAV size axis already exists in `buckets` (under its own
      //      normalised name — e.g. "tshirt size" for "Tshirt Size") →
      //      MERGE legacy values into that bucket. Keep EAV's display
      //      name + ordering hints. Dedupe by the `seen` set so values
      //      shared by both layers don't duplicate.
      //   2. No EAV size axis, and no other EAV axes → emit legacy as a
      //      "Size" axis. Preserves behaviour for ~2,100 legacy-only
      //      products with no EAV metadata at all.
      //   3. No EAV size axis, BUT other EAV axes exist → skip the legacy
      //      size column entirely. Prevents a phantom Size axis on products
      //      whose `product_variants.size` carries non-size data (e.g. CAS
      //      bookkit parents where `size` is a sibling product name).
      if (sizes.length > 0) {
        const eavSizeName = await getSizeAxisNameForProduct(id);
        const eavSizeKey = eavSizeName ? normalizeAttributeName(eavSizeName) : null;
        const sizeBucket = eavSizeKey ? buckets.get(eavSizeKey) : undefined;
        if (sizeBucket) {
          // Case 1: union legacy into EAV bucket.
          for (const sz of sizes) {
            if (!sizeBucket.seen.has(sz)) {
              sizeBucket.seen.add(sz);
              sizeBucket.values.push({ value: sz, sort: 0 });
            }
          }
        } else {
          // Case 2 or 3: no EAV size bucket present → emit legacy on its own.
          const otherCount = buckets.size;
          const displayName =
            eavSizeName ?? (otherCount === 0 ? "Size" : null);
          if (displayName !== null) {
            const key = eavSizeKey ?? "size";
            buckets.set(key, {
              normalizedKey: key,
              displayName,
              attrSort: 0,
              attributeIds: new Set<string>(),
              values: sizes.map((sz) => ({ value: sz, sort: 0 })),
              seen: new Set<string>(sizes),
            });
          }
        }
      }

      // Surface bad catalog data: any normalised axis backed by more than
      // one underlying attribute row means admin has equivalent attributes
      // (e.g. "Size" + "Sizes") that should be merged into one. We keep
      // the PATCH succeeding — the merge produces the correct group — but
      // log so the duplicate can be cleaned at the source.
      for (const b of buckets.values()) {
        if (b.attributeIds.size > 1) {
          console.warn(
            `[attribute-groups] product=${id}: merged ${b.attributeIds.size} attribute rows into one '${b.displayName}' axis (normalized='${b.normalizedKey}', attribute_ids=${Array.from(b.attributeIds).join(",")})`,
          );
        }
      }

      const groups = Array.from(buckets.values())
        .sort((a, b) => a.attrSort - b.attrSort || a.displayName.localeCompare(b.displayName))
        .map((b) => ({
          name: b.displayName,
          values: b.values
            .sort((x, y) => x.sort - y.sort || x.value.localeCompare(y.value))
            .map((v) => v.value),
        }));

      await db
        .update(products)
        .set({ attributeGroups: groups.length > 0 ? groups : null })
        .where(eq(products.id, id));
    }
  }

  // Flush all product caches so changes are visible immediately on the storefront.
  await invalidateCatalog();

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission("catalog.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;

  // Refuse if any cart or order line references a variant of this product —
  // deleting would cascade-drop those rows and corrupt parent baskets /
  // historical orders.
  const refs = (await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM cart_items ci
        JOIN product_variants v ON v.id = ci.variant_id
        WHERE v.product_id = ${id}) AS cart_refs,
      (SELECT COUNT(*) FROM order_items oi
        JOIN product_variants v ON v.id = oi.variant_id
        WHERE v.product_id = ${id}) AS order_refs
  `)) as unknown as { cart_refs: string; order_refs: string }[];
  const cartRefs = Number(refs[0]?.cart_refs ?? 0);
  const orderRefs = Number(refs[0]?.order_refs ?? 0);
  if (cartRefs > 0 || orderRefs > 0) {
    return NextResponse.json(
      {
        error: `Cannot delete — referenced by ${cartRefs} cart line(s) and ${orderRefs} order line(s). Archive the product instead.`,
      },
      { status: 409 },
    );
  }

  await db.delete(products).where(eq(products.id, id));
  // Flush product caches so the deleted product disappears from the shop
  // immediately rather than waiting for the TTL to expire.
  await invalidateCatalog();
  return NextResponse.json({ ok: true });
}
