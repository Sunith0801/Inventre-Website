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
import { availabilityFor } from "@/features/stock/domain/availability";
import { getGroundStockGate } from "@/server/ground-stock-gate";

/**
 * Single source of truth for variant price + stock at read time.
 *
 * Stock comes from `bins` only — the figure the Ground Stock bridge writes
 * there every 5 minutes from the audit ERP (server/ground-stock-sync.ts).
 * The legacy `productVariants.stockQty` column is deliberately NOT consulted:
 * it was set once at import and never moved, and the 2026-09-16 rule is that
 * no separate or outdated quantity may decide availability. The rule itself
 * (which kinds are gated, what "no bin" means) lives in
 * features/stock/domain/availability.ts; pricing still falls back to the
 * legacy columns (products.basePrice + productSchool.overridePrice).
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
  /** Units the storefront may sell — the Ground Stock bin read through the availability rule. */
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

  const [binRows, defaultPriceList, priceRows, productRows, psRows, gate] =
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
      getGroundStockGate(),
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

    // Stock: the bin the Ground Stock bridge maintains, interpreted by the
    // one availability rule. No bin = never counted by the audit; what that
    // means depends on the product kind and the admin gate.
    const available = availabilityFor({
      kind: product.kind,
      binAvailable: stockByVariant.get(v.id) ?? null,
      gate,
    });

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
