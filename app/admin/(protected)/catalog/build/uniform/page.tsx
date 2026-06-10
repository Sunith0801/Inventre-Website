import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { db } from "@/db/client";
import {
  categories,
  productAttributeValues,
  productAttributes,
} from "@/db/schema";
import { requireAnyPermission, isResponse } from "@/lib/admin-guard";
import { PageHeader } from "@/components/admin/ui/primitives";
import { UniformWizard, type AttributeOption } from "./_wizard";

export const dynamic = "force-dynamic";

export default async function UniformBuildPage() {
  const guard = await requireAnyPermission("catalog.read", "catalog.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const [catRows, attrRows, valueRows] = await Promise.all([
    db.select().from(categories).orderBy(asc(categories.path)),
    db
      .select({
        id: productAttributes.id,
        name: productAttributes.name,
        type: productAttributes.type,
        isDisabled: productAttributes.isDisabled,
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
        sortOrder: productAttributeValues.sortOrder,
        isActive: productAttributeValues.isActive,
      })
      .from(productAttributeValues)
      .where(eq(productAttributeValues.isActive, true))
      .orderBy(asc(productAttributeValues.sortOrder), asc(productAttributeValues.value)),
  ]);

  const valuesByAttr = new Map<string, { id: string; label: string }[]>();
  for (const v of valueRows) {
    const list = valuesByAttr.get(v.attributeId) ?? [];
    list.push({ id: v.id, label: v.displayLabel ?? v.value });
    valuesByAttr.set(v.attributeId, list);
  }
  const attributeOptions: AttributeOption[] = attrRows.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type as AttributeOption["type"],
    values: valuesByAttr.get(a.id) ?? [],
  }));

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
        title="New Uniform"
        description="Two steps: name the product, then pick the Colour and Size values. The wizard creates one SKU per Colour × Size cell. After save you land on the product page where you add per-variant prices, images, and link schools."
      />
      <UniformWizard
        categories={catRows.map((c) => ({ id: c.id, label: c.path, name: c.name }))}
        attributes={attributeOptions}
      />
    </div>
  );
}
