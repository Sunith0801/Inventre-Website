import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { parseBody } from "@/lib/parse-body";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { productSchool } from "@/db/schema";
import { requireAdmin, isResponse } from "@/lib/admin-guard";
import { invalidateCatalog } from "@/lib/cache";

const Body = z.object({
  assigned: z.boolean(),
  overridePrice: z.number().int().min(0).nullable().optional(),
  overrideMrp: z.number().int().min(0).nullable().optional(),
  isRequired: z.boolean(),
  customImageUrl: z.string().url().nullable().optional(),
});

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string; schoolId: string }> }
) {
  const guard = await requireAdmin("super");
  if (isResponse(guard)) return guard;
  const { id: productId, schoolId } = await params;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;

  const [existing] = await db
    .select()
    .from(productSchool)
    .where(
      and(
        eq(productSchool.productId, productId),
        eq(productSchool.schoolId, schoolId)
      )
    )
    .limit(1);

  if (!body.assigned) {
    if (existing) {
      await db.delete(productSchool).where(eq(productSchool.id, existing.id));
    }
  } else {
    const values = {
      productId,
      schoolId,
      overridePrice:
        body.overridePrice != null ? body.overridePrice * 100 : null,
      overrideMrp: body.overrideMrp != null ? body.overrideMrp * 100 : null,
      isRequired: body.isRequired,
      customImageUrl: body.customImageUrl ?? null,
    };
    if (existing) {
      await db
        .update(productSchool)
        .set({
          overridePrice: values.overridePrice,
          overrideMrp: values.overrideMrp,
          isRequired: values.isRequired,
          customImageUrl: values.customImageUrl,
        })
        .where(eq(productSchool.id, existing.id));
    } else {
      await db.insert(productSchool).values(values);
    }
  }

  await invalidateCatalog();
  return NextResponse.json({ ok: true });
}
