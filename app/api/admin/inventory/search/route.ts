import { NextResponse } from "next/server";
import { and, asc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { products, productVariants, categories } from "@/db/schema";
import { isResponse, requireAnyPermission } from "@/server/admin-guard";

type Kind = typeof products.$inferSelect.kind;
const KINDS: Kind[] = ["magic_box", "kit", "sub_bundle", "uniform", "accessory", "book", "consumable", "excluded"];

/**
 * "SKU or item name" lookup against the inventory the admin maps items
 * from. In this system the inventory IS the product catalogue (imported
 * from the ERP) plus the Ground Stock bins for quantity — the admin never
 * creates stock here, only finds the row and wires it up.
 *
 *   GET /api/admin/inventory/search?q=maths&categoryId=<uuid>&kinds=book,consumable&limit=15
 *
 * `categoryId` scopes to one sub-category (and its children). When that
 * scope has no match, the search falls back to the whole inventory of
 * the given kinds and says so (`scope: "all"`) — 1,083 books were imported
 * under a generic "books" category before the sections existed, and
 * picking one files it under the sub-category, so the gap closes itself.
 */
export async function GET(req: Request) {
  const guard = await requireAnyPermission("products.read", "catalog.read");
  if (isResponse(guard)) return guard;

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const categoryId = url.searchParams.get("categoryId");
  const kinds = (url.searchParams.get("kinds") ?? "").split(",").filter((k): k is Kind => KINDS.includes(k as Kind));
  const status = url.searchParams.get("status"); // e.g. "active" to offer only published kits
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "15", 10) || 15, 50);
  if (q.length < 2) return NextResponse.json({ items: [], scope: "category" });

  const base = [
    or(
      ilike(products.name, `%${q}%`),
      ilike(sql`COALESCE(${products.itemCode}, '')`, `%${q}%`),
      ilike(productVariants.sku, `%${q}%`),
      ilike(sql`COALESCE(${productVariants.erpName}, '')`, `%${q}%`),
    ),
    eq(productVariants.isActive, true),
    ...(kinds.length ? [inArray(products.kind, kinds)] : []),
    ...(status === "active" ? [eq(products.status, "active")] : []),
  ];

  const run = (extra: ReturnType<typeof sql>[]) =>
    db
      .select({
        variantId: productVariants.id,
        productId: products.id,
        name: products.name,
        itemCode: products.itemCode,
        sku: productVariants.sku,
        size: productVariants.size,
        kind: products.kind,
        status: products.status,
        categoryId: products.categoryId,
        basePrice: products.basePrice,
        baseMrp: products.baseMrp,
        // On-hand across warehouses, from the bins the Ground Stock bridge
        // keeps in step with the audit ERP. Null = never counted.
        stock: sql<number | null>`(SELECT SUM(b.actual_qty - b.reserved_qty)::int FROM bins b WHERE b.variant_id = ${productVariants.id})`,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(and(...base, ...extra))
      .orderBy(asc(products.name), asc(productVariants.size))
      .limit(limit);

  if (categoryId) {
    const [cat] = await db.select({ path: categories.path }).from(categories).where(eq(categories.id, categoryId)).limit(1);
    if (cat) {
      const scoped = await run([sql`${products.categoryId} IN (SELECT id FROM categories WHERE path = ${cat.path} OR path LIKE ${cat.path + ".%"})`]);
      if (scoped.length) return NextResponse.json({ items: scoped, scope: "category" });
    }
    const all = await run([]);
    return NextResponse.json({ items: all, scope: "all" });
  }

  return NextResponse.json({ items: await run([]), scope: "all" });
}
