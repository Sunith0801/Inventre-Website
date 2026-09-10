import "server-only";
import { redis } from "@/server/redis";

/**
 * Simple wrap-with-cache helper. Looks up `key` in Redis, returns it if hit;
 * otherwise calls `loader`, stores the result, returns it.
 *
 *   const products = await cached("products:school:" + sid, 60, () => loadProducts(sid));
 *
 * INVARIANT — any admin write that mutates data embedded in a
 * customer-facing DTO MUST call invalidate()/invalidatePattern() before
 * returning. Affected keys today:
 *   - "products:school:*"   (catalog feed per school)
 *   - "product:*"           (per-product PDP DTO)
 *   - "categories:tree" / "categories:map"
 *   - "home:all"            (homepage feed)
 *   - "media:*"
 *   - "price:*"             (single variant price lookup)
 *   - "delivery-fees:all"   (ERPNext delivery-fee rules)
 * When adding a new admin route, grep the cached() call sites and bust
 * every key whose payload your write could change. Failing to invalidate
 * means parents see stale data for up to the cache TTL — set to 60s on
 * the two product caches so worst-case drift is one minute.
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>
): Promise<T> {
  if (process.env.CACHE_DISABLED === "1") return loader();
  try {
    const hit = await redis.get(key);
    if (hit) return JSON.parse(hit) as T;
  } catch {
    // fail open — cache miss treated as full load
  }
  const value = await loader();
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch {
    // ignore cache write failures
  }
  return value;
}

/** Wipe a set of cache keys. Call from admin write paths. */
export async function invalidate(...keys: string[]) {
  if (keys.length === 0) return;
  try {
    await redis.del(...keys);
  } catch {}
}

/** Wipe all keys matching a glob pattern (e.g. "product:some-slug:*"). */
export async function invalidatePattern(pattern: string) {
  try {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) await redis.del(...keys);
  } catch {}
}

/**
 * One-call catalog bust used by every admin mutation that touches a
 * product, variant, attribute, grade tag, school link, or price. This is
 * the single source of truth for "I changed something the catalog cares
 * about — invalidate every cache layer that surfaces it":
 *
 *   - Redis caches (5–3600s TTL):
 *       products:school:*    (per-school shop feed)
 *       product:*            (per-product PDP DTO)
 *       categories:tree
 *       categories:map
 *       home:all             (homepage feed)
 *       price:*              (single variant price lookups)
 *   - Next.js `unstable_cache` (90s TTL) on /admin/catalog tagged
 *     "admin-catalog" — see app/admin/(protected)/catalog/page.tsx.
 *   - App Router data cache for the surfaces admins refresh into:
 *       /admin/catalog (the catalog preview RSC)
 *       /shop          (the storefront grid)
 *
 * Use this from every PATCH/POST/PUT/DELETE that mutates catalog data.
 * Skipping it leaves admins thinking their edits didn't save for up to
 * 90 seconds — the pre-2026-05-26 default.
 */
export async function invalidateCatalog() {
  await Promise.all([
    invalidatePattern("products:school:*"),
    invalidatePattern("product:*"),
    invalidatePattern("price:*"),
    invalidate("categories:tree", "categories:map", "home:all"),
  ]);
  try {
    const { revalidateTag, revalidatePath } = await import("next/cache");
    revalidateTag("admin-catalog");
    revalidatePath("/admin/catalog");
    revalidatePath("/shop");
  } catch {
    // import may fail outside the Next.js runtime (e.g. running a tsx
    // script that drags this module in). Safe to ignore — the Redis
    // wipe above is the durable part.
  }
}
