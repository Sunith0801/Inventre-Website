import Link from "next/link";
import { db } from "@/db/client";
import { invoices, parents } from "@/db/schema";
import { eq, sql, desc } from "drizzle-orm";
import { Wallet } from "lucide-react";
import {
  PageHeader,
  Card,
  Th,
  Td,
  Tr,
  Badge,
  EmptyState,
  Stat,
  Money,
} from "@/components/admin/ui/primitives";

export const dynamic = "force-dynamic";

export default async function ReceivablesPage() {
  const today = new Date().toISOString().slice(0, 10);

  const rows = await db
    .select({
      invoice: invoices,
      parentName: parents.name,
      parentPhone: parents.phone,
      daysOverdue: sql<number>`GREATEST(0, ${today}::date - COALESCE(${invoices.dueDate}::date, ${invoices.postingDate}::date))::int`,
    })
    .from(invoices)
    .innerJoin(parents, eq(parents.id, invoices.parentId))
    .where(
      sql`${invoices.outstandingAmount} > 0 AND ${invoices.status} != 'cancelled'`
    )
    .orderBy(desc(invoices.outstandingAmount))
    .limit(500);

  const buckets = { current: 0, b30: 0, b60: 0, b90: 0, b180: 0, b181: 0 };
  let totalOutstanding = 0;
  const enriched = rows.map((r) => {
    totalOutstanding += r.invoice.outstandingAmount;
    const d = Number(r.daysOverdue);
    let bucket: keyof typeof buckets = "current";
    if (d <= 0) bucket = "current";
    else if (d <= 30) bucket = "b30";
    else if (d <= 60) bucket = "b60";
    else if (d <= 90) bucket = "b90";
    else if (d <= 180) bucket = "b180";
    else bucket = "b181";
    buckets[bucket] += r.invoice.outstandingAmount;
    return { ...r, days: d, bucket };
  });

  return (
    <div>
      <PageHeader
        breadcrumb={[
          { label: "Reports", href: "/admin/reports" },
          { label: "Receivables aging" },
        ]}
        eyebrow="Reports"
        title="Outstanding receivables aging"
        description="Invoices with positive outstanding balance, bucketed by days past due."
      />

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-5">
        <Stat
          label="Total outstanding"
          value={<Money paise={totalOutstanding} />}
          iconTone="brand"
        />
        <Stat label="Current" value={<Money paise={buckets.current} />} iconTone="success" />
        <Stat label="1–30" value={<Money paise={buckets.b30} />} iconTone="info" />
        <Stat label="31–60" value={<Money paise={buckets.b60} />} iconTone="warning" />
        <Stat label="61–90" value={<Money paise={buckets.b90} />} iconTone="warning" />
        <Stat label="90+" value={<Money paise={buckets.b180 + buckets.b181} />} iconTone="danger" />
      </div>

      <Card padded={false}>
        {enriched.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title="All paid up"
            description="No invoices have outstanding balance."
          />
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th>Invoice #</Th>
                <Th>Customer</Th>
                <Th>Posting</Th>
                <Th>Due</Th>
                <Th right>Days overdue</Th>
                <Th right>Outstanding</Th>
                <Th>Bucket</Th>
              </tr>
            </thead>
            <tbody>
              {enriched.map((r) => (
                <Tr key={r.invoice.id}>
                  <Td>
                    <Link
                      href={`/admin/invoices/${r.invoice.id}/print`}
                      className="font-mono text-[12px] font-semibold hover:text-brand-700"
                    >
                      {r.invoice.invoiceNumber}
                    </Link>
                  </Td>
                  <Td>
                    <div>{r.parentName ?? "—"}</div>
                    <div className="text-[11px] text-ink-500 font-mono">
                      {r.parentPhone}
                    </div>
                  </Td>
                  <Td muted>{r.invoice.postingDate}</Td>
                  <Td muted>{r.invoice.dueDate ?? "—"}</Td>
                  <Td right>
                    <span
                      className={
                        r.days > 90
                          ? "text-red-700 font-semibold tabular-nums"
                          : r.days > 30
                          ? "text-amber-700 font-semibold tabular-nums"
                          : "tabular-nums"
                      }
                    >
                      {r.days}
                    </span>
                  </Td>
                  <Td right>
                    <Money
                      paise={r.invoice.outstandingAmount}
                      className="font-semibold"
                    />
                  </Td>
                  <Td>
                    <Badge tone={bucketTone(r.bucket)} dot size="sm">
                      {bucketLabel(r.bucket)}
                    </Badge>
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

function bucketLabel(b: string): string {
  switch (b) {
    case "current":
      return "Current";
    case "b30":
      return "1–30";
    case "b60":
      return "31–60";
    case "b90":
      return "61–90";
    case "b180":
      return "91–180";
    default:
      return "180+";
  }
}

function bucketTone(b: string): "success" | "info" | "warning" | "danger" {
  switch (b) {
    case "current":
      return "success";
    case "b30":
      return "info";
    case "b60":
      return "warning";
    case "b90":
      return "warning";
    default:
      return "danger";
  }
}
