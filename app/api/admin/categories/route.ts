import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { categories } from "@/db/schema";
import { isResponse, requirePermission } from "@/lib/admin-guard";
import { invalidate } from "@/lib/cache";

const Body = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  parentId: z.string().nullable().optional(),
  sortOrder: z.number().int().default(0),
});

async function pathFor(parentId: string | null | undefined, slug: string) {
  if (!parentId) return slug;
  const [parent] = await db
    .select({ path: categories.path })
    .from(categories)
    .where(eq(categories.id, parentId))
    .limit(1);
  return parent ? `${parent.path}.${slug}` : slug;
}

export async function POST(req: Request) {
  const guard = await requirePermission("catalog.write");
  if (isResponse(guard)) return guard;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;
  const path = await pathFor(body.parentId ?? null, body.slug);
  const [created] = await db
    .insert(categories)
    .values({
      slug: body.slug,
      name: body.name,
      parentId: body.parentId || null,
      sortOrder: body.sortOrder,
      path,
    })
    .returning();
  await invalidate("categories:tree");
  return NextResponse.json({ category: created });
}
