import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db/client";
import { productAttributes, productAttributeValues, productAttributeBindings, products, schools } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { Package, ChevronRight } from "lucide-react";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";
import { canWritePage } from "@/lib/admin-permissions";
import { PageHeader, Card, CardHeader, Badge } from "@/components/admin/ui/primitives";
import { AttributeEditor } from "@/components/admin/AttributeEditor";
import { AttributeDetailsForm } from "@/components/admin/attributes/AttributeDetailsForm";
import { DeleteAttributeButton } from "@/components/admin/attributes/DeleteAttributeButton";
import { RecordHistory } from "@/components/admin/RecordHistory";

export const dynamic = "force-dynamic";

const TYPE_LABEL = { size: "Size", color: "Colour", design: "Design", model: "Model", other: "Other" } as const;
const TYPE_TONE = { size: "info", color: "violet", design: "warning", model: "brand", other: "default" } as const;

export default async function AttributeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const guard = await requireAnyPermission("catalog-attributes.read", "catalog-attributes.write", "catalog.read", "catalog.write");
  if (isResponse(guard)) redirect("/admin/dashboard");
  const canWrite = canWritePage(guard.permissions, "catalog-attributes") || canWritePage(guard.permissions, "catalog");

  const { id } = await params;

  const [attr] = await db.select().from(productAttributes).where(eq(productAttributes.id, id)).limit(1);
  if (!attr) notFound();

  const [values, school, usage] = await Promise.all([
    db.select().from(productAttributeValues).where(eq(productAttributeValues.attributeId, id)).orderBy(productAttributeValues.sortOrder),
    attr.schoolId
      ? db.select({ name: schools.name }).from(schools).where(eq(schools.id, attr.schoolId)).limit(1).then((r) => r[0] ?? null)
      : Promise.resolve(null),
    // Which products bind this attribute. Shown so the admin knows what a
    // value change reaches, and it is what makes delete safe: the FK is
    // ON DELETE RESTRICT, so a delete with bindings would fail at the
    // database rather than in the UI.
    db
      .select({
        id: products.id,
        name: products.name,
        total: sql<number>`count(*) over()::int`,
      })
      .from(productAttributeBindings)
      .innerJoin(products, eq(products.id, productAttributeBindings.productId))
      .where(eq(productAttributeBindings.attributeId, id))
      .orderBy(products.name)
      .limit(6),
  ]);
  const usedBy = usage[0]?.total ?? 0;

  return (
    <div>
      <PageHeader
        eyebrow="Products"
        breadcrumb={[{ label: "Attributes", href: "/admin/catalog/attributes" }, { label: attr.name }]}
        title={attr.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={attr.isDisabled ? "default" : "success"} dot size="sm">
              {attr.isDisabled ? "Disabled" : "Enabled"}
            </Badge>
            <Badge tone={TYPE_TONE[attr.type]} size="sm">{TYPE_LABEL[attr.type]}</Badge>
            <Badge tone="subtle" size="sm">{school ? school.name : "Global"}</Badge>
            {attr.erpId ? <span className="font-mono text-[12px] text-ink-400">{attr.erpId}</span> : null}
          </span>
        }
        actions={canWrite ? <DeleteAttributeButton attributeId={attr.id} name={attr.name} usedBy={usedBy} /> : null}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Card>
            <AttributeEditor
              attributeId={attr.id}
              attributeType={attr.type}
              readOnly={!canWrite}
              initialIsDisabled={attr.isDisabled}
              initialIsNumeric={attr.isNumeric}
              initialFromRange={attr.numericFromRange != null ? Number(attr.numericFromRange) : null}
              initialToRange={attr.numericToRange != null ? Number(attr.numericToRange) : null}
              initialIncrement={attr.numericIncrement != null ? Number(attr.numericIncrement) : null}
              initialValues={values.map((v) => ({
                id: v.id,
                value: v.value,
                displayLabel: v.displayLabel,
                shortCode: v.shortCode,
                hexColor: v.hexColor,
                sortOrder: v.sortOrder,
                isActive: v.isActive,
              }))}
            />
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Details" description="Name and notes. The type and scope are fixed once products use it." />
            <AttributeDetailsForm
              attributeId={attr.id}
              readOnly={!canWrite}
              initial={{ name: attr.name, description: attr.description ?? "", sortOrder: attr.sortOrder }}
            />
          </Card>

          <Card padded={false}>
            <div className="px-5 pt-5 pb-2">
              <CardHeader
                title="Used by"
                description={usedBy ? `${usedBy.toLocaleString("en-IN")} product${usedBy === 1 ? "" : "s"} vary on this attribute.` : "No product uses this attribute yet."}
                className="mb-0"
              />
            </div>
            {usage.length ? (
              <ul className="divide-y divide-ink-100/70">
                {usage.map((p) => (
                  <li key={p.id}>
                    <Link href={`/admin/products/${p.id}`} className="group flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-cream-50">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-cream-100 text-ink-500">
                        <Package className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink-800">{p.name}</span>
                      <ChevronRight className="h-3.5 w-3.5 text-ink-300 transition-colors group-hover:text-ink-600" />
                    </Link>
                  </li>
                ))}
                {usedBy > usage.length ? (
                  <li className="px-5 py-2.5 text-[12px] text-ink-500">and {(usedBy - usage.length).toLocaleString("en-IN")} more</li>
                ) : null}
              </ul>
            ) : (
              <div className="px-5 pb-5 text-[12px] text-ink-500">
                Bind it from a product&rsquo;s <span className="font-medium text-ink-700">Variants</span> tab.
              </div>
            )}
          </Card>
        </div>
      </div>

      <div className="mt-5">
        <RecordHistory entityType="attribute" entityId={id} title="Attribute history" />
      </div>
    </div>
  );
}
