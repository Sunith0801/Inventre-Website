import { asc } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { categories, schools, productGrades } from "@/db/schema";
import { ProductForm } from "@/components/admin/ProductForm";
import { requireAnyPermission, isResponse } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  const guard = await requireAnyPermission("catalog.read", "catalog.write");
  if (isResponse(guard)) redirect("/admin/dashboard");
  const cats = await db.select().from(categories).orderBy(asc(categories.path));
  const schoolRows = await db
    .select({ id: schools.id, name: schools.name })
    .from(schools)
    .orderBy(asc(schools.name));
  const gradeOptions = (
    await db.selectDistinct({ grade: productGrades.grade }).from(productGrades)
  )
    .map((g) => g.grade)
    .sort((a, b) => {
      const na = parseInt(a.match(/\d+/)?.[0] ?? ""),
        nb = parseInt(b.match(/\d+/)?.[0] ?? "");
      if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
      return a.localeCompare(b);
    });

  return (
    <div className="max-w-3xl">
      <a
        href="/admin/products"
        className="text-[13px] font-medium text-ink-500 hover:text-ink-900"
      >
        ← All products
      </a>
      <h1 className="mt-3 font-display text-[28px] font-extrabold tracking-tight text-ink-900">
        New product
      </h1>
      <div className="mt-6">
        <ProductForm
          categories={cats.map((c) => ({ id: c.id, label: c.path, name: c.name }))}
          schools={schoolRows}
          gradeOptions={gradeOptions}
        />
      </div>
    </div>
  );
}
