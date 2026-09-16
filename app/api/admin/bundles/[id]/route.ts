import { NextResponse } from "next/server";
import { parseBody } from "@/server/parse-body";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  productBundles,
  bundleComponents,
  bundleSelectors,
  bundleConfigs,
} from "@/db/schema";
import { isResponse, requirePermission, requireAnyPermission } from "@/server/admin-guard";
import { invalidateCatalog } from "@/server/cache";
import { logAdminActivity } from "@/server/activity";

const Body = z.object({
  components: z
    .array(
      z.object({
        variantId: z.string().uuid().nullable().optional(),
        productId: z.string().uuid().nullable().optional(),
        qty: z.number().int().min(1).default(1),
        selectorGroupKey: z.string().nullable().optional(),
        selectorOptionLabel: z.string().nullable().optional(),
        isOptional: z.boolean().default(false),
        isVisible: z.boolean().default(true),
      })
    )
    .optional(),
  selectors: z
    .array(
      z.object({
        groupKey: z.string(),
        name: z.string(),
        selectorType: z.enum(["one_of", "multi"]),
        isRequired: z.boolean().default(true),
        minSelections: z.number().int().default(1),
        maxSelections: z.number().int().nullable().optional(),
        sortOrder: z.number().int().default(0),
      })
    )
    .optional(),
  configs: z
    .array(
      z.object({
        schoolId: z.string().uuid(),
        grade: z.string(),
        isActive: z.boolean().default(true),
      })
    )
    .optional(),
});

/**
 * Replace-mode update: provided arrays fully replace existing rows.
 * Omit a key to leave that aspect untouched.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAnyPermission("catalog-bundles.write", "catalog.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;

  if (body.components) {
    await db.delete(bundleComponents).where(eq(bundleComponents.bundleId, id));
    if (body.components.length > 0) {
      await db.insert(bundleComponents).values(
        body.components.map((c) => ({
          bundleId: id,
          variantId: c.variantId ?? null,
          productId: c.productId ?? null,
          qty: c.qty,
          selectorGroupKey: c.selectorGroupKey ?? null,
          selectorOptionLabel: c.selectorOptionLabel ?? null,
          isOptional: c.isOptional,
          isVisible: c.isVisible,
        }))
      );
    }
  }

  if (body.selectors) {
    await db.delete(bundleSelectors).where(eq(bundleSelectors.bundleId, id));
    if (body.selectors.length > 0) {
      await db.insert(bundleSelectors).values(
        body.selectors.map((s) => ({
          bundleId: id,
          groupKey: s.groupKey,
          name: s.name,
          selectorType: s.selectorType,
          isRequired: s.isRequired,
          minSelections: s.minSelections,
          maxSelections: s.maxSelections ?? null,
          sortOrder: s.sortOrder,
        }))
      );
    }
  }

  if (body.configs) {
    await db.delete(bundleConfigs).where(eq(bundleConfigs.bundleId, id));
    if (body.configs.length > 0) {
      await db.insert(bundleConfigs).values(
        body.configs.map((c) => ({
          bundleId: id,
          schoolId: c.schoolId,
          grade: c.grade,
          isActive: c.isActive,
        }))
      );
    }
  }

  // Flush ALL product caches — a bundle component change may affect parent kits
  // that include this bundle as a child, so we can't safely narrow the key scope.
  await invalidateCatalog();

  const sections: string[] = [];
  if (body.components) sections.push(`${body.components.length} component(s)`);
  if (body.selectors) sections.push(`${body.selectors.length} selector(s)`);
  if (body.configs) sections.push(`${body.configs.length} config(s)`);
  if (sections.length > 0) {
    void logAdminActivity(guard, {
      action: "bundle.update",
      entityType: "bundle",
      entityId: id,
      summary: `Updated bundle: ${sections.join(", ")}`,
      req,
    });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAnyPermission("catalog-bundles.write", "catalog.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  await db.delete(productBundles).where(eq(productBundles.id, id));
  // Same broad bust as PATCH — a removed bundle can affect any kit that
  // referenced it as a child.
  await invalidateCatalog();

  void logAdminActivity(guard, {
    action: "bundle.delete",
    entityType: "bundle",
    entityId: id,
    summary: `Deleted bundle ${id}`,
    req,
  });

  return NextResponse.json({ ok: true });
}
