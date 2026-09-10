import { NextResponse } from "next/server";
import { parseBody } from "@/server/parse-body";
import { z } from "zod";
import { eq, asc, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { productImages } from "@/db/schema";
import { isResponse, requirePermission } from "@/server/admin-guard";
import { invalidateCatalog } from "@/server/cache";
import { logAdminActivity } from "@/server/activity";

const PostBody = z.object({
  url: z.string().url(),
  alt: z.string().nullable().optional(),
});

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const rows = await db
    .select()
    .from(productImages)
    .where(eq(productImages.productId, id))
    .orderBy(asc(productImages.sortOrder));
  return NextResponse.json({ images: rows });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission("catalog.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  const parsed = await parseBody(req, PostBody);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;

  const [{ n }] = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(productImages)
    .where(eq(productImages.productId, id));

  const [created] = await db
    .insert(productImages)
    .values({
      productId: id,
      url: body.url,
      alt: body.alt ?? null,
      sortOrder: Number(n),
    })
    .returning();
  await invalidateCatalog();

  void logAdminActivity(guard, {
    action: "product.image.add",
    entityType: "product",
    entityId: id,
    summary: `Added product image`,
    req,
  });

  return NextResponse.json({ image: created });
}
