import { NextResponse } from "next/server";
import { z } from "zod";
import { inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { products } from "@/db/schema";
import { isResponse, requirePermission, requireAnyPermission } from "@/server/admin-guard";
import { invalidateCatalog } from "@/server/cache";
import { logAdminActivity } from "@/server/activity";
import { getProductReadiness } from "@/server/admin/product-readiness";

/**
 * Bulk operations across products. Today only status change is supported —
 * the storefront's most common bulk need (publish a school's whole catalog,
 * archive an old season). Each id is validated before issuing one UPDATE so
 * we don't ship a partial change on bad input.
 */
const Body = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  status: z.enum(["draft", "active", "archived"]),
});

export async function PATCH(req: Request) {
  const guard = await requireAnyPermission("products.write", "catalog.write");
  if (isResponse(guard)) return guard;

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof z.ZodError ? e.issues[0]?.message : "Bad request" },
      { status: 400 }
    );
  }

  // Publishing goes through the same readiness list as the Review step.
  // Products that fail are skipped and named, the rest go live — a bulk
  // publish of a school's catalogue should not be all-or-nothing on one
  // missing price.
  let ids = body.ids;
  const skipped: { id: string; reasons: string[] }[] = [];
  if (body.status === "active") {
    const results = await Promise.all(ids.map(async (id) => ({ id, r: await getProductReadiness(id) })));
    ids = [];
    for (const { id, r } of results) {
      if (r && !r.publishable) skipped.push({ id, reasons: r.failing.map((c) => c.label) });
      else ids.push(id);
    }
  }

  const updated = ids.length
    ? await db
        .update(products)
        .set({ status: body.status })
        .where(inArray(products.id, ids))
        .returning({ id: products.id })
    : [];

  await invalidateCatalog();

  void logAdminActivity(guard, {
    action: "product.bulk_update",
    entityType: "product",
    entityId: null,
    summary: `Set status to "${body.status}" on ${updated.length} product(s)${skipped.length ? `, ${skipped.length} not ready` : ""}`,
    req,
  });

  return NextResponse.json({ ok: true, updated: updated.length, skipped });
}
