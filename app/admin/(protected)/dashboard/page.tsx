import {
  School,
  Users,
  Package,
  ShoppingBag,
  IndianRupee,
  Star,
  AlertTriangle,
  TrendingUp,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";
import { getAdminStats } from "@/lib/repos/admin-stats";
import { UniversalSearch } from "@/components/admin/UniversalSearch";
import { getCurrentUser } from "@/lib/session";
import {
  PageHeader,
  Stat,
  Card,
  CardHeader,
  Badge,
  EmptyState,
  Money,
  Toolbar,
  statusTone,
  Th,
  Td,
  Tr,
} from "@/components/admin/ui/primitives";
import { AutoSubmitForm } from "@/components/admin/AutoSubmitForm";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ dateRange?: string; from?: string; to?: string }>;
}) {
  const { dateRange, from, to } = await searchParams;
  const preset =
    dateRange === "today" || dateRange === "week" || dateRange === "month"
      ? dateRange
      : null;
  const s = await getAdminStats({
    preset,
    from: from || null,
    to: to || null,
  });
  const me = await getCurrentUser();
  const role = (me?.kind === "admin" ? me.role : "ops") as "super" | "ops" | "school_admin";

  // Tile labels rephrase when a range is active so "today" doesn't
  // mislead the user when they've selected, say, "This month".
  const rangeLabel =
    preset === "today" ? "today" :
    preset === "week"  ? "this week" :
    preset === "month" ? "this month" :
    from || to         ? "in selected range" :
    "today";
  const ordersTileLabel = preset || from || to ? "Orders in range" : "Orders all-time";

  return (
    <div>
      <PageHeader
        eyebrow="Operations"
        title="Dashboard"
        description="Live snapshot of the Inventre business."
      />
      <UniversalSearch role={role} />

      {/* Date-range chips — every revenue / orders KPI + the Recent
          Orders table below re-query against the selected window. */}
      <div className="mb-4">
        <AutoSubmitForm action="/admin/dashboard">
          <Toolbar>
            <select
              name="dateRange"
              defaultValue={preset ?? ""}
              className="h-9 px-2.5 rounded-lg border border-ink-200 text-[13px] bg-white"
            >
              <option value="">All time</option>
              <option value="today">Today</option>
              <option value="week">This week</option>
              <option value="month">This month</option>
            </select>
            <input
              type="date"
              name="from"
              defaultValue={from ?? ""}
              className="h-9 px-2.5 rounded-lg border border-ink-200 text-[13px] bg-white"
              aria-label="From date"
            />
            <input
              type="date"
              name="to"
              defaultValue={to ?? ""}
              className="h-9 px-2.5 rounded-lg border border-ink-200 text-[13px] bg-white"
              aria-label="To date"
            />
          </Toolbar>
        </AutoSubmitForm>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
        <Stat
          label={`GMV ${rangeLabel}`}
          value={<Money paise={s.gmvToday * 100} />}
          icon={IndianRupee}
          iconTone="success"
          hint="Revenue from confirmed orders"
        />
        <Stat
          label={`Paid orders ${rangeLabel}`}
          value={s.paidOrdersToday}
          icon={TrendingUp}
          iconTone="brand"
          hint={(() => {
            const b = s.paidBreakdownToday;
            const parts: string[] = [];
            if (b.ccavenue) parts.push(`${b.ccavenue} CCAvenue`);
            if (b.zeroValue) parts.push(`${b.zeroValue} zero-value`);
            return parts.length
              ? parts.join(" · ")
              : "Successful checkouts";
          })()}
        />
        <Stat
          label={ordersTileLabel}
          value={s.totalOrders.toLocaleString("en-IN")}
          icon={ShoppingBag}
          iconTone="info"
        />
        <Stat
          label="Parents"
          value={s.totalParents.toLocaleString("en-IN")}
          icon={Users}
          iconTone="violet"
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4 mt-3 lg:mt-4">
        <Stat label="Schools" value={s.totalSchools} icon={School} iconTone="default" />
        <Stat label="Products" value={s.totalProducts} icon={Package} iconTone="default" />
        <Stat label="Reviews pending" value={s.pendingReviews} icon={Star} iconTone="warning" />
        <Stat label="Low-stock SKUs" value={s.lowStockSkus} icon={AlertTriangle} iconTone="danger" />
      </div>

      <div className="mt-10">
        <Card padded={false}>
          <div className="px-5 lg:px-6 pt-5 lg:pt-6 pb-3">
            <CardHeader
              title="Recent orders"
              description="Last 10 orders across all schools"
              actions={
                <Link
                  href="/admin/orders"
                  className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand-700 hover:text-brand-800"
                >
                  View all
                  <ArrowRight className="h-3 w-3" />
                </Link>
              }
            />
          </div>

          {s.recentOrders.length === 0 ? (
            <EmptyState
              icon={ShoppingBag}
              title="No orders yet"
              description="Orders will appear here as customers complete checkout."
            />
          ) : (
            <table className="w-full">
              <thead>
                <tr>
                  <Th>Order</Th>
                  <Th>Status</Th>
                  <Th right>Total</Th>
                  <Th right>Placed</Th>
                </tr>
              </thead>
              <tbody>
                {s.recentOrders.map((o) => (
                  <Tr key={o.id}>
                    <Td>
                      <Link
                        href={`/admin/orders/${o.id}`}
                        className="font-mono font-semibold text-ink-900 hover:text-brand-700 transition-colors"
                      >
                        {o.orderNumber}
                      </Link>
                    </Td>
                    <Td>
                      {(() => {
                        // Mirror /admin/orders exactly: same label and
                        // same tone, so the user doesn't see "Confirmed"
                        // green there and a different colour here.
                        const label =
                          o.statusBucket === "confirmed" ? "Confirmed" :
                          o.statusBucket === "pending"   ? "Pending" :
                          o.statusBucket === "aborted"   ? "Aborted by Customer" :
                          o.statusBucket === "failed"    ? "Failed" :
                          o.statusBucket === "refunded"  ? "Refunded" :
                          o.status;
                        const tone =
                          o.statusBucket === "confirmed" ? "success" :
                          o.statusBucket === "pending"   ? "warning" :
                          o.statusBucket === "aborted"   ? "danger"  :
                          o.statusBucket === "failed"    ? "danger"  :
                          o.statusBucket === "refunded"  ? "violet"  :
                          statusTone(label);
                        return (
                          <Badge tone={tone} dot>
                            {label}
                          </Badge>
                        );
                      })()}
                    </Td>
                    <Td right>
                      <Money paise={o.total * 100} className="font-semibold" />
                    </Td>
                    <Td right muted>
                      {new Date(o.createdAt).toLocaleString("en-IN", {
                        timeZone: "Asia/Kolkata",
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: true,
                      })}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
