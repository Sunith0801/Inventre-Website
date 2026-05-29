import { redirect } from "next/navigation";
import { asc, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { products, schools } from "@/db/schema";
import { requireAdmin, isResponse } from "@/lib/admin-guard";
import { PageHeader, Card } from "@/components/admin/ui/primitives";
import { NewBomForm } from "@/components/admin/NewBomForm";

export const dynamic = "force-dynamic";

function rowsOf<T>(res: unknown): T[] {
  return (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as T[];
}

export default async function NewBomPage({
  searchParams,
}: {
  searchParams: Promise<{ schoolId?: string; grade?: string }>;
}) {
  const guard = await requireAdmin("super", "ops");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const sp = await searchParams;

  const schoolRows = await db
    .select({ id: schools.id, name: schools.name })
    .from(schools)
    .orderBy(asc(schools.name));

  const itemRows = await db
    .select({
      id: products.id,
      code: products.itemCode,
      name: products.name,
    })
    .from(products)
    .orderBy(asc(products.name));
  const items = itemRows
    .filter((i) => i.code)
    .map((i) => ({ id: i.id, code: i.code as string, name: i.name }));

  // Only kit / Magic Box products are valid "BOM items".
  const bomItems = rowsOf<{ id: string; code: string | null; name: string }>(
    await db.execute(
      sql`SELECT id, item_code AS code, name FROM products
          WHERE kind IN ('kit','magic_box') AND item_code IS NOT NULL
          ORDER BY name`
    )
  ).map((i) => ({ id: i.id, code: i.code as string, name: i.name }));

  // Per-school grade options for the cascading dropdown. Source of truth is
  // school_grade_mappings — the table the new-school wizard writes to.
  // Falls back to the canonical grade text when no school-given label.
  // (Legacy code read from school_grade_labels which is unsynced; using
  // mappings means a freshly-wizarded school's grades show up here too.)
  const gradeRows = rowsOf<{
    school_id: string;
    grade: string;
    school_grade_name: string;
  }>(
    await db.execute(
      sql`SELECT school_id, grade,
                 COALESCE(school_given_grade_name, grade) AS school_grade_name
            FROM school_grade_mappings
           WHERE grade IS NOT NULL`
    )
  );
  const schoolGrades: Record<string, { value: string; label: string }[]> = {};
  for (const r of gradeRows) {
    (schoolGrades[r.school_id] ||= []).push({
      value: r.grade,
      label:
        r.school_grade_name && r.school_grade_name !== r.grade
          ? `${r.school_grade_name} (${r.grade})`
          : r.grade,
    });
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        breadcrumb={[
          { label: "BOM Master", href: "/admin/boms" },
          { label: "New BOM" },
        ]}
        eyebrow="Catalog"
        title="Create a BOM"
        description="Pick a school + grade, choose the Bookkit / Magic Box item, and map its components."
      />
      <Card>
        <NewBomForm
          schools={schoolRows}
          schoolGrades={schoolGrades}
          items={items}
          bomItems={bomItems}
          initialSchoolId={sp.schoolId}
          initialGrade={sp.grade}
        />
      </Card>
    </div>
  );
}
