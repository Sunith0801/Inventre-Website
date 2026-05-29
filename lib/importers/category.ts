import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { categories } from "@/db/schema";
import type { DocTypeImporter, ImportRow } from "./_types";
import { pickField, pickInt } from "./_types";

/**
 * Item Group / Category importer.
 *
 * Idempotent on `slug`. Resolves `parent_name` lazily — categories whose
 * parent is also being imported will resolve once the parent row lands.
 *
 * Required headers:
 *   - name OR item_group_name
 *   - slug (preferred) OR auto-derived from name
 * Optional:
 *   - parent_name (must match an existing or freshly-imported category name)
 *   - sort_order
 */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function buildPath(parentId: string | null, slug: string): Promise<string> {
  if (!parentId) return slug;
  const [parent] = await db
    .select({ path: categories.path })
    .from(categories)
    .where(eq(categories.id, parentId))
    .limit(1);
  return parent ? `${parent.path}/${slug}` : slug;
}

export const categoryImporter: DocTypeImporter = {
  doctype: "Category",
  filenameHints: ["category", "categories", "item_group", "itemgroup"],
  signatureHeaders: ["item_group_name", "name", "slug"],

  async processOne(row: ImportRow) {
    const name =
      pickField(row, "item_group_name", "Item Group Name", "name", "Name");
    if (!name) return { result: "skipped", error: "missing name" };
    const slug = pickField(row, "slug") ?? slugify(name);
    const parentName = pickField(row, "parent_name", "parent_item_group");
    const sortOrder = pickInt(row, "sort_order") ?? 0;

    let parentId: string | null = null;
    if (parentName) {
      const [p] = await db
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.name, parentName))
        .limit(1);
      parentId = p?.id ?? null;
    }
    const path = await buildPath(parentId, slug);

    const existing = await db
      .select()
      .from(categories)
      .where(eq(categories.slug, slug))
      .limit(1);
    if (existing[0]) {
      await db
        .update(categories)
        .set({ name, parentId, sortOrder, path })
        .where(eq(categories.id, existing[0].id));
      return { result: "updated" };
    }
    await db.insert(categories).values({
      name,
      slug,
      parentId,
      sortOrder,
      path,
    });
    return { result: "new" };
  },
};
