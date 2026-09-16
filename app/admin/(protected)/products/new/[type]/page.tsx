import { asc, like } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db/client";
import { categories, schools, productGrades } from "@/db/schema";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";
import { PageHeader, Card } from "@/components/admin/ui/primitives";
import { NewProductBasics } from "@/components/admin/products/NewProductBasics";
import { KIND_META, isCreateKind } from "@/components/admin/products/product-kinds";

export const dynamic = "force-dynamic";

const CANONICAL = ["Nursery", "LKG", "UKG", ...Array.from({ length: 12 }, (_, i) => `Grade ${i + 1}`)];
const gradeIdx = (g: string) => {
  const i = CANONICAL.indexOf(g);
  if (i >= 0) return i;
  const n = parseInt(g.match(/\d+/)?.[0] ?? "");
  return 100 + (isNaN(n) ? 99 : n);
};

const STEP_COUNT: Record<string, number> = { uniform: 6, book: 4, accessory: 5, consumable: 4, kit: 4, magic_box: 4 };

export default async function NewProductStep1({ params }: { params: Promise<{ type: string }> }) {
  const guard = await requireAnyPermission("products.write", "catalog.write");
  if (isResponse(guard)) redirect("/admin/products");

  const { type } = await params;
  if (!isCreateKind(type)) notFound();
  const kind = type;

  const [cats, sections, schoolRows, gradeRows] = await Promise.all([
    db.select({ id: categories.id, label: categories.path, path: categories.path }).from(categories).orderBy(asc(categories.path)),
    db.select({ id: categories.id, name: categories.name }).from(categories).where(like(categories.path, "book-kit.%")).orderBy(asc(categories.sortOrder)),
    db.select({ id: schools.id, name: schools.name }).from(schools).orderBy(asc(schools.name)),
    db.selectDistinct({ grade: productGrades.grade }).from(productGrades),
  ]);
  const grades = [...new Set([...CANONICAL, ...gradeRows.map((g) => g.grade)])].sort((a, b) => gradeIdx(a) - gradeIdx(b) || a.localeCompare(b));

  return (
    <div className="max-w-3xl">
      <PageHeader
        eyebrow="Products"
        breadcrumb={[{ label: "Products", href: "/admin/products" }, { label: "New", href: "/admin/products/new" }, { label: KIND_META[kind].label }]}
        title={`New ${KIND_META[kind].label.toLowerCase()}`}
        description={`Step 1 of ${STEP_COUNT[kind] ?? 5} — who it's for and what it is. Everything else has its own step.`}
      />
      <Card>
        <NewProductBasics kind={kind} schools={schoolRows} grades={grades} categories={cats} sections={sections} />
      </Card>
    </div>
  );
}
