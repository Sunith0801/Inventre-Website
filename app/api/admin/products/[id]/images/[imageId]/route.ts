import { NextResponse } from "next/server";
import { parseBody } from "@/server/parse-body";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { productImages } from "@/db/schema";
import { isResponse, requirePermission } from "@/server/admin-guard";
import { invalidateCatalog } from "@/server/cache";
import { logAdminActivity } from "@/server/activity";

const PatchBody = z.object({
  alt: z.string().nullable().optional(),
  isPrimary: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
  // Colour tag — product_attribute_values.id this image belongs to
  // (e.g. Colour=Blue). null clears the tag.
  attributeValueId: z.string().uuid().nullable().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; imageId: string }> }
) {
  const guard = await requirePermission("catalog.write");
  if (isResponse(guard)) return guard;
  const { id: productId, imageId } = await params;
  const parsed = await parseBody(req, PatchBody);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;

  // Verify ownership before touching siblings — protects against cross-product
  // ID smuggling and avoids a wasteful demote when the image isn't ours.
  const [owner] = await db
    .select({ id: productImages.id })
    .from(productImages)
    .where(
      and(eq(productImages.id, imageId), eq(productImages.productId, productId))
    )
    .limit(1);
  if (!owner) {
    return NextResponse.json({ error: "image not found" }, { status: 404 });
  }

  // Wrap demote+update in a single transaction so we can never end up in a
  // state where all siblings were demoted but the new primary failed to set.
  await db.transaction(async (tx) => {
    if (body.isPrimary === true) {
      await tx
        .update(productImages)
        .set({ isPrimary: false })
        .where(eq(productImages.productId, productId));
    }
    const update: Record<string, unknown> = {};
    if (body.alt !== undefined) update.alt = body.alt;
    if (body.isPrimary !== undefined) update.isPrimary = body.isPrimary;
    if (body.sortOrder !== undefined) update.sortOrder = body.sortOrder;
    if (body.attributeValueId !== undefined)
      update.attributeValueId = body.attributeValueId;
    if (Object.keys(update).length > 0) {
      await tx
        .update(productImages)
        .set(update)
        .where(
          and(
            eq(productImages.id, imageId),
            eq(productImages.productId, productId)
          )
        );
    }
  });
  await invalidateCatalog();

  void logAdminActivity(guard, {
    action: "product.image.update",
    entityType: "product",
    entityId: productId,
    summary: `Updated product image`,
    req,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; imageId: string }> }
) {
  const guard = await requirePermission("catalog.write");
  if (isResponse(guard)) return guard;
  const { id: productId, imageId } = await params;
  await db
    .delete(productImages)
    .where(
      and(eq(productImages.id, imageId), eq(productImages.productId, productId))
    );
  await invalidateCatalog();

  void logAdminActivity(guard, {
    action: "product.image.delete",
    entityType: "product",
    entityId: productId,
    summary: `Deleted product image`,
    req,
  });

  return NextResponse.json({ ok: true });
}
