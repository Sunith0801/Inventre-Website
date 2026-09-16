import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { bundleSelectors, bundleComponents, productBundles } from "@/db/schema";
import { parseBody } from "@/server/parse-body";
import { isResponse, requireAnyPermission } from "@/server/admin-guard";
import { invalidateCatalog } from "@/server/cache";
import { logAdminActivity } from "@/server/activity";

/**
 * "Save section": the items of ONE section of a kit, replaced as a unit.
 * Other sections are untouched, which is what lets the builder save a
 * section at a time and mark it done.
 */
const Body = z.object({
  name: z.string().min(1).max(120).optional(),
  components: z.array(z.object({ productId: z.string().uuid(), qty: z.number().int().min(1).max(999) })).max(200),
});

export async function PUT(req: Request, { params }: { params: Promise<{ id: string; groupKey: string }> }) {
  const guard = await requireAnyPermission("catalog-bundles.write", "catalog.write");
  if (isResponse(guard)) return guard;
  const { id, groupKey } = await params;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const { name, components } = parsed;

  const [bundle] = await db.select({ id: productBundles.id, productId: productBundles.productId }).from(productBundles).where(eq(productBundles.id, id)).limit(1);
  if (!bundle) return NextResponse.json({ error: "Bundle not found" }, { status: 404 });
  if (components.some((c) => c.productId === bundle.productId)) return NextResponse.json({ error: "A kit cannot contain itself." }, { status: 400 });

  // Collapse duplicates by product, summing quantities.
  const byProduct = new Map<string, number>();
  for (const c of components) byProduct.set(c.productId, (byProduct.get(c.productId) ?? 0) + c.qty);

  await db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: bundleSelectors.id }).from(bundleSelectors).where(and(eq(bundleSelectors.bundleId, id), eq(bundleSelectors.groupKey, groupKey))).limit(1);
    if (!existing) {
      await tx.insert(bundleSelectors).values({ bundleId: id, groupKey, name: name ?? groupKey, selectorType: "multi", isRequired: false, minSelections: 0, maxSelections: null, sortOrder: 99 });
    } else if (name) {
      await tx.update(bundleSelectors).set({ name }).where(eq(bundleSelectors.id, existing.id));
    }
    await tx.delete(bundleComponents).where(and(eq(bundleComponents.bundleId, id), eq(bundleComponents.selectorGroupKey, groupKey)));
    if (byProduct.size) {
      await tx.insert(bundleComponents).values(
        [...byProduct.entries()].map(([productId, qty]) => ({ bundleId: id, productId, variantId: null, qty, selectorGroupKey: groupKey, selectorOptionLabel: null, isOptional: false, isVisible: true })),
      );
    }
  });
  await invalidateCatalog();

  void logAdminActivity(guard, { action: "bundle.section.save", entityType: "bundle", entityId: id, summary: `Saved section "${name ?? groupKey}" with ${byProduct.size} item(s)`, req });
  return NextResponse.json({ ok: true, count: byProduct.size });
}
