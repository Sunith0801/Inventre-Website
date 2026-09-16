import { and, eq, exists, ilike, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { groundStockSync, productVariants, products, productSchool, schools } from "@/db/schema";
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

const PAGE = 200;
/** The audit's label on its merged General Merchandise line. */
const ALL_SCHOOLS = "All schools";

/**
 * Ground Stock — what the audit's "Ground Stock (New)" page says is on the
 * shelf, per storefront size, as the bridge last copied it into the bins.
 * This is the figure the storefront sells against.
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
  // Three kinds of shelf on the audit, and they must not be read alike:
  //   school  uniforms and accessories counted per school (one row per
  //           school, its own legacy code, its own figure);
  //   books   ONE shared books shelf — a title sold to five schools is one
  //           pile, and the audit's book rows carry no school;
  //   merch   shoes, bags and bottles: one shelf for every school, which
  //           the audit reports as a single "All schools" line.
  // The school dropdown therefore applies to school stock only.
  const stock = sp.stock === "books" ? "books" : sp.stock === "merch" ? "merch" : sp.stock === "school" ? "school" : "all";
  const school = stock === "books" || stock === "merch" ? "" : (sp.school ?? "").trim();

  // Schools that have at least one tracked size — the dropdown's options.
  // School comes from the storefront's own product ↔ school link, not the
  // audit's label, so a product sold to two schools appears under both.
  const schoolOptions = await db
    .selectDistinct({ id: schools.id, name: schools.name })
    .from(groundStockSync)
    .innerJoin(productVariants, eq(productVariants.id, groundStockSync.variantId))
    .innerJoin(productSchool, eq(productSchool.productId, productVariants.productId))
    .innerJoin(schools, eq(schools.id, productSchool.schoolId))
    .orderBy(schools.name);
  const schoolPicked = schoolOptions.find((s) => s.id === school) ?? null;

  const where = and(
    q
      ? or(
          ilike(productVariants.sku, `%${q}%`),
          ilike(products.name, `%${q}%`),
          ilike(groundStockSync.keeperSku, `%${q}%`),
          ilike(groundStockSync.keeperDescription, `%${q}%`),
          ilike(groundStockSync.itemCode, `%${q}%`)
        )
      : undefined,
    show === "out"
      ? sql`${groundStockSync.available} <= 0`
      : show === "in"
        ? sql`${groundStockSync.available} > 0`
        : undefined,
    stock === "books"
      ? eq(products.kind, "book")
      : stock === "merch"
        ? eq(groundStockSync.schoolName, ALL_SCHOOLS)
        : stock === "school"
          ? and(ne(products.kind, "book"), or(isNull(groundStockSync.schoolName), ne(groundStockSync.schoolName, ALL_SCHOOLS)))
          : undefined,
    schoolPicked
      ? exists(
          db
            .select({ one: sql`1` })
            .from(productSchool)
            .where(
              and(
                eq(productSchool.productId, products.id),
                eq(productSchool.schoolId, schoolPicked.id)
              )
            )
        )
      : undefined
  );

  const [[totals], rows, [{ count }]] = await Promise.all([
    db
      .select({
        tracked: sql<number>`count(*)::int`,
        inStock: sql<number>`count(*) filter (where ${groundStockSync.available} > 0)::int`,
        soldOut: sql<number>`count(*) filter (where ${groundStockSync.available} <= 0)::int`,
        units: sql<number>`coalesce(sum(${groundStockSync.available}), 0)::bigint`,
      })
      .from(groundStockSync),
    db
      .select({
        variantId: groundStockSync.variantId,
        kind: sql<string>`${products.kind}::text`,
        sku: productVariants.sku,
        size: productVariants.size,
        isActive: productVariants.isActive,
        productName: products.name,
        productSlug: products.slug,
        keeperSku: groundStockSync.keeperSku,
        keeperDescription: groundStockSync.keeperDescription,
        itemCode: groundStockSync.itemCode,
        schoolName: groundStockSync.schoolName,
        available: groundStockSync.available,
        snapshotAt: groundStockSync.snapshotAt,
        syncedAt: groundStockSync.syncedAt,
      })
      .from(groundStockSync)
      .innerJoin(productVariants, eq(productVariants.id, groundStockSync.variantId))
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(where)
      .orderBy(products.name, productVariants.size)
      .limit(PAGE)
      .offset((page - 1) * PAGE),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(groundStockSync)
      .innerJoin(productVariants, eq(productVariants.id, groundStockSync.variantId))
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(where),
  ]);

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
  const fmt = (d: Date | null) =>
    d ? d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";

  return (
    <div>
      <PageHeader
        breadcrumb={[{ label: "Catalog", href: "/admin/catalog" }, { label: "Ground Stock" }]}
        title="Ground Stock"
        description="What the audit's Ground Stock (New) page says is on the shelf, per size. The storefront sells against exactly these numbers."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat label="Sizes tracked by the audit" value={Number(totals?.tracked ?? 0).toLocaleString("en-IN")} iconTone="default" />
        <Stat label="In stock" value={Number(totals?.inStock ?? 0).toLocaleString("en-IN")} iconTone="success" />
        <Stat label="Sold out" value={Number(totals?.soldOut ?? 0).toLocaleString("en-IN")} iconTone="warning" />
        <Stat label="Units on the shelf" value={Number(totals?.units ?? 0).toLocaleString("en-IN")} iconTone="info" />
      </div>

      <div className="mb-6">
        <GroundStockSyncCard />
      </div>

      <Card padded={false}>
        <div className="px-5 lg:px-6 pt-5 lg:pt-6 pb-3 flex flex-wrap items-end justify-between gap-3">
          <CardHeader
            title="Per size"
            description={`${count.toLocaleString("en-IN")} row${count === 1 ? "" : "s"}${schoolPicked ? ` · ${schoolPicked.name}` : ""}${q ? ` matching “${q}”` : ""}`}
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
                  title={
                    k === "books"
                      ? "One shared books shelf — the audit counts titles once, not per school"
                      : k === "merch"
                        ? "One shelf for every school — the audit reports these as a single All-schools line"
                        : undefined
                  }
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
              title={stock === "books" || stock === "merch" ? "Shared stock — not held per school" : undefined}
              className="h-9 rounded-md border border-ink-200 px-2 text-[13px] bg-white disabled:opacity-40"
            >
              <option value="">All schools</option>
              {schoolOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <input
              id="ground-stock-q"
              name="q"
              defaultValue={q}
              placeholder="Search product, SKU or keeper SKU"
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
                <Th>Product</Th>
                <Th>Size</Th>
                <Th>Storefront SKU</Th>
                <Th>Audit item</Th>
                <Th>Shelf</Th>
                <Th right>On shelf</Th>
                <Th>Counted</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const out = r.available <= 0;
                return (
                  <Tr key={r.variantId} className={out ? "bg-amber-50/30" : undefined}>
                    <Td>
                      {r.productName}
                      {!r.isActive && (
                        <span className="ml-2 text-[11px] text-ink-400">hidden</span>
                      )}
                    </Td>
                    <Td muted>{r.size}</Td>
                    <Td>
                      <span className="font-mono text-[12px]">{r.sku}</span>
                    </Td>
                    <Td>
                      {/* What the audit calls the pile — for shared merchandise this is
                          the only honest name ("Black 10S Shoes"), the storefront product
                          being one school's copy of it. */}
                      <div>{r.keeperDescription ?? "—"}</div>
                      <span className="font-mono text-[11px] text-ink-400">{r.keeperSku ?? ""}</span>
                    </Td>
                    <Td muted>
                      {r.kind === "book"
                        ? "Books shelf · all schools"
                        : r.schoolName === ALL_SCHOOLS
                          ? "Shared · all schools"
                          : r.schoolName ?? "—"}
                    </Td>
                    <Td right>
                      <Badge tone={out ? "warning" : "success"} dot size="sm">
                        {r.available}
                      </Badge>
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
