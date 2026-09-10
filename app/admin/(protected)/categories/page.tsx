import { asc } from "drizzle-orm";
import { db } from "@/db/client";
import { categories } from "@/db/schema";
import { CategoryEditor } from "@/components/admin/CategoryEditor";
import { redirect } from "next/navigation";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";

export default async function CategoriesPage() {
  const guard = await requireAnyPermission("catalog.read", "catalog.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const rows = await db
    .select()
    .from(categories)
    .orderBy(asc(categories.path));

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-[28px] font-extrabold tracking-tight text-ink-900">
        Categories
      </h1>
      <p className="mt-1 text-[14px] text-ink-500">
        Hierarchical tree used by the shop filter sidebar. Path is auto-built
        from slug + parent.
      </p>
      <div className="mt-6">
        <CategoryEditor
          initial={rows.map((c) => ({
            id: c.id,
            slug: c.slug,
            name: c.name,
            parentId: c.parentId,
            path: c.path,
            sortOrder: c.sortOrder,
          }))}
        />
      </div>
    </div>
  );
}
