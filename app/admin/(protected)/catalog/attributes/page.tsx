import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { productAttributes, schools } from "@/db/schema";
import { eq, sql, ilike, or, and } from "drizzle-orm";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";
import { Layers, Plus } from "lucide-react";
import {
  PageHeader,
  Card,
  Th,
  Td,
  Tr,
  Badge,
  EmptyState,
  Button,
} from "@/components/admin/ui/primitives";

export const dynamic = "force-dynamic";

const TYPE_TONE = {
  size: "info",
  color: "violet",
  design: "warning",
  model: "brand",
  other: "default",
} as const;

export default async function AttributesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const guard = await requireAnyPermission("catalog.read", "catalog.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const statusFilter = sp.status; // "enabled" | "disabled" | undefined

  const filters = [];
  if (q) {
    filters.push(
      or(
        ilike(productAttributes.name, `%${q}%`),
        ilike(productAttributes.erpId, `%${q}%`)
      )
    );
  }
  if (statusFilter === "enabled") {
    filters.push(eq(productAttributes.isDisabled, false));
  } else if (statusFilter === "disabled") {
    filters.push(eq(productAttributes.isDisabled, true));
  }

  const baseQuery = db
    .select({
      attr: productAttributes,
      schoolName: schools.name,
      valueCount: sql<number>`(SELECT COUNT(*) FROM product_attribute_values v WHERE v.attribute_id = ${productAttributes.id})::int`,
    })
    .from(productAttributes)
    .leftJoin(schools, eq(schools.id, productAttributes.schoolId))
    .orderBy(productAttributes.type, productAttributes.name);

  const rows =
    filters.length > 0
      ? await baseQuery.where(filters.length === 1 ? filters[0] : and(...filters))
      : await baseQuery;

  return (
    <div>
      <PageHeader
        eyebrow="Catalog"
        title="Item Attribute"
        description={`${rows.length} item attributes · variant dimensions (sizes, colours, designs, models, school subject selections).`}
        actions={
          <Link href="/admin/catalog/attributes/new">
            <Button icon={<Plus className="h-3.5 w-3.5" />} variant="primary">
              Add Item Attribute
            </Button>
          </Link>
        }
      />

      {/* ── Filter bar (mirrors ERP "%%" search + status pills) ── */}
      <form className="mb-4 flex flex-wrap items-center gap-2" method="get">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Filter by name or ERP id…"
          className="h-9 px-3 text-[13px] rounded-lg bg-white border border-ink-200 placeholder:text-ink-400 focus:outline-none focus:border-ink-400 focus:ring-2 focus:ring-brand-300/30 transition w-72"
        />
        <select
          name="status"
          defaultValue={statusFilter ?? ""}
          className="h-9 px-3 text-[13px] rounded-lg bg-white border border-ink-200 focus:outline-none focus:border-ink-400 focus:ring-2 focus:ring-brand-300/30 transition"
        >
          <option value="">All status</option>
          <option value="enabled">Enabled only</option>
          <option value="disabled">Disabled only</option>
        </select>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
        {(q || statusFilter) && (
          <Link
            href="/admin/catalog/attributes"
            className="text-[13px] text-ink-500 hover:text-ink-700 px-2"
          >
            Clear
          </Link>
        )}
      </form>

      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState
            icon={Layers}
            title="No attributes match"
            description="Try clearing the filter, or create a new attribute."
            action={
              <Link href="/admin/catalog/attributes/new">
                <Button icon={<Plus className="h-3.5 w-3.5" />}>Add Item Attribute</Button>
              </Link>
            }
          />
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th>ID</Th>
                <Th>Status</Th>
                <Th>Attribute Name</Th>
                <Th>Type</Th>
                <Th>Scope</Th>
                <Th right>Values</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.attr.id}>
                  <Td>
                    <span className="font-mono text-[11px] text-ink-500">
                      {r.attr.erpId ?? r.attr.id.slice(0, 8)}
                    </span>
                  </Td>
                  <Td>
                    <Badge
                      tone={r.attr.isDisabled ? "default" : "info"}
                      size="sm"
                    >
                      {r.attr.isDisabled ? "Disabled" : "Enabled"}
                    </Badge>
                  </Td>
                  <Td>
                    <Link
                      href={`/admin/catalog/attributes/${r.attr.id}`}
                      className="font-medium text-ink-900 hover:text-brand-700 transition-colors"
                    >
                      {r.attr.name}
                    </Link>
                    {r.attr.description ? (
                      <div className="text-[11px] text-ink-500 mt-0.5 truncate">
                        {r.attr.description}
                      </div>
                    ) : null}
                  </Td>
                  <Td>
                    <Badge tone={TYPE_TONE[r.attr.type]} size="sm">
                      {r.attr.type}
                    </Badge>
                  </Td>
                  <Td muted>
                    {r.schoolName ? (
                      <Badge tone="subtle" size="sm">
                        {r.schoolName}
                      </Badge>
                    ) : (
                      <span className="text-ink-400 text-[12px]">Global</span>
                    )}
                  </Td>
                  <Td right>
                    <span className="tabular-nums font-semibold">{r.valueCount}</span>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
