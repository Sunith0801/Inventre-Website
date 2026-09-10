import "server-only";
import { eq, and, inArray, isNull, or, lte, gte, desc } from "drizzle-orm";
import { db } from "@/db/client";
import {
  productVariants,
  bins,
  itemPrices,
  priceLists,
  warehouses,
  products,
  productSchool,
} from "@/db/schema";

/**
 * Single source of truth for variant price + stock at read time.
 *
 * Reads from the NEW system (bins for stock, itemPrices for pricing) with
 * graceful fallback to the LEGACY columns (productVariants.stockQty,
 * products.basePrice + productSchool.overridePrice).
 *
 * Used by: shop product list/detail, cart read, checkout.
 *
 * This is the ONE place that hides the dual-storage transition. Once Phase 12
 * is complete and legacy columns can be dropped, only the new-system branches
 * stay.
 */

export type VariantInfo = {
  variantId: string;
  /** All values in PAISE. */
  pricePaise: number;
  /** mrp in paise; null if not set. */
  mrpPaise: number | null;
  /** Total available stock = actualQty - reservedQty (or legacy stockQty). */
  available: number;
  inStock: boolean;
  /** True when an itemPrices row explicitly priced this variant — even at
   *  ₹0 (school-included freebies like belts). Lets the storefront tell
   *  "deliberately free" apart from "price never set", which both surface
   *  as pricePaise === 0. */
  explicitPrice: boolean;
};

/**
 * Resolve price + stock for a list of variants.
 *
 * @param variantIds  variants to resolve
 * @param schoolId    if provided, school-specific itemPrice + productSchool override take precedence
 * @returns           map of variantId → VariantInfo
 */
export async function resolveVariants(
  variantIds: string[],
  schoolId?: string | null
): Promise<Map<string, VariantInfo>> {
  if (variantIds.length === 0) return new Map();

  // Resolve variant→productId once so the next batch can run in parallel
  // without serializing on a query inside Promise.all. Filter inactive
  // (soft-deleted) variants defensively so any caller that forgot the filter
  // doesn't accidentally surface retired SKUs to the storefront.
  const variantRows = await db
    .select()
    .from(productVariants)
    .where(
      and(
        inArray(productVariants.id, variantIds),
        eq(productVariants.isActive, true)
      )
    );
  const productIds = Array.from(new Set(variantRows.map((v) => v.productId)));

  const [binRows, defaultPriceList, priceRows, productRows, psRows] =
    await Promise.all([
      db.select().from(bins).where(inArray(bins.variantId, variantIds)),
      db.select().from(priceLists).where(eq(priceLists.isDefault, true)).limit(1),
      db.select().from(itemPrices).where(inArray(itemPrices.variantId, variantIds)),
      productIds.length
        ? db.select().from(products).where(inArray(products.id, productIds))
        : Promise.resolve([] as (typeof products.$inferSelect)[]),
      // Constrain to the products actually under consideration. Previously
      // this fetched every productSchool row for the school (~thousands)
      // even when only a handful of products were in the caller's set;
      // /admin/catalog with both school + grade filters paid that cost on
      // every render. The existing (product_id, school_id) UNIQUE index
      // covers this query.
      schoolId && productIds.length
        ? db
            .select()
            .from(productSchool)
            .where(
              and(
                eq(productSchool.schoolId, schoolId),
                inArray(productSchool.productId, productIds)
              )
            )
        : Promise.resolve([] as (typeof productSchool.$inferSelect)[]),
    ]);

  const productById = new Map(productRows.map((p) => [p.id, p]));
  const psByProduct = new Map(psRows.map((r) => [r.productId, r]));
  const defaultPriceListId = defaultPriceList[0]?.id ?? null;

  // Build bin map: variantId → sum of (actual - reserved) across warehouses
  const stockByVariant = new Map<string, number>();
  for (const b of binRows) {
    const cur = stockByVariant.get(b.variantId) ?? 0;
    stockByVariant.set(b.variantId, cur + (b.actualQty - b.reservedQty));
  }

  // Build price map: variantId → best price
  // Resolution: school-specific on default list > global on default list > any school-specific > any global
  const now = new Date();
  const isValid = (p: typeof itemPrices.$inferSelect) =>
    (!p.validFrom || p.validFrom <= now) && (!p.validUntil || p.validUntil >= now);

  const priceByVariant = new Map<string, number>();
  for (const p of priceRows.filter(isValid)) {
    if (p.priceListId !== defaultPriceListId) continue;
    const isSchoolMatch = schoolId && p.schoolId === schoolId;
    const isGlobal = p.schoolId === null;
    if (!isSchoolMatch && !isGlobal) continue;
    const existing = priceByVariant.get(p.variantId);
    // School-specific wins over global
    if (existing == null) {
      priceByVariant.set(p.variantId, p.price);
    } else if (isSchoolMatch) {
      priceByVariant.set(p.variantId, p.price);
    }
  }

  const result = new Map<string, VariantInfo>();
  for (const v of variantRows) {
    const product = productById.get(v.productId);
    if (!product) continue;
    const ps = psByProduct.get(v.productId);

    // Stock: prefer bins, fallback to legacy stockQty. This is a made-to-order
    // uniform/book catalogue with no stock tracking — every variant carries
    // stock_qty = 0 and there is no bin data. Treat "untracked" (no bin row,
    // legacy 0) as freely available so nothing shows as out of stock.
    const newStock = stockByVariant.get(v.id);
    const legacyStock = v.stockQty;
    const available =
      newStock != null ? newStock : legacyStock > 0 ? legacyStock : 99999;

    // Price: prefer itemPrices, fallback to productSchool.overridePrice, then product.basePrice
    const newPrice = priceByVariant.get(v.id);
    const legacyPrice = ps?.overridePrice ?? product.basePrice;
    const pricePaise = newPrice ?? legacyPrice;

    const mrpPaise = ps?.overrideMrp ?? product.baseMrp ?? null;

    result.set(v.id, {
      variantId: v.id,
      pricePaise,
      mrpPaise,
      available,
      inStock: available > 0,
      explicitPrice: newPrice != null,
    });
  }

  return result;
}

/** Convenience: resolve a single variant. */
export async function resolveVariant(
  variantId: string,
  schoolId?: string | null
): Promise<VariantInfo | null> {
  const map = await resolveVariants([variantId], schoolId);
  return map.get(variantId) ?? null;
}
