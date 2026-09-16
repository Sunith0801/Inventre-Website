import "server-only";
import { and, eq, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { products, productVariants, itemPrices, priceLists } from "@/db/schema";
import { invalidateCatalog } from "@/server/cache";

/**
 * Promote every scheduled base price whose effective date has arrived:
 * `base_price` takes the scheduled figure, the default price list's
 * variant rows follow it (the same propagation a manual base-price edit
 * does in the product PATCH), and the schedule is cleared. Idempotent —
 * running it twice on the same morning changes nothing the second time.
 *
 * Called by the daily cron and, cheaply, when an admin opens a product
 * whose date has passed, so a stalled cron never leaves a stale price
 * showing in the admin.
 */
export async function applyScheduledPrices(): Promise<{ applied: { id: string; name: string; from: number; to: number }[] }> {
  const due = await db
    .select({ id: products.id, name: products.name, basePrice: products.basePrice, scheduled: products.scheduledBasePrice })
    .from(products)
    .where(and(isNotNull(products.scheduledBasePrice), lte(products.priceEffectiveFrom, sql`CURRENT_DATE`)));
  if (due.length === 0) return { applied: [] };

  const [defaultPL] = await db.select({ id: priceLists.id }).from(priceLists).where(eq(priceLists.isDefault, true)).limit(1);
  const applied: { id: string; name: string; from: number; to: number }[] = [];

  for (const p of due) {
    const to = p.scheduled!;
    await db.transaction(async (tx) => {
      await tx.update(products).set({ basePrice: to, scheduledBasePrice: null, priceEffectiveFrom: null }).where(eq(products.id, p.id));
      if (defaultPL) {
        const variants = await tx.select({ id: productVariants.id }).from(productVariants).where(and(eq(productVariants.productId, p.id), eq(productVariants.isActive, true)));
        for (const v of variants) {
          const [existing] = await tx
            .select({ id: itemPrices.id })
            .from(itemPrices)
            .where(and(eq(itemPrices.variantId, v.id), eq(itemPrices.priceListId, defaultPL.id), sql`${itemPrices.schoolId} IS NULL`))
            .limit(1);
          if (existing) await tx.update(itemPrices).set({ price: to }).where(eq(itemPrices.id, existing.id));
          else await tx.insert(itemPrices).values({ variantId: v.id, priceListId: defaultPL.id, price: to });
        }
      }
    });
    applied.push({ id: p.id, name: p.name, from: p.basePrice, to });
  }
  await invalidateCatalog();
  return { applied };
}
