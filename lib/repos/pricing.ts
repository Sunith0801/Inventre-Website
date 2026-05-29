import "server-only";
import { eq, and, isNull, or, lte, gte, sql, desc, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { itemPrices, priceLists, productVariants, products, schools } from "@/db/schema";
import { cached, invalidate, invalidatePattern } from "../cache";

/**
 * Pricing engine — reads variant prices from `item_prices`.
 *
 * Resolution order (highest priority first):
 *   1. school-specific override on the requested price list
 *   2. global (NULL school) price on the requested price list
 *   3. fallback to legacy `products.basePrice`
 *
 * Validity windows respected: validFrom ≤ now ≤ validUntil (or NULL).
 */

let _defaultPriceListId: string | null = null;
export async function getDefaultPriceListId(): Promise<string> {
  if (_defaultPriceListId) return _defaultPriceListId;
  const [row] = await db
    .select()
    .from(priceLists)
    .where(eq(priceLists.isDefault, true))
    .limit(1);
  if (!row) throw new Error("No default price list. Run db:seed.");
  _defaultPriceListId = row.id;
  return row.id;
}

/** Resolve current price for a variant. Returns paise. */
export async function getVariantPrice(
  variantId: string,
  opts: { schoolId?: string | null; priceListId?: string } = {}
): Promise<number | null> {
  const priceListId = opts.priceListId ?? (await getDefaultPriceListId());
  const now = new Date();

  // Build candidate list — school-specific first, then global.
  const cacheKey = `price:${variantId}:${priceListId}:${opts.schoolId ?? "global"}`;
  return cached(cacheKey, 300, async () => {
    const rows = await db
      .select()
      .from(itemPrices)
      .where(
        and(
          eq(itemPrices.variantId, variantId),
          eq(itemPrices.priceListId, priceListId),
          or(isNull(itemPrices.validFrom), lte(itemPrices.validFrom, now)),
          or(isNull(itemPrices.validUntil), gte(itemPrices.validUntil, now))
        )
      )
      .orderBy(desc(itemPrices.createdAt));

    if (rows.length === 0) return null;

    // Prefer school-specific
    if (opts.schoolId) {
      const schoolRow = rows.find((r) => r.schoolId === opts.schoolId);
      if (schoolRow) return schoolRow.price;
    }
    const globalRow = rows.find((r) => r.schoolId === null);
    if (globalRow) return globalRow.price;
    // No global, fall back to first
    return rows[0].price;
  });
}

/** Set or update the price for a variant on a price list (optionally school-scoped). */
export async function setVariantPrice(args: {
  variantId: string;
  priceListId: string;
  schoolId?: string | null;
  price: number;
  validFrom?: Date | null;
  validUntil?: Date | null;
}) {
  const { variantId, priceListId, schoolId, price, validFrom, validUntil } = args;

  // Find existing row matching the same scope (variant × list × school) without validity.
  const existing = await db
    .select()
    .from(itemPrices)
    .where(
      and(
        eq(itemPrices.variantId, variantId),
        eq(itemPrices.priceListId, priceListId),
        schoolId ? eq(itemPrices.schoolId, schoolId) : isNull(itemPrices.schoolId)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(itemPrices)
      .set({
        price,
        validFrom: validFrom ?? null,
        validUntil: validUntil ?? null,
        updatedAt: new Date(),
      })
      .where(eq(itemPrices.id, existing[0].id));
  } else {
    await db.insert(itemPrices).values({
      variantId,
      priceListId,
      schoolId: schoolId ?? null,
      price,
      validFrom: validFrom ?? null,
      validUntil: validUntil ?? null,
    });
  }

  void invalidate(`price:${variantId}:${priceListId}:${schoolId ?? "global"}`);
  void invalidate(`price:${variantId}:${priceListId}:global`);
  // Customer-facing DTOs (listProductsForStudent + getProductBySlug) embed
  // the resolved price, so the per-variant price bust above is not enough —
  // the outer caches still hold the old number until the TTL expires. Bust
  // them too so shoppers see the new price on the next request.
  void invalidatePattern("product:*");
  void invalidatePattern("products:school:*");
}

/** Bulk: set the same markup % over costPrice for all variants of given products. */
export async function bulkUpdatePricesByMarkup(args: {
  productIds: string[];
  markupPercent: number;
  priceListId: string;
  schoolId?: string | null;
}): Promise<{ updated: number }> {
  const { productIds, markupPercent, priceListId, schoolId } = args;
  if (productIds.length === 0) return { updated: 0 };

  const variantsWithCost = await db
    .select({
      variantId: productVariants.id,
      productCost: products.costPrice,
      productBase: products.basePrice,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(inArray(productVariants.productId, productIds));

  let updated = 0;
  for (const v of variantsWithCost) {
    const base = v.productCost ?? v.productBase;
    if (!base) continue;
    const newPrice = Math.round(base * (1 + markupPercent / 100));
    await setVariantPrice({
      variantId: v.variantId,
      priceListId,
      schoolId: schoolId ?? null,
      price: newPrice,
    });
    updated++;
  }
  // `setVariantPrice` already busts product:* / products:school:* on each
  // call, but the bulk path can re-issue the same pattern bust once at the
  // end for clarity — Redis treats it as a near no-op when the keys are
  // already gone.
  void invalidatePattern("product:*");
  void invalidatePattern("products:school:*");
  return { updated };
}

/** Read all prices for a variant — used in admin pricing grid. */
export async function listVariantPrices(variantId: string) {
  const rows = await db
    .select({
      price: itemPrices,
      list: priceLists,
      school: schools,
    })
    .from(itemPrices)
    .innerJoin(priceLists, eq(priceLists.id, itemPrices.priceListId))
    .leftJoin(schools, eq(schools.id, itemPrices.schoolId))
    .where(eq(itemPrices.variantId, variantId))
    .orderBy(desc(itemPrices.createdAt));
  return rows.map((r) => ({
    id: r.price.id,
    price: r.price.price,
    priceListId: r.list.id,
    priceListName: r.list.name,
    schoolId: r.school?.id ?? null,
    schoolName: r.school?.name ?? null,
    validFrom: r.price.validFrom,
    validUntil: r.price.validUntil,
  }));
}
