import "server-only";
import { asc } from "drizzle-orm";
import { db } from "@/db/client";
import { categories } from "@/db/schema";
import { cached } from "@/server/cache";

export type CategoryNode = {
  id: string;
  slug: string;
  name: string;
  path: string;
  children?: CategoryNode[];
};

export type CategoryMapRow = {
  id: string;
  slug: string;
  name: string;
  parentId: string | null;
};

/**
 * Flat id→row lookup for category slug-path walking. Cached separately
 * from getCategoryTree so callers that only need parent-chain traversal
 * (e.g. listProductsForStudent) don't pay the tree-building cost and
 * don't trigger the unbounded full table scan on every render.
 */
export async function getCategoryMap(): Promise<Map<string, CategoryMapRow>> {
  const rows = await cached("categories:map:v2", 60 * 60, async () => {
    const all = await db
      .select({
        id: categories.id,
        slug: categories.slug,
        name: categories.name,
        parentId: categories.parentId,
      })
      .from(categories);
    return all;
  });
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Walk up parent pointers to the root for a leaf category id. Returns
 * the root node, or null if the id is unknown. Cycle-safe (caps walk
 * at 16 hops).
 */
export async function getRootCategoryFor(
  categoryId: string | null | undefined
): Promise<CategoryMapRow | null> {
  if (!categoryId) return null;
  const map = await getCategoryMap();
  let cur = map.get(categoryId) ?? null;
  for (let i = 0; cur && cur.parentId && i < 16; i++) {
    const parent = map.get(cur.parentId);
    if (!parent) break;
    cur = parent;
  }
  return cur;
}

export async function getCategoryTree(): Promise<CategoryNode[]> {
  return cached("categories:tree", 60 * 60, async () => {
    const rows = await db
      .select()
      .from(categories)
      .orderBy(asc(categories.sortOrder), asc(categories.name));

    const map = new Map<string, CategoryNode & { parentId: string | null }>();
    rows.forEach((r) =>
      map.set(r.id, {
        id: r.id,
        slug: r.slug,
        name: r.name,
        path: r.path,
        parentId: r.parentId,
        children: [],
      })
    );

    const roots: CategoryNode[] = [];
    map.forEach((node) => {
      if (node.parentId) {
        const parent = map.get(node.parentId);
        parent?.children?.push(node);
      } else {
        roots.push(node);
      }
    });
    return roots;
  });
}
