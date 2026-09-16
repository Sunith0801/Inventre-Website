import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, notInArray } from "drizzle-orm";
import { db } from "@/db/client";
import { bundleSelectors, bundleComponents, productBundles } from "@/db/schema";
import { parseBody } from "@/server/parse-body";
import { isResponse, requireAnyPermission } from "@/server/admin-guard";
import { invalidateCatalog } from "@/server/cache";
import { logAdminActivity } from "@/server/activity";

/**
 * Which sections a Book kit (or which sub-bundles a Magic box) contains.
 * A section is a `bundle_selectors` row; its items are the
 * `bundle_components` rows carrying its group key. Replace-mode over the
 * section LIST only: a section that is dropped takes its items with it,
 * sections that stay keep theirs untouched.
 */
const Body = z.object({
  sections: z
    .array(z.object({ groupKey: z.string().min(1).max(64), name: z.string().min(1).max(120) }))
    .max(40),
});

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAnyPermission("catalog-bundles.write", "catalog.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const { sections } = parsed;

  const [bundle] = await db.select({ id: productBundles.id }).from(productBundles).where(eq(productBundles.id, id)).limit(1);
  if (!bundle) return NextResponse.json({ error: "Bundle not found" }, { status: 404 });

  const keys = sections.map((s) => s.groupKey);
  await db.transaction(async (tx) => {
    if (keys.length) {
      await tx.delete(bundleComponents).where(and(eq(bundleComponents.bundleId, id), notInArray(bundleComponents.selectorGroupKey, keys)));
      await tx.delete(bundleSelectors).where(and(eq(bundleSelectors.bundleId, id), notInArray(bundleSelectors.groupKey, keys)));
    } else {
      await tx.delete(bundleComponents).where(eq(bundleComponents.bundleId, id));
      await tx.delete(bundleSelectors).where(eq(bundleSelectors.bundleId, id));
    }
    for (let i = 0; i < sections.length; i++) {
      const s = sections[i]!;
      await tx
        .insert(bundleSelectors)
        .values({ bundleId: id, groupKey: s.groupKey, name: s.name, selectorType: "multi", isRequired: false, minSelections: 0, maxSelections: null, sortOrder: i })
        .onConflictDoUpdate({ target: [bundleSelectors.bundleId, bundleSelectors.groupKey], set: { name: s.name, sortOrder: i } });
    }
  });
  await invalidateCatalog();

  void logAdminActivity(guard, { action: "bundle.sections.set", entityType: "bundle", entityId: id, summary: `Set ${sections.length} section(s)`, req });
  return NextResponse.json({ ok: true });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAnyPermission("catalog-bundles.read", "catalog-bundles.write", "catalog.read", "catalog.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  const [sections, components] = await Promise.all([
    db.select().from(bundleSelectors).where(eq(bundleSelectors.bundleId, id)).orderBy(bundleSelectors.sortOrder),
    db.select({ groupKey: bundleComponents.selectorGroupKey, productId: bundleComponents.productId, qty: bundleComponents.qty }).from(bundleComponents).where(eq(bundleComponents.bundleId, id)),
  ]);
  return NextResponse.json({ sections, components });
}
