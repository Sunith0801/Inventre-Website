import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { z } from "zod";
import { db } from "@/db/client";
import { discountRules } from "@/db/schema";
import { isResponse, requirePermission } from "@/lib/admin-guard";
import { desc } from "drizzle-orm";

const Body = z.object({
  name: z.string().min(1),
  code: z.string().nullable().optional(),
  type: z.enum(["percent", "flat", "bulk", "bxgy", "free_shipping"]),
  value: z.number(),
  appliesTo: z.enum(["all", "school", "category", "product", "variant"]).default("all"),
  schoolId: z.string().uuid().nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  productId: z.string().uuid().nullable().optional(),
  variantId: z.string().uuid().nullable().optional(),
  minOrderAmount: z.number().int().nullable().optional(),
  minQty: z.number().int().nullable().optional(),
  maxDiscountAmount: z.number().int().nullable().optional(),
  maxUsesTotal: z.number().int().nullable().optional(),
  maxUsesPerCustomer: z.number().int().nullable().optional(),
  validFrom: z.string().datetime().nullable().optional(),
  validUntil: z.string().datetime().nullable().optional(),
  isActive: z.boolean().default(true),
  isStackable: z.boolean().default(false),
  priority: z.number().int().default(0),
});

export async function GET() {
  const guard = await requirePermission("discounts.read");
  if (isResponse(guard)) return guard;
  const rows = await db
    .select()
    .from(discountRules)
    .orderBy(desc(discountRules.createdAt));
  return NextResponse.json({ rules: rows });
}

export async function POST(req: Request) {
  const guard = await requirePermission("discounts.write");
  if (isResponse(guard)) return guard;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;
  const [created] = await db
    .insert(discountRules)
    .values({
      name: body.name,
      code: body.code ?? null,
      type: body.type,
      value: body.value.toString(),
      appliesTo: body.appliesTo,
      schoolId: body.schoolId ?? null,
      categoryId: body.categoryId ?? null,
      productId: body.productId ?? null,
      variantId: body.variantId ?? null,
      minOrderAmount: body.minOrderAmount ?? null,
      minQty: body.minQty ?? null,
      maxDiscountAmount: body.maxDiscountAmount ?? null,
      maxUsesTotal: body.maxUsesTotal ?? null,
      maxUsesPerCustomer: body.maxUsesPerCustomer ?? null,
      validFrom: body.validFrom ? new Date(body.validFrom) : null,
      validUntil: body.validUntil ? new Date(body.validUntil) : null,
      isActive: body.isActive,
      isStackable: body.isStackable,
      priority: body.priority,
    })
    .returning();
  return NextResponse.json({ rule: created });
}
