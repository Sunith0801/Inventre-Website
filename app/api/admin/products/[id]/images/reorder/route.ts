import { NextResponse } from "next/server";
import { parseBody } from "@/server/parse-body";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { productImages } from "@/db/schema";
import { isResponse, requirePermission } from "@/server/admin-guard";
import { invalidateCatalog } from "@/server/cache";
import { logAdminActivity } from "@/server/activity";

const Body = z.object({
  order: z.array(z.string().uuid()).min(1),
});

/**
 * Bulk-set sortOrder for a product's images. The first id becomes the
 * primary; sortOrder is the array index. Validates that all ids belong to
 * this product before writing.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission("catalog.write");
  if (isResponse(guard)) return guard;
  const { id: productId } = await params;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;

  const owned = await db
    .select({ id: productImages.id })
    .from(productImages)
    .where(
      and(
        eq(productImages.productId, productId),
        inArray(productImages.id, body.order)
      )
    );
  if (owned.length !== body.order.length) {
    return NextResponse.json(
      { error: "One or more image ids do not belong to this product" },
      { status: 400 }
    );
  }

  await db.transaction(async (tx) => {
    // Demote primary on all
    await tx
      .update(productImages)
      .set({ isPrimary: false })
      .where(eq(productImages.productId, productId));
    for (let i = 0; i < body.order.length; i++) {
      await tx
        .update(productImages)
        .set({ sortOrder: i, isPrimary: i === 0 })
        .where(eq(productImages.id, body.order[i]));
    }
  });

  await invalidateCatalog();

  void logAdminActivity(guard, {
    action: "product.image.reorder",
    entityType: "product",
    entityId: productId,
    summary: `Reordered ${body.order.length} product image(s)`,
    req,
  });

  return NextResponse.json({ ok: true });
}
