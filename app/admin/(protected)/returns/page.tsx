import Link from "next/link";
import { db } from "@/db/client";
import { returns, parents, orders } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { PackageOpen } from "lucide-react";
import {
  PageHeader,
  Card,
  Th,
  Td,
  Tr,
  Badge,
  Money,
  EmptyState,
  statusTone,
} from "@/components/admin/ui/primitives";
import { redirect } from "next/navigation";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";

export const dynamic = "force-dynamic";

export default async function ReturnsPage() {
  const guard = await requireAnyPermission("returns.read", "returns.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const rows = await db
    .select({
      ret: returns,
      parentName: parents.name,
      parentPhone: parents.phone,
      orderNumber: orders.orderNumber,
    })
    .from(returns)
    .leftJoin(parents, eq(parents.id, returns.parentId))
    .leftJoin(orders, eq(orders.id, returns.orderId))
    .orderBy(desc(returns.createdAt))
    .limit(200);

  return (
    <div>
      <PageHeader
        eyebrow="Sales"
        title="Returns & RMA"
        description={`${rows.length} return requests · click a row to approve / receive / refund`}
        actions={
          <Link href="/admin/returns/new">
            <span className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-ink-900 text-white text-[13px] font-semibold hover:bg-ink-800">
              Start return
            </span>
          </Link>
        }
      />

      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState
            icon={PackageOpen}
            title="No returns yet"
            description="Customers can request returns from delivered orders. They'll appear here pending approval."
          />
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th>Return #</Th>
                <Th>Order</Th>
                <Th>Customer</Th>
                <Th>Status</Th>
                <Th>Reason</Th>
                <Th right>Refund</Th>
                <Th right>Created</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.ret.id}>
                  <Td>
                    <Link
                      href={`/admin/returns/${r.ret.id}`}
                      className="font-mono text-[12px] font-semibold text-ink-900 hover:text-brand-700 transition-colors"
                    >
                      {r.ret.returnNumber ?? r.ret.id.slice(0, 8)}
                    </Link>
                  </Td>
                  <Td>
                    <span className="font-mono text-[12px]">{r.orderNumber ?? "—"}</span>
                  </Td>
                  <Td>
                    <div className="font-medium leading-tight">{r.parentName ?? "—"}</div>
                    <div className="text-[11px] font-mono text-ink-500">{r.parentPhone}</div>
                  </Td>
                  <Td>
                    <Badge tone={statusTone(r.ret.status)} dot size="sm">
                      {r.ret.status}
                    </Badge>
                  </Td>
                  <Td muted className="max-w-[260px] truncate">
                    {r.ret.reason}
                  </Td>
                  <Td right>
                    <Money paise={r.ret.refundAmount} />
                  </Td>
                  <Td right muted>
                    {new Date(r.ret.createdAt).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                    })}
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
