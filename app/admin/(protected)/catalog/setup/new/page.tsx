import { redirect } from "next/navigation";
import { asc, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { grades as gradesTable } from "@/db/schema";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";
import { PageHeader } from "@/components/admin/ui/primitives";
import { NewSchoolWizard } from "@/components/admin/NewSchoolWizard";
import { compareGrades } from "@/lib/sort-grades";

export const dynamic = "force-dynamic";

function rowsOf<T>(res: unknown): T[] {
  return (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as T[];
}

export default async function NewSchoolWizardPage() {
  const guard = await requireAnyPermission("catalog.read", "catalog.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  // ── Grade master list (active rows only). The wizard offers these as
  //    pre-checkable options, plus an "Add custom" fallback that just
  //    pushes a free-text grade string.
  const masterRows = await db
    .select({
      name: gradesTable.gradeName,
      code: gradesTable.gradeCode,
      status: gradesTable.status,
    })
    .from(gradesTable)
    .orderBy(asc(gradesTable.gradeName));

  const master = masterRows
    .filter((r) => r.name && (r.status === null || /active/i.test(r.status ?? "")))
    .map((r) => ({ name: r.name as string, code: r.code }));

  // ── Sensible pre-checked subset. Anything matching "Grade <N>" (1-12)
  //    or nursery/kg style is pre-selected. Admin can un-check.
  const isCommon = (name: string) =>
    /^(grade\s+\d+|nursery|pre[- ]?k|lkg|ukg|kindergarten)$/i.test(name.trim());

  // ── Also surface the *distinct grade strings actually used* by other
  //    schools in product_grades — so if your data uses "Grade 1" today,
  //    the wizard offers that exact string and we avoid creating a
  //    near-duplicate like "Grade I".
  const usedRows = rowsOf<{ grade: string }>(
    await db.execute(sql`
      SELECT DISTINCT grade FROM product_grades WHERE grade IS NOT NULL ORDER BY grade
    `)
  );
  const usedNames = new Set(usedRows.map((r) => r.grade));
  const merged: { name: string; common: boolean; inUse: boolean; code: string | null }[] = [];
  const seen = new Set<string>();

  for (const m of master) {
    seen.add(m.name);
    merged.push({ name: m.name, common: isCommon(m.name), inUse: usedNames.has(m.name), code: m.code });
  }
  for (const u of usedRows) {
    if (seen.has(u.grade)) continue;
    seen.add(u.grade);
    merged.push({ name: u.grade, common: isCommon(u.grade), inUse: true, code: null });
  }

  // Natural order: Nursery → KG → Grade 1 → Grade 2 … not lexicographic.
  merged.sort((a, b) => compareGrades(a.name, b.name));

  return (
    <div>
      <PageHeader
        eyebrow="Catalog · Setup"
        title="Add a new school"
        description="Two short steps: basics first, then which grades the school serves. After that you'll get a launch pad to tag items, add Magic Boxes, or preview as a parent."
        breadcrumb={[
          { label: "Admin", href: "/admin/dashboard" },
          { label: "Catalog", href: "/admin/catalog" },
          { label: "Setup", href: "/admin/catalog/setup" },
          { label: "New school" },
        ]}
      />

      <NewSchoolWizard masterGrades={merged} />
    </div>
  );
}
