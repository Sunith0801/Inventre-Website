import { NextResponse } from "next/server";
import { parseBody } from "@/server/parse-body";
import { z } from "zod";
import { db } from "@/db/client";
import { itemPrices, productVariants, products } from "@/db/schema";
import { isResponse, requirePermission, requireAnyPermission } from "@/server/admin-guard";
import { logAdminActivity } from "@/server/activity";
import {
  setVariantPrice,
  bulkUpdatePricesByMarkup,
} from "@/server/repos/pricing";
import { eq } from "drizzle-orm";

const SetBody = z.object({
  variantId: z.string().uuid(),
  priceListId: z.string().uuid(),
  schoolId: z.string().uuid().nullable().optional(),
  price: z.number().int().min(0), // paise
  validFrom: z.string().datetime().nullable().optional(),
  validUntil: z.string().datetime().nullable().optional(),
});

export async function POST(req: Request) {
  const guard = await requireAnyPermission("catalog-pricing.write", "catalog.write");
  if (isResponse(guard)) return guard;
  const parsed = await parseBody(req, SetBody);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;
  await setVariantPrice({
    variantId: body.variantId,
    priceListId: body.priceListId,
    schoolId: body.schoolId ?? null,
    price: body.price,
    validFrom: body.validFrom ? new Date(body.validFrom) : null,
    validUntil: body.validUntil ? new Date(body.validUntil) : null,
  });

  void logAdminActivity(guard, {
    action: "item_price.create",
    entityType: "item_price",
    entityId: body.variantId,
    summary: `Set variant price to ${body.price} paise`,
    req,
  });

  return NextResponse.json({ ok: true });
}

const BulkBody = z.object({
  productIds: z.array(z.string().uuid()).min(1),
  markupPercent: z.number(),
  priceListId: z.string().uuid(),
  schoolId: z.string().uuid().nullable().optional(),
});

export async function PATCH(req: Request) {
  const guard = await requireAnyPermission("catalog-pricing.write", "catalog.write");
  if (isResponse(guard)) return guard;
  const parsed = await parseBody(req, BulkBody);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;
  const result = await bulkUpdatePricesByMarkup({
    productIds: body.productIds,
    markupPercent: body.markupPercent,
    priceListId: body.priceListId,
    schoolId: body.schoolId ?? null,
  });

  void logAdminActivity(guard, {
    action: "item_price.update",
    entityType: "item_price",
    entityId: null,
    summary: `Applied ${body.markupPercent}% markup across ${body.productIds.length} product(s)`,
    req,
  });

  return NextResponse.json(result);
}
