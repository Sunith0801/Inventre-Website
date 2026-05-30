import { NextResponse } from "next/server";
import { z } from "zod";
import { inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { products } from "@/db/schema";
import { isResponse, requirePermission } from "@/lib/admin-guard";
import { invalidateCatalog } from "@/lib/cache";

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
  const guard = await requirePermission("catalog.write");
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

  const updated = await db
    .update(products)
    .set({ status: body.status })
    .where(inArray(products.id, body.ids))
    .returning({ id: products.id });

  await invalidateCatalog();

  return NextResponse.json({ ok: true, updated: updated.length });
}
