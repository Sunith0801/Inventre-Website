import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { productBundles, products } from "@/db/schema";
import { and, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import { Library, Plus, Layers } from "lucide-react";
import {
  PageHeader,
  Card,
  Th,
  Td,
  Tr,
  Badge,
  Money,
  EmptyState,
  Button,
  Toolbar,
  SearchInput,
  type Tone,
} from "@/components/admin/ui/primitives";
import { Pagination, PerPagePicker } from "@/components/admin/ui/pagination";
import { AutoSubmitForm } from "@/components/admin/AutoSubmitForm";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";
import { canWritePage } from "@/lib/admin-permissions";
import { PER_PAGE_OPTIONS, pageMeta, readPaging, withPaging } from "@/lib/admin-paging";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

const BASE = "/admin/catalog/bundles";

/** The kinds a bundle's own product can carry, in the order the hierarchy nests. */
const KINDS = [
  { key: "magic_box", label: "Magic Box", tone: "brand" as Tone },
  { key: "kit", label: "Kits", tone: "info" as Tone },
  { key: "sub_bundle", label: "Sub-bundles", tone: "violet" as Tone },
  { key: "book", label: "Books", tone: "subtle" as Tone },
] as const;
type KindKey = (typeof KINDS)[number]["key"];
const kindMeta = (k: string) => KINDS.find((x) => x.key === k) ?? { key: k, label: k.replace("_", " "), tone: "default" as Tone };

type Preview = { name: string; qty: number };

export default async function BundlesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; perPage?: string; q?: string; kind?: string }>;
}) {
  const guard = await requireAnyPermission("catalog-bundles.read", "catalog-bundles.write", "catalog.read", "catalog.write");
  if (isResponse(guard)) redirect("/admin/dashboard");
  const canWrite = canWritePage(guard.permissions, "catalog-bundles") || canWritePage(guard.permissions, "catalog");

  const sp = await searchParams;
  const paging = readPaging(sp);
  const q = sp.q?.trim() ?? "";
  const kind = KINDS.some((k) => k.key === sp.kind) ? (sp.kind as KindKey) : null;

  const conds = [];
  if (q) conds.push(or(ilike(products.name, `%${q}%`), ilike(sql`COALESCE(${products.itemCode}, '')`, `%${q}%`)));
  if (kind) conds.push(eq(products.kind, kind));
  const where = conds.length ? and(...conds) : undefined;

  const hrefFor = (p: number, pp = paging.perPage, k: KindKey | null = kind) => {
    const u = new URL(withPaging(BASE, p, pp), "http://x");
    if (q) u.searchParams.set("q", q);
    if (k) u.searchParams.set("kind", k);
    return u.pathname + u.search;
  };

  // One page plus the total. The three subqueries are what make the row
  // self-describing: what's inside, what it adds up to, and what contains it.
  const [rows, totalRows, kindCounts] = await Promise.all([
    db
      .select({
        bundle: productBundles,
        product: { id: products.id, name: products.name, itemCode: products.itemCode, kind: products.kind, bundleLevel: products.bundleLevel, basePrice: products.basePrice },
        componentCount: sql<number>`(SELECT COUNT(*) FROM bundle_components WHERE bundle_id = ${productBundles.id})::int`,
        componentSum: sql<number>`(
          SELECT COALESCE(SUM(bc.qty * COALESCE(pp.base_price, 0)), 0)
            FROM bundle_components bc
            LEFT JOIN product_variants pv ON pv.id = bc.variant_id
            LEFT JOIN products pp ON pp.id = COALESCE(bc.product_id, pv.product_id)
           WHERE bc.bundle_id = ${productBundles.id})::int`,
        parentCount: sql<number>`(
          SELECT COUNT(DISTINCT bc.bundle_id)
            FROM bundle_components bc
            LEFT JOIN product_variants pv ON pv.id = bc.variant_id
           WHERE COALESCE(bc.product_id, pv.product_id) = ${products.id})::int`,
        preview: sql<Preview[]>`(
          SELECT COALESCE(json_agg(json_build_object('name', x.name, 'qty', x.qty)), '[]'::json)
            FROM (SELECT pp.name, bc.qty
                    FROM bundle_components bc
                    LEFT JOIN product_variants pv ON pv.id = bc.variant_id
                    LEFT JOIN products pp ON pp.id = COALESCE(bc.product_id, pv.product_id)
                   WHERE bc.bundle_id = ${productBundles.id} AND pp.name IS NOT NULL
                   ORDER BY pp.name LIMIT 3) x)`,
      })
      .from(productBundles)
      .innerJoin(products, eq(products.id, productBundles.productId))
      .where(where)
      .orderBy(desc(productBundles.createdAt), desc(productBundles.id))
      .limit(paging.perPage)
      .offset(paging.offset),
    db.select({ total: count() }).from(productBundles).innerJoin(products, eq(products.id, productBundles.productId)).where(where),
    db
      .select({ kind: products.kind, n: sql<number>`count(*)::int` })
      .from(productBundles)
      .innerJoin(products, eq(products.id, productBundles.productId))
      .groupBy(products.kind),
  ]);
  const total = totalRows[0]?.total ?? 0;
  const all = kindCounts.reduce((a, r) => a + r.n, 0);
  const { pages, from, to } = pageMeta(total, paging);
  if (paging.page > pages) redirect(hrefFor(pages));
  const filtered = Boolean(q || kind);

  const newButton = canWrite ? (
    <Link href="/admin/boms/new">
      <Button icon={<Plus className="h-3.5 w-3.5" />} variant="primary">New bundle</Button>
    </Link>
  ) : null;

  return (
    <div>
      <PageHeader
        eyebrow="Bundles"
        title="Bundles"
        description={
          <>
            Products that are boxes of other products — Magic Boxes hold kits, kits hold sub-bundles, sub-bundles hold items.{" "}
            <Link href="/admin/boms" className="font-medium text-brand-700 hover:text-brand-800">School-wise BOMs</Link> is the same data grouped by school and grade.
          </>
        }
        actions={newButton}
      />

      <AutoSubmitForm action={BASE}>
        <Toolbar>
          <SearchInput defaultValue={q} placeholder="Search by product name or item code…" />
          {kind ? <input type="hidden" name="kind" value={kind} /> : null}
          {filtered ? <Link href={BASE} className="text-[12.5px] text-ink-500 hover:text-ink-900">Clear</Link> : null}
        </Toolbar>
      </AutoSubmitForm>

      <div className="mb-4 -mt-1 flex flex-wrap items-center gap-1 text-[12px]">
        {[null, ...KINDS.map((k) => k.key)].map((k) => {
          const active = kind === k;
          const n = k ? (kindCounts.find((r) => r.kind === k)?.n ?? 0) : all;
          return (
            <Link
              key={k ?? "all"}
              href={hrefFor(1, paging.perPage, k as KindKey | null)}
              className={cn("inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium transition-colors", active ? "bg-ink-900 text-white" : "text-ink-600 hover:bg-cream-100 hover:text-ink-900")}
            >
              {k ? kindMeta(k).label : "All"}
              <span className={cn("tabular-nums", active ? "text-white/70" : "text-ink-400")}>{n.toLocaleString("en-IN")}</span>
            </Link>
          );
        })}
      </div>

      <Card padded={false}>
        {total === 0 ? (
          <EmptyState
            icon={Library}
            title={filtered ? "No bundles match" : "No bundles yet"}
            description={filtered ? "Try another search or clear the kind filter." : "Build the first one in the BOM builder, scoped to a school and grade."}
            action={newButton}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <Th>Bundle</Th>
                  <Th>Contains</Th>
                  <Th right>Price</Th>
                  <Th right>Inside</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const km = kindMeta(r.product.kind);
                  const fixed = r.bundle.pricingMode === "fixed" && r.bundle.fixedPrice != null;
                  const more = r.componentCount - r.preview.length;
                  return (
                    <Tr key={r.bundle.id}>
                      <Td>
                        <Link href={`${BASE}/${r.bundle.id}`} className="group/name block min-w-[220px]">
                          <span className="flex items-center gap-2">
                            <span className="truncate font-semibold text-ink-900 group-hover/name:text-brand-700">{r.product.name}</span>
                            <Badge tone={km.tone} size="sm" className="shrink-0">{km.label.replace(/s$/, "")}</Badge>
                            {r.bundle.bundleType === "configurable" ? <Badge tone="warning" size="sm" className="shrink-0">Configurable</Badge> : null}
                          </span>
                          {r.product.itemCode ? <span className="block font-mono text-[11px] font-normal text-ink-500">{r.product.itemCode}</span> : null}
                        </Link>
                      </Td>
                      <Td>
                        {r.componentCount === 0 ? (
                          <span className="text-[12px] italic text-ink-400">Empty</span>
                        ) : (
                          <span className="block max-w-[420px] text-[12.5px] text-ink-700">
                            <span className="font-semibold tabular-nums text-ink-900">{r.componentCount}</span>
                            <span className="text-ink-400"> · </span>
                            {r.preview.map((p, i) => (
                              <span key={i}>
                                {i > 0 ? <span className="text-ink-400">, </span> : null}
                                {p.qty > 1 ? <span className="tabular-nums text-ink-500">{p.qty}× </span> : null}
                                {p.name}
                              </span>
                            ))}
                            {more > 0 ? <span className="text-ink-400"> +{more} more</span> : null}
                          </span>
                        )}
                      </Td>
                      <Td right>
                        {fixed ? (
                          <span className="block">
                            <Money paise={r.bundle.fixedPrice!} className="font-semibold" />
                            <span className="block text-[11px] font-normal text-ink-400">fixed · parts <Money paise={r.componentSum} /></span>
                          </span>
                        ) : (
                          <span className="block">
                            <Money paise={r.componentSum} className="font-semibold" />
                            <span className="block text-[11px] font-normal text-ink-400">sum of parts</span>
                          </span>
                        )}
                      </Td>
                      <Td right>
                        {r.parentCount ? (
                          <span className="inline-flex items-center gap-1 tabular-nums text-ink-700" title="Parent bundles that include this one">
                            <Layers className="h-3.5 w-3.5 text-ink-400" />
                            {r.parentCount}
                          </span>
                        ) : (
                          <span className="text-[12px] text-ink-400">top level</span>
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {total > 0 ? (
          <Pagination page={paging.page} pages={pages} from={from} to={to} total={total} noun="bundle" hrefFor={(p) => hrefFor(p)}>
            <PerPagePicker value={paging.perPage} options={PER_PAGE_OPTIONS} hrefFor={(pp) => hrefFor(1, pp)} />
          </Pagination>
        ) : null}
      </Card>
    </div>
  );
}
