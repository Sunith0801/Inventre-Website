import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { productAttributes, productAttributeValues, schools } from "@/db/schema";
import { eq } from "drizzle-orm";
import { PageHeader, Card, Badge } from "@/components/admin/ui/primitives";
import { AttributeEditor } from "@/components/admin/AttributeEditor";
import { RecordHistory } from "@/components/admin/RecordHistory";

export const dynamic = "force-dynamic";

export default async function AttributeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [attr] = await db
    .select()
    .from(productAttributes)
    .where(eq(productAttributes.id, id))
    .limit(1);
  if (!attr) notFound();

  const values = await db
    .select()
    .from(productAttributeValues)
    .where(eq(productAttributeValues.attributeId, id))
    .orderBy(productAttributeValues.sortOrder);

  const [school] = attr.schoolId
    ? await db
        .select({ name: schools.name })
        .from(schools)
        .where(eq(schools.id, attr.schoolId))
        .limit(1)
    : [null];

  return (
    <div className="max-w-4xl">
      <PageHeader
        breadcrumb={[
          { label: "Catalog", href: "/admin/catalog/attributes" },
          { label: "Attributes", href: "/admin/catalog/attributes" },
          { label: attr.name },
        ]}
        title={attr.name}
        eyebrow="Attribute"
        description={
          <span className="flex items-center gap-2">
            <Badge tone={attr.isDisabled ? "default" : "info"} size="sm">
              {attr.isDisabled ? "Disabled" : "Enabled"}
            </Badge>
            <Badge tone="subtle" size="sm">
              {attr.type}
            </Badge>
            {school ? (
              <Badge tone="info" size="sm">
                {school.name}
              </Badge>
            ) : (
              <Badge tone="default" size="sm">
                Global
              </Badge>
            )}
            {attr.description ? (
              <span className="text-ink-500">· {attr.description}</span>
            ) : null}
          </span>
        }
      />

      <Card>
        <AttributeEditor
          attributeId={attr.id}
          attributeType={attr.type}
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

      <div className="mt-5">
        <RecordHistory entityType="attribute" entityId={id} title="Attribute history" />
      </div>
    </div>
  );
}
