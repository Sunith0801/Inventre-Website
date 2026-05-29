import Link from "next/link";
import { redirect } from "next/navigation";
import { Users } from "lucide-react";
import { db } from "@/db/client";
import { sql } from "drizzle-orm";
import { requireAdmin, isResponse } from "@/lib/admin-guard";
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
  erp_name: string | null;
  email: string | null;
  student: string | null;
  erp_customer: string | null;
  whatsapp: boolean;
  sms: boolean;
  email_alert: boolean;
  order_updates: boolean;
};

function rowsOf<T>(res: unknown): T[] {
  return (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as T[];
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const guard = await requireAdmin("super", "ops");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const { q, page: pageStr } = await searchParams;
  const page = Math.max(1, parseInt(pageStr ?? "1") || 1);
  const term = (q ?? "").trim();
  const like = `%${term}%`;
  const where = term
    ? sql`WHERE email ILIKE ${like} OR student ILIKE ${like}`
    : sql``;

  const countRes = await db.execute(
    sql`SELECT count(*)::int AS n FROM website_customers ${where}`
  );
  const total = Number(rowsOf<{ n: number }>(countRes)[0]?.n ?? 0);
  const pages = Math.ceil(total / PAGE);

  const rows = rowsOf<Row>(
    await db.execute(
      sql`SELECT erp_name, email, student, erp_customer, whatsapp, sms, email_alert, order_updates
          FROM website_customers ${where}
          ORDER BY email
          LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`
    )
  );

  const qp = (p: number) =>
    `/admin/customers?q=${encodeURIComponent(term)}&page=${p}`;

  return (
    <div>
      <PageHeader
        eyebrow="Customers"
        title="Website Customers"
        description={`${total.toLocaleString("en-IN")} website accounts (from ERPNext).`}
      />

      <form method="GET">
        <Toolbar>
          <SearchInput
            defaultValue={term}
            placeholder="Search by email or student…"
          />
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </Toolbar>
      </form>

      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState
            icon={Users}
            title={term ? `No customers match “${term}”` : "No website customers"}
            description="Website accounts are imported from ERPNext."
          />
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th>ID</Th>
                <Th>User</Th>
                <Th>Customer</Th>
                <Th>Student</Th>
                <Th>Whatsapp Message</Th>
                <Th>Sms Alert</Th>
                <Th>Email Alert</Th>
                <Th>Order Updates</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const yn = (b: boolean) =>
                  b ? (
                    <span className="text-emerald-700 font-semibold">✓</span>
                  ) : (
                    <span className="text-ink-300">—</span>
                  );
                return (
                  <Tr key={i}>
                    <Td>
                      <span className="font-mono text-[12px] text-ink-900">
                        {r.erp_name ?? "—"}
                      </span>
                    </Td>
                    <Td muted>{r.email ?? "—"}</Td>
                    <Td muted>{r.erp_customer || "—"}</Td>
                    <Td muted>{r.student ?? "—"}</Td>
                    <Td>{yn(r.whatsapp)}</Td>
                    <Td>{yn(r.sms)}</Td>
                    <Td>{yn(r.email_alert)}</Td>
                    <Td>{yn(r.order_updates)}</Td>
                  </Tr>
                );
              })}
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
