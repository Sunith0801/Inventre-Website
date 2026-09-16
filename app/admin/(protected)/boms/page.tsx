import Link from "next/link";
import { redirect } from "next/navigation";
import { Library, Plus } from "lucide-react";
import { db } from "@/db/client";
import { sql } from "drizzle-orm";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";
import { AutoSubmitForm } from "@/components/admin/AutoSubmitForm";
import { Pagination } from "@/components/admin/ui/pagination";
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
  FilterSelect,
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
        eyebrow="Bundles"
        title="Bills of Materials"
        description={`${total.toLocaleString("en-IN")} bill${total === 1 ? "" : "s"} of materials — bookkits, sub-bundles and Magic Boxes with their components.`}
        actions={
          <Link href="/admin/boms/new">
            <Button icon={<Plus className="h-3.5 w-3.5" />} variant="primary">
              New BOM
            </Button>
          </Link>
        }
      />

      <AutoSubmitForm action="/admin/boms">
        <Toolbar>
          <SearchInput defaultValue={term} placeholder="Search by item name or code…" />
          <FilterSelect label="School" name="schoolId" defaultValue={schoolId ?? ""}>
            {allSchools.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </FilterSelect>
          {term || schoolId ? <Link href="/admin/boms" className="text-[12.5px] text-ink-500 hover:text-ink-900">Clear</Link> : null}
        </Toolbar>
      </AutoSubmitForm>

      <Card padded={false} className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon={Library}
            title={term ? `No BOMs match “${term}”` : "No BOMs"}
            description="Create one with “New BOM”, scoped to a school and grade."
          />
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <Th>Item</Th>
                <Th>Type</Th>
                <Th>Schools</Th>
                <Th>Grades</Th>
                <Th right>Components</Th>
                <Th right><span className="sr-only">Visibility</span></Th>
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
                    <span className="block font-mono text-[11.5px] font-normal text-ink-500">{r.item_code ?? "—"}</span>
                  </Td>
                  <Td muted>{r.kind ? r.kind.replace(/_/g, " ") : "—"}</Td>
                  <Td muted>{r.schools ?? <span className="text-ink-300">—</span>}</Td>
                  <Td muted>{r.grades ?? <span className="text-ink-300">—</span>}</Td>
                  <Td right>{r.comps || <span className="text-ink-300">0</span>}</Td>
                  <Td right>
                    <Link href={`/admin/catalog/bundles/${r.bundle_id}`} className="whitespace-nowrap text-[12.5px] font-semibold text-brand-700 hover:text-brand-900">
                      Visibility
                    </Link>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
        {total > 0 ? (
          <Pagination
            page={page}
            pages={Math.max(1, pages)}
            from={(page - 1) * PAGE + 1}
            to={Math.min(page * PAGE, total)}
            total={total}
            noun="BOM"
            hrefFor={qp}
          />
        ) : null}
      </Card>

    </div>
  );
}
