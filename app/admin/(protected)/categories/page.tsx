import { asc } from "drizzle-orm";
import { db } from "@/db/client";
import { categories } from "@/db/schema";
import { CategoryEditor } from "@/components/admin/CategoryEditor";
import { redirect } from "next/navigation";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";
import { PageHeader } from "@/components/admin/ui/primitives";

export default async function CategoriesPage() {
  const guard = await requireAnyPermission("catalog.read", "catalog.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const rows = await db
    .select()
    .from(categories)
    .orderBy(asc(categories.path));

  return (
    <div className="max-w-5xl">
      <PageHeader
        eyebrow="Products"
        title="Categories"
        description={`${rows.length} categor${rows.length === 1 ? "y" : "ies"} — the tree products are filed under, as shown on the shop.`}
      />
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
  );
}
