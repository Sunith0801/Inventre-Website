import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  PageHeader,
  Card,
  CardHeader,
  Stat,
  Th,
  Td,
  Tr,
  Badge,
  EmptyState,
} from "@/components/admin/ui/primitives";
import { Boxes } from "lucide-react";
import { GroundStockSyncCard } from "@/components/admin/GroundStockSyncCard";

export const dynamic = "force-dynamic";

const PAGE = 150;
/** The audit's label on its merged General Merchandise line. */
const ALL_SCHOOLS = "All schools";

type Row = {
  keeperSku: string;
  description: string | null;
  category: string | null;
  group: string | null;
  shelf: string;
  available: number;
  linked: number;
  skus: string[];
  products: string[];
  snapshotAt: string | null;
};

/**
 * Ground Stock — the audit's "Ground Stock (New)" shelf, by STANDARD SKU.
 *
 * One row per (keeper SKU, shelf), exactly as the audit consolidates it:
 * Black 10S Shoes is one pile on one shelf however many schools sell it, so
 * it is one row here with the eleven school SKUs it feeds folded beneath.
 * School stock (uniforms) is counted per school, so the same keeper SKU can
 * appear once per school with that school's own figure. Books are one
 * shared shelf. The storefront sells against the figure on each row.
 */
export default async function GroundStockPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; show?: string; page?: string; school?: string; stock?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const show = sp.show === "out" ? "out" : sp.show === "in" ? "in" : "all";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const stock =
    sp.stock === "books" ? "books" : sp.stock === "merch" ? "merch" : sp.stock === "school" ? "school" : "all";
  // Shoes, bags and bottles are one shelf for every school (the bridge folds
  // the audit's per-school bag/bottle rows), and the books shelf has no
  // school either — the dropdown applies to school stock only.
  const school = stock === "books" || stock === "merch" ? "" : (sp.school ?? "").trim();

  // Shelf per size: the audit's school for school stock, "All schools" for
  // the merged General Merchandise line, "Books shelf" for the books sheet.
  const shelfExpr = sql<string>`case
      when g.keeper_group = 'Books' or p.kind = 'book' then 'Books shelf · all schools'
      when g.school_name = ${ALL_SCHOOLS} or g.keeper_group = 'General Merchandise' then 'Shared · all schools'
      else coalesce(g.school_name, '—') end`;
  const groupCase = sql`case
      when g.keeper_group = 'Books' or p.kind = 'book' then 'books'
      when g.keeper_group = 'General Merchandise' then 'merch'
      else 'school' end`;

  const conds: ReturnType<typeof sql>[] = [];
  if (stock !== "all") conds.push(sql`${groupCase} = ${stock}`);
  if (school) conds.push(sql`g.school_name = ${school}`);
  if (q) {
    const like = `%${q}%`;
    conds.push(
      sql`(g.keeper_sku ilike ${like} or g.keeper_description ilike ${like} or g.keeper_category ilike ${like} or v.sku ilike ${like} or p.name ilike ${like})`
    );
  }
  const where = conds.length ? sql`where ${sql.join(conds, sql` and `)}` : sql``;
  const having =
    show === "out" ? sql`having max(g.available) <= 0` : show === "in" ? sql`having max(g.available) > 0` : sql``;

  const grouped = sql`
    select coalesce(g.keeper_sku, g.item_code) as keeper_sku,
           max(g.keeper_description) as description,
           max(g.keeper_category) as category,
           max(g.keeper_group) as "group",
           ${shelfExpr} as shelf,
           max(g.available)::int as available,
           count(*)::int as linked,
           array_agg(v.sku order by v.sku) as skus,
           array_agg(distinct p.name) as products,
           max(g.snapshot_at)::text as snapshot_at
      from ground_stock_sync g
      join product_variants v on v.id = g.variant_id
      join products p on p.id = v.product_id
      ${where}
     group by 1, 5
     ${having}`;

  const [rowsRaw, countRaw, totalsRaw, schoolsRaw] = await Promise.all([
    db.execute(sql`${grouped} order by 5, 3, 1 limit ${PAGE} offset ${(page - 1) * PAGE}`),
    db.execute(sql`select count(*)::int as n from (${grouped}) t`),
    db.execute(sql`
      select count(*)::int as tracked,
             count(*) filter (where available > 0)::int as in_stock,
             count(*) filter (where available <= 0)::int as sold_out,
             coalesce(sum(available), 0)::bigint as units
        from (select coalesce(g.keeper_sku, g.item_code) k, ${shelfExpr} s, max(g.available) available
                from ground_stock_sync g
                join product_variants v on v.id = g.variant_id
                join products p on p.id = v.product_id
               group by 1, 2) t`),
    db.execute(sql`
      select distinct g.school_name as name
        from ground_stock_sync g
        join product_variants v on v.id = g.variant_id
        join products p on p.id = v.product_id
       where g.school_name is not null and g.school_name <> ${ALL_SCHOOLS}
         and not (g.keeper_group = 'Books' or p.kind = 'book')
         and coalesce(g.keeper_group, '') <> 'General Merchandise'
       order by 1`),
  ]);
  const rows = (rowsRaw as unknown as Array<Record<string, unknown>>).map<Row>((r) => ({
    keeperSku: String(r.keeper_sku),
    description: (r.description as string | null) ?? null,
    category: (r.category as string | null) ?? null,
    group: (r.group as string | null) ?? null,
    shelf: String(r.shelf),
    available: Number(r.available),
    linked: Number(r.linked),
    skus: (r.skus as string[]) ?? [],
    products: (r.products as string[]) ?? [],
    snapshotAt: (r.snapshot_at as string | null) ?? null,
  }));
  const count = Number((countRaw as unknown as { n: number }[])[0]?.n ?? 0);
  const totals = (totalsRaw as unknown as { tracked: number; in_stock: number; sold_out: number; units: number }[])[0];
  const schoolOptions = (schoolsRaw as unknown as { name: string }[]).map((s) => s.name);

  const pages = Math.max(1, Math.ceil(count / PAGE));
  const link = (patch: Record<string, string | number | undefined>) => {
    const u = new URLSearchParams();
    const merged = { q, show, school, stock, page, ...patch };
    for (const [k, v] of Object.entries(merged)) {
      if (v === undefined || v === "" || (k === "show" && v === "all") || (k === "stock" && v === "all") || (k === "page" && v === 1)) continue;
      u.set(k, String(v));
    }
    const s = u.toString();
    return `/admin/ground-stock${s ? `?${s}` : ""}`;
  };
  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";

  return (
    <div>
      <PageHeader
        breadcrumb={[{ label: "Catalog", href: "/admin/catalog" }, { label: "Ground Stock" }]}
        title="Ground Stock"
        description="The audit's Ground Stock (New) shelf by standard SKU, one row per pile, copied into the Stock module every 5 minutes. The storefront reads the Stock module; adjust a bin there and it holds until the audit counts again."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat label="Standard SKUs on the shelf" value={Number(totals?.tracked ?? 0).toLocaleString("en-IN")} iconTone="default" />
        <Stat label="In stock" value={Number(totals?.in_stock ?? 0).toLocaleString("en-IN")} iconTone="success" />
        <Stat label="Sold out" value={Number(totals?.sold_out ?? 0).toLocaleString("en-IN")} iconTone="warning" />
        <Stat label="Units on the shelf" value={Number(totals?.units ?? 0).toLocaleString("en-IN")} iconTone="info" />
      </div>

      <div className="mb-6">
        <GroundStockSyncCard />
      </div>

      <Card padded={false}>
        <div className="px-5 lg:px-6 pt-5 lg:pt-6 pb-3 flex flex-wrap items-end justify-between gap-3">
          <CardHeader
            title="By standard SKU"
            description={`${count.toLocaleString("en-IN")} row${count === 1 ? "" : "s"}${school ? ` · ${school}` : ""}${q ? ` matching “${q}”` : ""}`}
          />
          <form method="get" action="/admin/ground-stock" className="flex flex-wrap items-center gap-2 text-[13px]">
            <input type="hidden" name="show" value={show} />
            <input type="hidden" name="stock" value={stock} />
            <div className="inline-flex rounded-md border border-ink-200 overflow-hidden">
              {(
                [
                  ["all", "All stock"],
                  ["school", "School stock"],
                  ["books", "Books shelf"],
                  ["merch", "Shoes · bags · bottles"],
                ] as const
              ).map(([k, label]) => (
                <a
                  key={k}
                  href={link({ stock: k, page: 1, school: k === "books" || k === "merch" ? "" : school })}
                  className={
                    "px-3 h-9 inline-flex items-center " +
                    (stock === k ? "bg-ink-900 text-white" : "text-ink-700 hover:bg-ink-50")
                  }
                >
                  {label}
                </a>
              ))}
            </div>
            <select
              id="ground-stock-school"
              name="school"
              defaultValue={school}
              disabled={stock === "books" || stock === "merch"}
              title={stock === "books" || stock === "merch" ? "Shared shelf — not held per school" : undefined}
              className="h-9 rounded-md border border-ink-200 px-2 text-[13px] bg-white disabled:opacity-40"
            >
              <option value="">All schools</option>
              {schoolOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <input
              id="ground-stock-q"
              name="q"
              defaultValue={q}
              placeholder="Search standard SKU, description, school SKU"
              className="h-9 w-64 rounded-md border border-ink-200 px-3 text-[13px]"
            />
            <button type="submit" className="h-9 px-3 rounded-md bg-ink-900 text-white">
              Apply
            </button>
            <div className="inline-flex rounded-md border border-ink-200 overflow-hidden">
              {(["all", "in", "out"] as const).map((k) => (
                <a
                  key={k}
                  href={link({ show: k, page: 1 })}
                  className={
                    "px-3 h-9 inline-flex items-center " +
                    (show === k ? "bg-ink-900 text-white" : "text-ink-700 hover:bg-ink-50")
                  }
                >
                  {k === "all" ? "All" : k === "in" ? "In stock" : "Sold out"}
                </a>
              ))}
            </div>
          </form>
        </div>
        {rows.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title="Nothing here yet"
            description="Run a sync from the card above, or widen the search."
          />
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th>Standard SKU</Th>
                <Th>Description</Th>
                <Th>Category</Th>
                <Th>Shelf</Th>
                <Th right>On shelf</Th>
                <Th>Sold as</Th>
                <Th>Counted</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const out = r.available <= 0;
                return (
                  <Tr key={`${r.keeperSku}|${r.shelf}`} className={out ? "bg-amber-50/30" : undefined}>
                    <Td>
                      <span className="font-mono text-[12px]">{r.keeperSku}</span>
                    </Td>
                    <Td>{r.description ?? "—"}</Td>
                    <Td muted>{r.category ?? "—"}</Td>
                    <Td muted>{r.shelf}</Td>
                    <Td right>
                      <Badge tone={out ? "warning" : "success"} dot size="sm">
                        {r.available}
                      </Badge>
                    </Td>
                    <Td>
                      <details>
                        <summary className="cursor-pointer text-[12px] text-ink-500">
                          {r.linked} storefront SKU{r.linked === 1 ? "" : "s"}
                        </summary>
                        <div className="mt-1 font-mono text-[11px] text-ink-600 flex flex-col gap-0.5">
                          {r.skus.map((s) => (
                            <span key={s}>{s}</span>
                          ))}
                        </div>
                      </details>
                    </Td>
                    <Td muted>{fmt(r.snapshotAt)}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </table>
        )}
        {pages > 1 && (
          <div className="px-5 lg:px-6 py-3 flex items-center justify-between text-[13px] text-ink-500">
            <span>
              Page {page} of {pages}
            </span>
            <span className="inline-flex gap-3">
              {page > 1 && <a href={link({ page: page - 1 })} className="underline">Previous</a>}
              {page < pages && <a href={link({ page: page + 1 })} className="underline">Next</a>}
            </span>
          </div>
        )}
      </Card>
    </div>
  );
}
