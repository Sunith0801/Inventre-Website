import { notFound, redirect } from "next/navigation";
import { asc, desc, ilike, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import Link from "next/link";
import { Database, Download } from "lucide-react";
import { db } from "@/db/client";
import { masterEntity, type MasterColumn } from "@/lib/master-data";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";
import {
  PageHeader,
  Toolbar,
  SearchInput,
  FilterSelect,
  Th,
  Badge,
  EmptyState,
  Pagination,
  statusTone,
  Button,
} from "@/components/admin/ui/primitives";
import { AutoSubmitForm } from "@/components/admin/AutoSubmitForm";

export const dynamic = "force-dynamic";

const PAGE_SIZES = [25, 50, 100] as const;

// The screen shows each entity's key fields — its column list is ordered
// most-useful first, so this is simply the head of it. The Excel export
// carries every field.
const SCREEN_FIELDS = 8;

// Where the editable record lives — the pinned first column links there.
const RECORD_HREF: Record<string, string> = {
  schools: "/admin/schools",
  grades: "/admin/grades",
  customers: "/admin/customers",
  students: "/admin/students",
  guardians: "/admin/guardians",
};

type Search = { q?: string; sort?: string; dir?: string; page?: string; per?: string };

/**
 * Master Data browser — the full record of one master table, read-only.
 * Every column of the entity (minus secrets and raw ERP payloads) with
 * search, sort and paging. Nothing here writes; editing is in the CRM
 * section, whose pages this browser links to.
 */
export default async function MasterDataPage({
  params,
  searchParams,
}: {
  params: Promise<{ entity: string }>;
  searchParams: Promise<Search>;
}) {
  const { entity: key } = await params;
  const found = masterEntity(key);
  if (!found) notFound();
  const entity = found;

  const guard = await requireAnyPermission(`${entity.slug}.read`, `${entity.slug}.write`);
  if (isResponse(guard)) redirect("/admin/dashboard");

  const sp = await searchParams;
  const q = sp.q?.trim() || undefined;
  const per = PAGE_SIZES.includes(Number(sp.per) as (typeof PAGE_SIZES)[number]) ? Number(sp.per) : 25;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const sortCol = entity.columns.find((c) => c.key === sp.sort) ?? null;
  const dir = sp.dir === "desc" ? "desc" : "asc";
  const shown = entity.columns.slice(0, SCREEN_FIELDS);

  const searchable = entity.columns.filter((c) => c.search);
  const where: SQL | undefined = q
    ? or(...searchable.map((c) => ilike(sql`${c.col}::text`, `%${q}%`)))
    : undefined;

  const orderCol = sortCol?.col ?? entity.orderBy;

  // Plain elements + shared class strings: 1,850 cells as <Td> components
  // serialised to ~5 MB of RSC payload; as bare <td> it is a fraction.
  const TD = "whitespace-nowrap text-ink-700";
  const TD_PIN = "whitespace-nowrap sticky left-0 z-10 bg-white font-medium text-ink-900 group-hover:bg-cream-50";
  const TR = "group";
  const idCol = (entity.table as unknown as { id?: AnyPgColumn }).id;
  const selection = { ...Object.fromEntries(entity.columns.map((c) => [c.key, c.col])), ...(idCol ? { __id: idCol } : {}) };

  const [rows, total] = await Promise.all([
    db
      .select(selection)
      .from(entity.table)
      .where(where)
      .orderBy(dir === "desc" ? desc(orderCol) : asc(orderCol))
      .limit(per)
      .offset((page - 1) * per),
    db.$count(entity.table, where),
  ]);
  const recordBase = RECORD_HREF[entity.key];

  const pages = Math.max(1, Math.ceil(total / per));
  const from = total === 0 ? 0 : (page - 1) * per + 1;
  const to = Math.min(total, page * per);

  function href(over: Partial<Search>) {
    const u = new URLSearchParams();
    const m = { q, sort: sp.sort, dir: sp.dir, per: per === 25 ? undefined : String(per), page: undefined as string | undefined, ...over };
    for (const [k, v] of Object.entries(m)) if (v) u.set(k, v);
    const s = u.toString();
    return `/admin/master-data/${entity.key}${s ? `?${s}` : ""}`;
  }

  return (
    <div>
      <PageHeader
        eyebrow="Master Data"
        breadcrumb={[{ label: entity.label }]}
        title={entity.label}
        description={`${total.toLocaleString("en-IN")} record${total === 1 ? "" : "s"}${q ? " matching your search" : ""} · read-only. Open a record to edit it in CRM; the Excel export carries all ${entity.columns.length} fields.`}
        actions={
          <a href={`/api/admin/master-data/${entity.key}/export${href({}).includes("?") ? href({}).slice(href({}).indexOf("?")) : ""}`} download>
            <Button variant="primary" icon={<Download className="h-3.5 w-3.5" />}>Export Excel</Button>
          </a>
        }
      />

      <AutoSubmitForm action={`/admin/master-data/${entity.key}`} debounceMs={400}>
        <Toolbar>
          <SearchInput
            defaultValue={q}
            placeholder={`Search ${searchable.map((c) => c.label.toLowerCase()).slice(0, 4).join(", ")}…`}
          />
          <FilterSelect label="Sort by" allLabel="Default" name="sort" defaultValue={sp.sort ?? ""}>
            {shown.map((c) => (
              <option key={c.key} value={c.key}>{c.label}</option>
            ))}
          </FilterSelect>
          <FilterSelect label="Order" noAll name="dir" defaultValue={dir}>
            <option value="asc">A → Z</option>
            <option value="desc">Z → A</option>
          </FilterSelect>
          <FilterSelect label="Rows" noAll name="per" defaultValue={String(per)}>
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </FilterSelect>
          {q || sp.sort ? (
            <Link href={`/admin/master-data/${entity.key}`} className="text-[12.5px] text-ink-500 hover:text-ink-900">
              Clear
            </Link>
          ) : null}
        </Toolbar>
      </AutoSubmitForm>

      <div className="overflow-hidden rounded-2xl border border-ink-100/70 bg-white shadow-[0_1px_2px_rgba(10,10,10,0.04)]">
        {rows.length === 0 ? (
          <EmptyState
            icon={Database}
            title={q ? `No ${entity.label.toLowerCase()} match “${q}”` : `No ${entity.label.toLowerCase()} yet`}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-0">
              <thead>
                <tr>
                  {shown.map((c) => {
                    const on = sp.sort === c.key;
                    return (
                      <Th
                        key={c.key}
                        className={"whitespace-nowrap " + (c.pin ? "sticky left-0 z-10" : "")}
                      >
                        <a
                          href={href({ sort: c.key, dir: on && dir === "asc" ? "desc" : "asc", page: undefined })}
                          className={"inline-flex items-center gap-1 hover:text-ink-900 " + (on ? "text-ink-900" : "")}
                          title={`Sort by ${c.label}`}
                        >
                          {c.label}
                          {on ? <span className="text-brand-600">{dir === "asc" ? "↑" : "↓"}</span> : null}
                        </a>
                      </Th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const rec = r as Record<string, unknown>;
                  const id = typeof rec.__id === "string" ? rec.__id : null;
                  return (
                    <tr key={id ?? i} className={TR}>
                      {shown.map((c) => (
                        <td key={c.key} className={c.pin ? TD_PIN : TD}>
                          {c.pin && id && recordBase ? (
                            <Link href={`${recordBase}/${id}`} className="text-ink-900 hover:text-brand-700">
                              <Cell col={c} value={rec[c.key]} />
                            </Link>
                          ) : (
                            <Cell col={c} value={rec[c.key]} />
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {total > 0 ? (
          <Pagination
            page={page}
            pages={pages}
            from={from}
            to={to}
            total={total}
            hrefFor={(p) => href({ page: p > 1 ? String(p) : undefined })}
            noun="record"
          />
        ) : null}
      </div>
    </div>
  );
}

function Cell({ col, value }: { col: MasterColumn; value: unknown }) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-ink-300">—</span>;
  }
  switch (col.kind) {
    case "bool":
      return value ? <span className="text-emerald-700">Yes</span> : <span className="text-ink-400">No</span>;
    case "date": {
      const d = new Date(value as string);
      return (
        <span className="tabular-nums text-ink-600">
          {d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
        </span>
      );
    }
    case "number":
      return <span className="tabular-nums">{Number(value).toLocaleString("en-IN")}</span>;
    case "list": {
      const arr = Array.isArray(value) ? (value as unknown[]) : [value];
      return <span className="text-ink-700">{arr.map(String).join(", ")}</span>;
    }
    case "json": {
      const s = JSON.stringify(value);
      return (
        <span className="font-mono text-[11px] text-ink-500" title={s}>
          {s.length > 48 ? `${s.slice(0, 45)}…` : s}
        </span>
      );
    }
    case "id":
      return (
        <span className="font-mono text-[11px] text-ink-400" title={String(value)}>
          {String(value).slice(0, 8)}…
        </span>
      );
    default: {
      if (col.key === "status") {
        return (
          <Badge tone={statusTone(String(value))} size="sm" dot>
            {String(value)}
          </Badge>
        );
      }
      const s = String(value);
      return s.length > 60 ? <span title={s}>{s.slice(0, 57)}…</span> : <>{s}</>;
    }
  }
}
