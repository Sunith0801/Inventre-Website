import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { db } from "@/db/client";
import {
  categories,
  productAttributeValues,
  productAttributes,
  productGrades,
  schools,
} from "@/db/schema";
import { requireAnyPermission, isResponse } from "@/lib/admin-guard";
import { PageHeader } from "@/components/admin/ui/primitives";
import { BookkitWizard, type AttributeOption } from "./_wizard";

export const dynamic = "force-dynamic";

export default async function BookkitBuildPage() {
  const guard = await requireAnyPermission("catalog.read", "catalog.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const [catRows, schoolRows, gradeRows, attrRows, valueRows] = await Promise.all([
    db.select().from(categories).orderBy(asc(categories.path)),
    db
      .select({ id: schools.id, name: schools.name })
      .from(schools)
      .orderBy(asc(schools.name)),
    db
      .selectDistinct({ grade: productGrades.grade })
      .from(productGrades),
    db
      .select({
        id: productAttributes.id,
        name: productAttributes.name,
        type: productAttributes.type,
      })
      .from(productAttributes)
      .where(eq(productAttributes.isDisabled, false))
      .orderBy(asc(productAttributes.name)),
    db
      .select({
        id: productAttributeValues.id,
        attributeId: productAttributeValues.attributeId,
        value: productAttributeValues.value,
        displayLabel: productAttributeValues.displayLabel,
      })
      .from(productAttributeValues)
      .where(eq(productAttributeValues.isActive, true))
      .orderBy(asc(productAttributeValues.sortOrder), asc(productAttributeValues.value)),
  ]);
  const gradeOptions = gradeRows
    .map((g) => g.grade)
    .sort((a, b) => {
      const na = parseInt(a.match(/\d+/)?.[0] ?? "");
      const nb = parseInt(b.match(/\d+/)?.[0] ?? "");
      if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
      return a.localeCompare(b);
    });

  return (
    <div>
      <Link
        href="/admin/catalog/build"
        className="inline-flex items-center gap-1 text-[13px] font-medium text-ink-500 hover:text-ink-900"
      >
        <ChevronLeft className="h-3.5 w-3.5" /> Back to type chooser
      </Link>
      <PageHeader
        eyebrow="Catalog · Create new"
        title="New Bookkit"
        description="Books + sub-bundles + optional 2nd/3rd language axes. Writes only NEW rows; existing items aren't touched."
      />
      <BookkitWizard
        categories={catRows.map((c) => ({ id: c.id, label: c.path, name: c.name }))}
        schools={schoolRows}
        gradeOptions={gradeOptions}
        attributes={(() => {
          const valuesByAttr = new Map<string, { id: string; label: string }[]>();
          for (const v of valueRows) {
            const list = valuesByAttr.get(v.attributeId) ?? [];
            list.push({ id: v.id, label: v.displayLabel ?? v.value });
            valuesByAttr.set(v.attributeId, list);
          }
          return attrRows.map<AttributeOption>((a) => ({
            id: a.id,
            name: a.name,
            type: a.type as AttributeOption["type"],
            values: valuesByAttr.get(a.id) ?? [],
          }));
        })()}
      />
    </div>
  );
}
