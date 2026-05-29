import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { z } from "zod";
import { eq, like } from "drizzle-orm";
import { db } from "@/db/client";
import { categories } from "@/db/schema";
import { requireAdmin, isResponse } from "@/lib/admin-guard";
import { invalidateCatalog } from "@/lib/cache";

const Body = z.object({
  slug: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  parentId: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

async function pathFor(
  parentId: string | null | undefined,
  slug: string
): Promise<string> {
  if (!parentId) return slug;
  const [parent] = await db
    .select({ path: categories.path })
    .from(categories)
    .where(eq(categories.id, parentId))
    .limit(1);
  return parent ? `${parent.path}.${slug}` : slug;
}

async function rebuildDescendantPaths(rootId: string) {
  // Walk children recursively and refresh their `path` based on parent's path.
  const rows = await db.select().from(categories);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const children = new Map<string | null, typeof rows>();
  rows.forEach((r) => {
    const list = children.get(r.parentId) ?? [];
    list.push(r);
    children.set(r.parentId, list);
  });

  async function walk(parentId: string, parentPath: string) {
    const kids = children.get(parentId) ?? [];
    for (const k of kids) {
      const newPath = `${parentPath}.${k.slug}`;
      if (k.path !== newPath) {
        await db
          .update(categories)
          .set({ path: newPath })
          .where(eq(categories.id, k.id));
      }
      await walk(k.id, newPath);
    }
  }

  const root = byId.get(rootId);
  if (root) await walk(root.id, root.path);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdmin("super");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;

  // Prevent setting a category as its own ancestor (cycle)
  if (body.parentId) {
    const ancestors = new Set<string>();
    let cur: string | null | undefined = body.parentId;
    while (cur) {
      if (cur === id)
        return NextResponse.json(
          { error: "Cannot make a category a descendant of itself" },
          { status: 400 }
        );
      const [row] = await db
        .select({ parentId: categories.parentId })
        .from(categories)
        .where(eq(categories.id, cur))
        .limit(1);
      cur = row?.parentId ?? null;
    }
  }

  const update: Record<string, unknown> = {};
  if (body.slug !== undefined) update.slug = body.slug;
  if (body.name !== undefined) update.name = body.name;
  if (body.parentId !== undefined) update.parentId = body.parentId || null;
  if (body.sortOrder !== undefined) update.sortOrder = body.sortOrder;

  if (body.slug !== undefined || body.parentId !== undefined) {
    // recompute path
    const slug =
      body.slug ??
      (
        await db
          .select({ slug: categories.slug })
          .from(categories)
          .where(eq(categories.id, id))
          .limit(1)
      )[0]?.slug;
    const parentId =
      body.parentId !== undefined
        ? body.parentId
        : (
            await db
              .select({ parentId: categories.parentId })
              .from(categories)
              .where(eq(categories.id, id))
              .limit(1)
          )[0]?.parentId ?? null;
    if (slug != null) {
      update.path = await pathFor(parentId ?? null, slug);
    }
  }

  await db.update(categories).set(update).where(eq(categories.id, id));
  await rebuildDescendantPaths(id);
  // categoryPath is embedded inside cached product DTOs, so a rename or
  // re-parent has to bust the product caches too — not just the categories
  // tree/map. Otherwise shoppers see the old breadcrumb until TTL expires.
  await invalidateCatalog();
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdmin("super");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  // detach children to top-level instead of cascading deletes silently
  await db
    .update(categories)
    .set({ parentId: null })
    .where(eq(categories.parentId, id));
  await db.delete(categories).where(eq(categories.id, id));
  await invalidateCatalog();
  return NextResponse.json({ ok: true });
}
