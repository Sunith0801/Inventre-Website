import Link from "next/link";
import { redirect } from "next/navigation";
import { Library, Plus } from "lucide-react";
import { db } from "@/db/client";
import { sql } from "drizzle-orm";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";
import {
  PageHeader,
  Card,
  Toolbar,
  SearchInput,
  Button,
  EmptyState,
  Th,
  Td,
  Tr,
} from "@/components/admin/ui/primitives";

export const dynamic = "force-dynamic";

const PAGE = 50;

type Row = {
  bundle_id: string;
  product_id: string;
  name: string;
  item_code: string | null;
  kind: string | null;
  comps: number;
  schools: string | null;
  grades: string | null;
};

function rowsOf<T>(res: unknown): T[] {
  return (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as T[];
}

export default async function BomMasterPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; schoolId?: string; page?: string }>;
}) {
  const guard = await requireAnyPermission("catalog.read", "catalog.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const { q, schoolId, page: pageStr } = await searchParams;
  const page = Math.max(1, parseInt(pageStr ?? "1") || 1);
  const term = (q ?? "").trim();
  const like = `%${term}%`;

  const conds = [sql`TRUE`];
  if (term) conds.push(sql`(p.name ILIKE ${like} OR p.item_code ILIKE ${like})`);
  if (schoolId)
    conds.push(
      sql`EXISTS (SELECT 1 FROM product_school ps WHERE ps.product_id = p.id AND ps.school_id = ${schoolId})`
    );
  const where = conds.reduce((a, b) => sql`${a} AND ${b}`);

  const allSchools = rowsOf<{ id: string; name: string }>(
    await db.execute(sql`SELECT id, name FROM schools ORDER BY name`)
  );

  const total = Number(
    rowsOf<{ n: number }>(
      await db.execute(
        sql`SELECT count(*)::int AS n
            FROM product_bundles pb JOIN products p ON p.id = pb.product_id
            WHERE ${where}`
      )
    )[0]?.n ?? 0
  );
  const pages = Math.ceil(total / PAGE);

  const rows = rowsOf<Row>(
    await db.execute(
      sql`SELECT pb.id AS bundle_id, p.id AS product_id, p.name, p.item_code,
                 p.kind,
                 (SELECT count(*)::int FROM bundle_components bc WHERE bc.bundle_id = pb.id) AS comps,
                 (SELECT string_agg(DISTINCT s.name, ', ') FROM product_school ps
                    JOIN schools s ON s.id = ps.school_id WHERE ps.product_id = p.id) AS schools,
                 (SELECT string_agg(DISTINCT pg.grade, ', ') FROM product_grades pg
                    WHERE pg.product_id = p.id) AS grades
          FROM product_bundles pb JOIN products p ON p.id = pb.product_id
          WHERE ${where}
          ORDER BY p.name
          LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`
    )
  );

  const qp = (p: number) =>
    `/admin/boms?q=${encodeURIComponent(term)}&schoolId=${encodeURIComponent(
      schoolId ?? ""
    )}&page=${p}`;

  return (
    <div>
      <PageHeader
        eyebrow="Catalog"
        title="BOM Master"
        description={`${total.toLocaleString("en-IN")} BOMs — what each Bookkit / Magic Box bundles.`}
        actions={
          <Link href="/admin/boms/new">
            <Button icon={<Plus className="h-3.5 w-3.5" />} variant="primary">
              New BOM
            </Button>
          </Link>
        }
      />

      <form method="GET">
        <Toolbar>
          <SearchInput defaultValue={term} placeholder="Search BOM item / code…" />
          <select
            name="schoolId"
            defaultValue={schoolId ?? ""}
            className="h-9 px-2.5 rounded-lg border border-ink-200 text-[13px] bg-white"
          >
            <option value="">All schools</option>
            {allSchools.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <Button type="submit" variant="secondary">
            Filter
          </Button>
        </Toolbar>
      </form>

      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState
            icon={Library}
            title={term ? `No BOMs match “${term}”` : "No BOMs"}
            description="Create one with “New BOM”, scoped to a school and grade."
          />
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th>BOM item</Th>
                <Th>Type</Th>
                <Th>School(s)</Th>
                <Th>Grade(s)</Th>
                <Th right>Components</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.bundle_id}>
                  <Td>
                    <Link
                      href={`/admin/products/${r.product_id}`}
                      className="font-semibold text-ink-900 hover:text-brand-700"
                    >
                      {r.name}
                    </Link>
                    <div className="text-[11px] font-mono text-ink-500">
                      {r.item_code ?? "—"}
                    </div>
                    <Link
                      href={`/admin/catalog/bundles/${r.bundle_id}`}
                      className="mt-1 inline-flex items-center gap-1 text-[11px] text-brand-600 hover:underline"
                    >
                      Edit visibility ↗
                    </Link>
                  </Td>
                  <Td muted>{r.kind ?? "—"}</Td>
                  <Td muted>{r.schools ?? "—"}</Td>
                  <Td muted>{r.grades ?? "—"}</Td>
                  <Td right>{r.comps}</Td>
                </Tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {pages > 1 ? (
        <div className="flex items-center gap-2 mt-4 text-[13px]">
          {page > 1 ? (
            <Link
              href={qp(page - 1)}
              className="px-3 py-1.5 rounded-lg border border-ink-200 bg-white"
            >
              ‹ Prev
            </Link>
          ) : null}
          <span className="text-ink-500">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link
              href={qp(page + 1)}
              className="px-3 py-1.5 rounded-lg border border-ink-200 bg-white"
            >
              Next ›
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
