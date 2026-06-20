import { desc, and, eq, gte, ilike, or } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { orderNotifications } from "@/db/schema";
import { PageHeader, Card, Th } from "@/components/admin/ui/primitives";
import {
  NotificationOrderRow,
  type ChannelRow,
} from "@/components/admin/NotificationOrderRow";
import { AutoRefresh } from "@/components/admin/AutoRefresh";
import { requireAnyPermission, isResponse } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

const fmtIst = (ts: Date | null) => {
  if (!ts) return "—";
  return ts.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
};

export default async function OrderNotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    channel?: string;
    status?: string;
    since?: string;
    page?: string;
  }>;
}) {
  const guard = await requireAnyPermission(
    "order-notifications.read",
    "order-notifications.write"
  );
  if (isResponse(guard)) redirect("/admin/dashboard");
  const canWrite = guard.permissions.has("order-notifications.write");

  const { q, channel, status, since, page: pageRaw } = await searchParams;
  const page = Math.max(1, parseInt(pageRaw ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const sinceDate =
    since === "today"
      ? new Date(new Date().setHours(0, 0, 0, 0))
      : since === "7d"
        ? new Date(Date.now() - 7 * 86400_000)
        : since === "30d"
          ? new Date(Date.now() - 30 * 86400_000)
          : null;

  const conds = [
    q
      ? or(
          ilike(orderNotifications.orderNumber, `%${q}%`),
          ilike(orderNotifications.recipient, `%${q}%`)
        )
      : undefined,
    channel ? eq(orderNotifications.channel, channel) : undefined,
    status ? eq(orderNotifications.status, status) : undefined,
    sinceDate ? gte(orderNotifications.createdAt, sinceDate) : undefined,
  ].filter(Boolean) as Parameters<typeof and>[0][];

  // NOTE: don't copy otp-logs' `select({total: db.$count(...)}).from(t)`
  // shape here — selecting FROM the counted table yields zero rows when
  // the table is empty, and the `[{ total }]` destructure crashes the
  // page (prod digest 1941797126). Standalone $count always returns a
  // number.
  const [rows, total] = await Promise.all([
    db
      .select()
      .from(orderNotifications)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(orderNotifications.createdAt))
      .limit(PAGE_SIZE)
      .offset(offset),
    db.$count(orderNotifications, conds.length ? and(...conds) : undefined),
  ]);

  // Collapse the flat per-attempt rows into one row per sale order, keeping
  // the latest attempt for each channel. Rows arrive ordered by createdAt
  // desc, so the first time an order is seen is its most recent activity and
  // Map insertion order preserves that ordering for display.
  type Group = {
    orderId: string;
    orderNumber: string;
    createdAt: Date | null;
    email: ChannelRow | null;
    sms: ChannelRow | null;
  };
  const toChannelRow = (r: (typeof rows)[number]): ChannelRow => ({
    id: r.id,
    recipient: r.recipient,
    status: r.status,
    vendorId: r.vendorId,
    error: r.error,
    attempt: r.attempt,
    subject: r.subject,
    body: r.body,
  });
  const groups = new Map<string, Group>();
  for (const r of rows) {
    let g = groups.get(r.orderId);
    if (!g) {
      g = {
        orderId: r.orderId,
        orderNumber: r.orderNumber,
        createdAt: r.createdAt,
        email: null,
        sms: null,
      };
      groups.set(r.orderId, g);
    }
    if (r.createdAt && (!g.createdAt || r.createdAt > g.createdAt)) {
      g.createdAt = r.createdAt;
    }
    const ch = r.channel === "sms" ? "sms" : "email";
    const existing = g[ch];
    // Higher attempt = more recent send for this channel.
    if (!existing || r.attempt >= existing.attempt) {
      g[ch] = toChannelRow(r);
    }
  }
  const orderRows = [...groups.values()];

  const totalPages = Math.max(1, Math.ceil(Number(total) / PAGE_SIZE));

  function qs(overrides: Record<string, string | undefined>) {
    const p = new URLSearchParams();
    const merged = { q, channel, status, since, page: String(page), ...overrides };
    for (const [k, v] of Object.entries(merged)) {
      if (v) p.set(k, v);
    }
    return `?${p}`;
  }

  return (
    <div>
      <AutoRefresh seconds={15} />
      <PageHeader
        eyebrow="Engagement"
        title="Order Notifications"
        description={`${Number(total).toLocaleString()} total send attempts · order-confirmation SMS & email (times in IST) · auto-refreshes every 15s`}
      />

      {/* Filters */}
      <form method="GET" className="mb-4 flex flex-wrap gap-3">
        <input
          name="q"
          defaultValue={q}
          placeholder="Order number / phone / email…"
          className="h-9 w-64 rounded-lg border border-ink-200 bg-white px-3 text-[13px] text-ink-900 placeholder:text-ink-400 focus:border-ink-900 focus:outline-none focus:ring-2 focus:ring-brand/20"
        />
        <select
          name="channel"
          defaultValue={channel ?? ""}
          className="h-9 rounded-lg border border-ink-200 bg-white px-3 text-[13px] text-ink-900 focus:border-ink-900 focus:outline-none"
        >
          <option value="">All channels</option>
          <option value="sms">SMS</option>
          <option value="email">Email</option>
        </select>
        <select
          name="status"
          defaultValue={status ?? ""}
          className="h-9 rounded-lg border border-ink-200 bg-white px-3 text-[13px] text-ink-900 focus:border-ink-900 focus:outline-none"
        >
          <option value="">All statuses</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
        </select>
        <select
          name="since"
          defaultValue={since ?? ""}
          className="h-9 rounded-lg border border-ink-200 bg-white px-3 text-[13px] text-ink-900 focus:border-ink-900 focus:outline-none"
        >
          <option value="">All time</option>
          <option value="today">Today</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </select>
        <input type="hidden" name="page" value="1" />
        <button
          type="submit"
          className="h-9 rounded-lg bg-ink-900 px-4 text-[13px] font-semibold text-white hover:bg-ink-700"
        >
          Filter
        </button>
        <a
          href="/admin/order-notifications"
          className="h-9 inline-flex items-center rounded-lg border border-ink-200 px-4 text-[13px] font-semibold text-ink-600 hover:bg-ink-50"
        >
          Clear
        </a>
      </form>

      <Card padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr>
                <Th>Time (IST)</Th>
                <Th>Order</Th>
                <Th>Email</Th>
                <Th>SMS</Th>
              </tr>
            </thead>
            <tbody>
              {orderRows.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-8 text-center text-ink-400"
                  >
                    No notifications match these filters.
                  </td>
                </tr>
              )}
              {orderRows.map((g) => (
                <NotificationOrderRow
                  key={g.orderId}
                  orderId={g.orderId}
                  orderNumber={g.orderNumber}
                  time={fmtIst(g.createdAt)}
                  email={g.email}
                  sms={g.sms}
                  canWrite={canWrite}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center gap-2 text-[13px]">
          {page > 1 && (
            <a
              href={qs({ page: String(page - 1) })}
              className="rounded-lg border border-ink-200 px-3 py-1.5 hover:bg-ink-50"
            >
              ← Prev
            </a>
          )}
          <span className="text-ink-500">
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <a
              href={qs({ page: String(page + 1) })}
              className="rounded-lg border border-ink-200 px-3 py-1.5 hover:bg-ink-50"
            >
              Next →
            </a>
          )}
        </div>
      )}
    </div>
  );
}
