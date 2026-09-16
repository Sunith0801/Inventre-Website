import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { systemSettings } from "@/db/schema";
import { cached, invalidate, invalidateCatalog } from "@/server/cache";
import {
  DEFAULT_GROUND_STOCK_GATE,
  parseGroundStockGate,
  type GroundStockGate,
} from "@/features/stock/domain/availability";

/**
 * The admin switch behind the Ground Stock availability rule.
 *
 * Stored in system_settings under one key so ops can turn the storefront
 * back to "never out of stock" (or make unmatched garments sellable) from
 * the Stock report without a deploy. Read on every storefront product
 * resolve, so it is request-cached and Redis-cached for 30 s; a flip is
 * live within that window and the catalog caches are busted on write.
 */
export const GROUND_STOCK_GATE_KEY = "stock.ground_gate";
const CACHE_KEY = "settings:ground-gate";

// `cache` is undefined outside a React server render (tsx scripts, the
// cron route under some runtimes); fall back to a plain call there.
const perRequest: <F extends (...a: never[]) => unknown>(f: F) => F =
  typeof cache === "function" ? cache : (f) => f;

export const getGroundStockGate = perRequest(async (): Promise<GroundStockGate> => {
  try {
    return await cached(CACHE_KEY, 30, async () => {
      const rows = await db
        .select()
        .from(systemSettings)
        .where(eq(systemSettings.key, GROUND_STOCK_GATE_KEY))
        .limit(1);
      return parseGroundStockGate(rows[0]?.value);
    });
  } catch {
    // A settings hiccup must not change what parents can buy: fall back to
    // the documented default rather than to "everything sold out".
    return DEFAULT_GROUND_STOCK_GATE;
  }
});

export async function setGroundStockGate(next: GroundStockGate): Promise<GroundStockGate> {
  const value = parseGroundStockGate(next);
  await db
    .insert(systemSettings)
    .values({ key: GROUND_STOCK_GATE_KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value, updatedAt: new Date() },
    });
  await invalidate(CACHE_KEY);
  await invalidateCatalog();
  return value;
}
