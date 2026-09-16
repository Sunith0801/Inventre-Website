import Link from "next/link";
import { AutoSubmitForm } from "@/components/admin/AutoSubmitForm";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { productAttributes, schools } from "@/db/schema";
import { eq, sql, ilike, or, and } from "drizzle-orm";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";
import { canWritePage } from "@/lib/admin-permissions";
import { Layers, Plus, Hash } from "lucide-react";
import {
  PageHeader,
  Card,
  Th,
  Td,
  Tr,
  Badge,
  EmptyState,
  Button,
  FilterSelect,
  FilterChips,
  Toolbar,
  SearchInput,
} from "@/components/admin/ui/primitives";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

const TYPE_TONE = {
  size: "info",
  color: "violet",
  design: "warning",
  model: "brand",
  other: "default",
} as const;

const TYPE_LABEL = {
  size: "Size",
  color: "Colour",
  design: "Design",
  model: "Model",
  other: "Other",
} as const;

type AttrType = keyof typeof TYPE_TONE;
const TYPES = Object.keys(TYPE_LABEL) as AttrType[];

type ValuePreview = { value: string; label: string | null; hex: string | null };

/** How many value chips a row shows before "+N more". */
const PREVIEW = 6;

export default async function AttributesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; type?: string }>;
}) {
  const guard = await requireAnyPermission("catalog-attributes.read", "catalog-attributes.write", "catalog.read", "catalog.write");
  if (isResponse(guard)) redirect("/admin/dashboard");
  const canWrite = canWritePage(guard.permissions, "catalog-attributes") || canWritePage(guard.permissions, "catalog");

  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const statusFilter = sp.status; // "enabled" | "disabled" | undefined
  const typeFilter = TYPES.includes(sp.type as AttrType) ? (sp.type as AttrType) : null;

  const filters = [];
  if (q) {
    filters.push(or(ilike(productAttributes.name, `%${q}%`), ilike(productAttributes.erpId, `%${q}%`)));
  }
  if (statusFilter === "enabled") filters.push(eq(productAttributes.isDisabled, false));
  else if (statusFilter === "disabled") filters.push(eq(productAttributes.isDisabled, true));
  if (typeFilter) filters.push(eq(productAttributes.type, typeFilter));

  // One round-trip: the row, its first few active values (for the chip
  // preview) and how many products bind it. The preview is what lets a
  // catalogue admin tell "Shirt Size" from "Trouser Size" without opening
  // either.
  const baseQuery = db
    .select({
      attr: productAttributes,
      schoolName: schools.name,
      valueCount: sql<number>`(SELECT COUNT(*) FROM product_attribute_values v WHERE v.attribute_id = ${productAttributes.id})::int`,
      usedBy: sql<number>`(SELECT COUNT(*) FROM product_attribute_bindings b WHERE b.attribute_id = ${productAttributes.id})::int`,
      preview: sql<ValuePreview[]>`(
        SELECT COALESCE(json_agg(json_build_object('value', x.value, 'label', x.display_label, 'hex', x.hex_color) ORDER BY x.sort_order), '[]'::json)
          FROM (SELECT value, display_label, hex_color, sort_order
                  FROM product_attribute_values v
                 WHERE v.attribute_id = ${productAttributes.id} AND v.is_active
                 ORDER BY v.sort_order LIMIT ${PREVIEW}) x
      )`,
    })
    .from(productAttributes)
    .leftJoin(schools, eq(schools.id, productAttributes.schoolId))
    .orderBy(productAttributes.type, productAttributes.sortOrder, productAttributes.name);

  const rows =
    filters.length > 0
      ? await baseQuery.where(filters.length === 1 ? filters[0] : and(...filters))
      : await baseQuery;

  // Per-type counts for the chips — over the unfiltered set so the chips
  // stay stable while the user narrows.
  const typeCounts = await db
    .select({ type: productAttributes.type, n: sql<number>`count(*)::int` })
    .from(productAttributes)
    .groupBy(productAttributes.type);
  const countOf = (t: AttrType) => typeCounts.find((r) => r.type === t)?.n ?? 0;
  const total = typeCounts.reduce((a, r) => a + r.n, 0);

  const filtered = Boolean(q || statusFilter || typeFilter);
  const chipHref = (t: AttrType | null) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (statusFilter) p.set("status", statusFilter);
    if (t) p.set("type", t);
    const s = p.toString();
    return `/admin/catalog/attributes${s ? `?${s}` : ""}`;
  };

  const addButton = canWrite ? (
    <Link href="/admin/catalog/attributes/new">
      <Button icon={<Plus className="h-3.5 w-3.5" />} variant="primary">
        Add attribute
      </Button>
    </Link>
  ) : null;

  return (
    <div>
      <PageHeader
        eyebrow="Products"
        title="Attributes"
        description="The axes a product can vary on — size, colour, design — and the values each one allows. Variants are built from these."
        actions={addButton}
      />

      <AutoSubmitForm action="/admin/catalog/attributes">
        <Toolbar>
          <SearchInput defaultValue={q ?? ""} placeholder="Search by name or ERP id…" />
          <FilterSelect label="Status" name="status" defaultValue={statusFilter ?? ""}>
            <option value="enabled">Enabled</option>
            <option value="disabled">Disabled</option>
          </FilterSelect>
          {filtered ? (
            <Link href="/admin/catalog/attributes" className="text-[12.5px] text-ink-500 hover:text-ink-900">
              Clear
            </Link>
          ) : null}
        </Toolbar>
      </AutoSubmitForm>

      {/* Type chips sit outside the auto-submit form: they are links, and a
          count on each tells the admin how the catalogue is shaped before
          they click. */}
      <div className="mb-4 -mt-1 flex flex-wrap items-center gap-1 text-[12px]">
        {[null, ...TYPES].map((t) => {
          const active = typeFilter === t;
          const n = t ? countOf(t) : total;
          return (
            <Link
              key={t ?? "all"}
              href={chipHref(t)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium transition-colors",
                active ? "bg-ink-900 text-white" : "text-ink-600 hover:bg-cream-100 hover:text-ink-900",
              )}
            >
              {t ? TYPE_LABEL[t] : "All"}
              <span className={cn("tabular-nums", active ? "text-white/70" : "text-ink-400")}>{n}</span>
            </Link>
          );
        })}
      </div>

      <Card padded={false} className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon={Layers}
            title={filtered ? "No attributes match" : "No attributes yet"}
            description={filtered ? "Try clearing the filter, or create a new attribute." : "Create the first axis products vary on — a size run is the usual start."}
            action={addButton}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <Th>Attribute</Th>
                  <Th>Type</Th>
                  <Th>Values</Th>
                  <Th>Scope</Th>
                  <Th right>Used by</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const numeric = r.attr.isNumeric;
                  const more = Math.max(0, r.valueCount - r.preview.length);
                  return (
                    <Tr key={r.attr.id} className={r.attr.isDisabled ? "opacity-60" : undefined}>
                      <Td>
                        <Link href={`/admin/catalog/attributes/${r.attr.id}`} className="group/name block min-w-[180px]">
                          <span className="block font-semibold text-ink-900 group-hover/name:text-brand-700">{r.attr.name}</span>
                          {r.attr.erpId || r.attr.description ? (
                            <span className="block max-w-[320px] truncate text-[12px] font-normal text-ink-500">
                              {r.attr.erpId ? <span className="font-mono">{r.attr.erpId}</span> : null}
                              {r.attr.erpId && r.attr.description ? " · " : ""}
                              {r.attr.description ?? ""}
                            </span>
                          ) : null}
                        </Link>
                      </Td>
                      <Td>
                        <Badge tone={TYPE_TONE[r.attr.type]} size="sm">
                          {TYPE_LABEL[r.attr.type]}
                        </Badge>
                      </Td>
                      <Td>
                        {numeric ? (
                          <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-600">
                            <Hash className="h-3.5 w-3.5 text-ink-400" />
                            {r.attr.numericFromRange ?? "?"} – {r.attr.numericToRange ?? "?"}
                            {r.attr.numericIncrement ? <span className="text-ink-400">step {r.attr.numericIncrement}</span> : null}
                          </span>
                        ) : r.valueCount === 0 ? (
                          <span className="text-[12px] italic text-ink-400">No values</span>
                        ) : (
                          <span className="flex flex-wrap items-center gap-1">
                            {r.preview.map((v) => (
                              <span
                                key={v.value}
                                title={v.label && v.label !== v.value ? `${v.value} (${v.label})` : v.value}
                                className="inline-flex max-w-[120px] items-center gap-1 rounded-md border border-ink-100 bg-cream-50 px-1.5 py-0.5 text-[11px] font-medium text-ink-700"
                              >
                                {r.attr.type === "color" && v.hex ? (
                                  <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-black/10" style={{ background: v.hex }} />
                                ) : null}
                                <span className="truncate">{v.label || v.value}</span>
                              </span>
                            ))}
                            {more > 0 ? <span className="text-[11px] text-ink-400">+{more} more</span> : null}
                          </span>
                        )}
                      </Td>
                      <Td muted>
                        {r.schoolName ? (
                          <Badge tone="subtle" size="sm">{r.schoolName}</Badge>
                        ) : (
                          <span className="text-[12px] text-ink-400">Global</span>
                        )}
                      </Td>
                      <Td right>
                        {r.usedBy ? (
                          <span className="tabular-nums">{r.usedBy.toLocaleString("en-IN")} <span className="text-[12px] font-normal text-ink-400">products</span></span>
                        ) : (
                          <span className="text-[12px] text-ink-400">—</span>
                        )}
                      </Td>
                      <Td>
                        <Badge tone={r.attr.isDisabled ? "default" : "success"} dot size="sm">
                          {r.attr.isDisabled ? "Disabled" : "Enabled"}
                        </Badge>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
