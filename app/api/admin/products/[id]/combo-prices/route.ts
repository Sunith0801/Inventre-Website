import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { itemPrices, productVariants } from "@/db/schema";
import { isResponse, requirePermission } from "@/lib/admin-guard";
import { invalidateCatalog } from "@/lib/cache";
import { logAdminActivity } from "@/lib/activity";

const Body = z.object({
  priceListId: z.string().uuid(),
  updates: z
    .array(
      z.object({
        variantId: z.string().uuid(),
        pricePaise: z.number().int().min(0).nullable(),
      }),
    )
    .min(1),
});

/**
 * Upsert per-variant overrides on a given price list (schoolId = NULL).
 *  - `pricePaise = null` → delete the existing override row.
 *  - `pricePaise >= 0`   → insert if missing, update if present.
 *
 * All updates happen in a single transaction so a partial failure rolls back.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requirePermission("catalog.write");
  if (isResponse(guard)) return guard;
  const { id: productId } = await params;

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }
  const { priceListId, updates } = parsed.data;

  // Defensive: every variantId must belong to this product.
  const variantIds = updates.map((u) => u.variantId);
  const owned = await db
    .select({ id: productVariants.id })
    .from(productVariants)
    .where(
      and(
        eq(productVariants.productId, productId),
        inArray(productVariants.id, variantIds),
      ),
    );
  if (owned.length !== variantIds.length) {
    return NextResponse.json(
      { error: "One or more variants do not belong to this product" },
      { status: 400 },
    );
  }

  await db.transaction(async (tx) => {
    const existing = await tx
      .select({
        id: itemPrices.id,
        variantId: itemPrices.variantId,
      })
      .from(itemPrices)
      .where(
        and(
          inArray(itemPrices.variantId, variantIds),
          eq(itemPrices.priceListId, priceListId),
          isNull(itemPrices.schoolId),
        ),
      );
    const existingByVariant = new Map(existing.map((r) => [r.variantId, r.id]));

    for (const u of updates) {
      const existingId = existingByVariant.get(u.variantId);
      if (u.pricePaise == null) {
        if (existingId) {
          await tx.delete(itemPrices).where(eq(itemPrices.id, existingId));
        }
        continue;
      }
      if (existingId) {
        await tx
          .update(itemPrices)
          .set({ price: u.pricePaise, updatedAt: new Date() })
          .where(eq(itemPrices.id, existingId));
      } else {
        await tx.insert(itemPrices).values({
          variantId: u.variantId,
          priceListId,
          schoolId: null,
          price: u.pricePaise,
        });
      }
    }
  });

  await invalidateCatalog();

  void logAdminActivity(guard, {
    action: "product.combo_prices.set",
    entityType: "product",
    entityId: productId,
    summary: `Updated prices for ${updates.length} variant(s)`,
    req,
  });

  return NextResponse.json({ ok: true });
}
