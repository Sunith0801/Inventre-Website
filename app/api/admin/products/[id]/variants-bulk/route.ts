import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { z } from "zod";
import { db } from "@/db/client";
import {
  productVariants,
  productAttributeBindings,
  productVariantAttributes,
  productAttributeValues,
} from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { isResponse, requirePermission } from "@/lib/admin-guard";
import { getDefaultWarehouseId, applyStockChange } from "@/lib/repos/inventory";

/**
 * Bulk-create variants for a product as the cartesian product of attribute values.
 *
 * Body:
 *   {
 *     attributes: [
 *       { attributeId: "...", valueIds: ["...","..."] }   // size: S/M/L
 *       { attributeId: "...", valueIds: ["...","..."] }   // color: Red/Blue
 *     ],
 *     skuPrefix?: "KLS-SHIRT",   // SKU built as {prefix}-{val1Code}-{val2Code}-...
 *     stockQty?: 0,
 *   }
 *
 * Generates one variant per cartesian-product combination, attaches attribute
 * bindings + per-variant attribute rows, creates a bin row in the default
 * warehouse with the requested stockQty.
 */
const Body = z.object({
  attributes: z
    .array(
      z.object({
        attributeId: z.string().uuid(),
        valueIds: z.array(z.string().uuid()).min(1),
      })
    )
    .min(1),
  skuPrefix: z.string().optional(),
  stockQty: z.number().int().min(0).default(0),
});

function cartesian<T>(arrays: T[][]): T[][] {
  if (arrays.length === 0) return [[]];
  const [head, ...tail] = arrays;
  const rest = cartesian(tail);
  return head.flatMap((h) => rest.map((r) => [h, ...r]));
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission("catalog.write");
  if (isResponse(guard)) return guard;
  const { id: productId } = await params;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;

  // Ensure product attribute bindings exist (create if missing)
  for (const a of body.attributes) {
    await db
      .insert(productAttributeBindings)
      .values({ productId, attributeId: a.attributeId, isRequired: true })
      .onConflictDoNothing();
  }

  // Resolve value rows for SKU code generation
  const allValueIds = body.attributes.flatMap((a) => a.valueIds);
  const valueRows = await db
    .select()
    .from(productAttributeValues)
    .where(inArray(productAttributeValues.id, allValueIds));
  const valueById = new Map(valueRows.map((v) => [v.id, v]));

  // Cartesian product
  const combos = cartesian(body.attributes.map((a) => a.valueIds));

  const wh = await getDefaultWarehouseId();
  const created: { variantId: string; sku: string; combo: string[] }[] = [];

  for (const combo of combos) {
    const codes = combo.map(
      (vId) => valueById.get(vId)?.shortCode ?? valueById.get(vId)?.value ?? "?"
    );
    const sku = [body.skuPrefix ?? productId.slice(0, 8), ...codes]
      .join("-")
      .toUpperCase()
      .replace(/\s+/g, "");

    // Skip if SKU already exists
    const existing = await db
      .select()
      .from(productVariants)
      .where(eq(productVariants.sku, sku))
      .limit(1);
    if (existing.length > 0) continue;

    const sizeAttr = body.attributes.find((a) =>
      ["size"].includes(valueById.get(a.valueIds[0])?.value ? "" : "")
    );
    // legacy 'size' field — pick the first 'size'-typed attribute value if any, else first value
    const sizeValue =
      combo
        .map((vId) => valueById.get(vId))
        .find((v) => v && /^[0-9XSML]+/.test(v.value))?.value ?? combo.map((vId) => valueById.get(vId)?.value ?? "?").join("/");

    const [variant] = await db
      .insert(productVariants)
      .values({
        productId,
        size: sizeValue,
        sku,
        stockQty: body.stockQty,
        lowStockThreshold: 5,
      })
      .returning();

    // Variant-attribute rows
    await db.insert(productVariantAttributes).values(
      body.attributes.map((a, idx) => ({
        variantId: variant.id,
        attributeId: a.attributeId,
        valueId: combo[idx],
      }))
    );

    // Create the bin via the stock chokepoint so we get a ledger row + FOR UPDATE.
    // applyStockChange inserts the bin with delta=stockQty when none exists.
    await applyStockChange(
      {
        variantId: variant.id,
        warehouseId: wh,
        delta: body.stockQty,
        reason: "receipt",
        refType: "variant_create",
        refId: variant.id,
        notes: "Initial stock from bulk variant creation",
        createdBy: guard.id,
      },
      { allowNegative: true }
    );

    created.push({ variantId: variant.id, sku, combo });
  }

  return NextResponse.json({ created: created.length, variants: created });
}
