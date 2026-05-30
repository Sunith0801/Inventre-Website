import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { z } from "zod";
import { db } from "@/db/client";
import { itemPrices, productVariants, products } from "@/db/schema";
import { isResponse, requirePermission } from "@/lib/admin-guard";
import {
  setVariantPrice,
  bulkUpdatePricesByMarkup,
} from "@/lib/repos/pricing";
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
  const guard = await requirePermission("catalog.write");
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
  return NextResponse.json({ ok: true });
}

const BulkBody = z.object({
  productIds: z.array(z.string().uuid()).min(1),
  markupPercent: z.number(),
  priceListId: z.string().uuid(),
  schoolId: z.string().uuid().nullable().optional(),
});

export async function PATCH(req: Request) {
  const guard = await requirePermission("catalog.write");
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
  return NextResponse.json(result);
}
