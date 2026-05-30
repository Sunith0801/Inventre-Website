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
import { requireAdmin, isResponse } from "@/lib/admin-guard";
import { invalidateCatalog } from "@/lib/cache";
import { getSizeAxisNameForProduct } from "@/lib/repos/product-attribute-groups";

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
  const guard = await requireAdmin("super");
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

  if (Object.keys(update).length > 0)
    await db.update(products).set(update).where(eq(products.id, id));

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
        let variantId = v.id;
        if (v.id) {
          await db
            .update(productVariants)
            .set({
              size: v.size,
              sku: v.sku,
              stockQty: v.stockQty,
              isActive: true,
            })
            .where(eq(productVariants.id, v.id));
        } else {
          const [ins] = await db
            .insert(productVariants)
            .values({
              productId: id,
              size: v.size,
              sku: v.sku,
              stockQty: v.stockQty,
              isActive: true,
            })
            .returning({ id: productVariants.id });
          variantId = ins.id;
        }
        // Persist the editable colour → product_variant_attributes.
        if (variantId && v.colorValueId) {
          const [val] = await db
            .select({ attributeId: productAttributeValues.attributeId })
            .from(productAttributeValues)
            .where(eq(productAttributeValues.id, v.colorValueId))
            .limit(1);
          if (val) {
            await db
              .insert(productVariantAttributes)
              .values({
                variantId,
                attributeId: val.attributeId,
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
      const msg = e instanceof Error ? e.message : "";
      if (/duplicate key|variants_sku_idx|unique/i.test(msg)) {
        return NextResponse.json(
          {
            error: "One of the SKUs you entered is already used by another variant.",
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

      type Bucket = {
        name: string;
        attrSort: number;
        values: { value: string; sort: number }[];
        seen: Set<string>;
      };
      const buckets = new Map<string, Bucket>();
      for (const r of attrRows) {
        if (!r.value) continue;
        if (r.attrType === "size") continue;
        const bucket =
          buckets.get(r.attrId) ??
          {
            name: r.attrName,
            attrSort: r.attrSort ?? 0,
            values: [],
            seen: new Set<string>(),
          };
        if (!bucket.seen.has(r.value)) {
          bucket.seen.add(r.value);
          bucket.values.push({ value: r.value, sort: r.valueSort ?? 0 });
        }
        buckets.set(r.attrId, bucket);
      }

      const groups: { name: string; values: string[] }[] = [];
      const otherGroups = Array.from(buckets.values()).sort(
        (a, b) => a.attrSort - b.attrSort
      );
      if (sizes.length > 0) {
        // Pick the axis name for the legacy size group. Three cases:
        //   1. Product has an EAV attribute of type='size' (e.g. "Caps Sizes",
        //      "Skirt Size") — use that name so the JSON axis matches the key
        //      MultiAttributePicker looks up in variantsByAttributeKey.
        //   2. No EAV size attribute and no other EAV axes — fall back to
        //      the legacy "Size" label (preserves behaviour for the ~2,100
        //      legacy-only products with no EAV metadata).
        //   3. No EAV size attribute but other EAV axes exist — skip the
        //      size group entirely. This prevents a phantom "Size" axis on
        //      products whose `product_variants.size` column holds non-size
        //      labels (e.g. CAS bookkit parents where `size` is a sibling
        //      product name); otherwise every option would become unreachable
        //      in the picker.
        const eavSizeName = await getSizeAxisNameForProduct(id);
        const sizeAxisName =
          eavSizeName ?? (otherGroups.length === 0 ? "Size" : null);
        if (sizeAxisName !== null) {
          groups.push({ name: sizeAxisName, values: sizes });
        }
      }
      for (const g of otherGroups) {
        const values = g.values
          .sort((a, b) => a.sort - b.sort)
          .map((v) => v.value);
        groups.push({ name: g.name, values });
      }

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
  const guard = await requireAdmin("super");
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
